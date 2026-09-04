import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { createRepositories } from "../../src/data/sqlite/provider";
import { setBlobStore, MemoryBlobStore, supportsCrossHostEnrichment } from "../../src/lib/storage/blob-store";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import type { StorageProvider } from "../../src/domain/repositories";

// Mock the LLM extraction step so we don't hit OpenAI, but still produce a valid dimension set.
vi.mock("../../scripts/scraper/extract/extractor", () => ({
  extract: vi.fn().mockResolvedValue({
    dimensions: [
      {
        key: "core_role",
        jdEvidence: {
          value: "VP Engineering",
          status: "Present",
          evidence: [{ quote: "We are seeking a VP Engineering to lead our systems team." }]
        }
      }
    ],
    missing: [],
    telemetry: { deterministicMs: 10, llmMs: 0, llmCalled: false }
  })
}));

describe("Phase 6: Acquisition Evidence Reliability & Payload Resolution", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let repos: StorageProvider;
  let memStore: MemoryBlobStore;
  let queue: EnrichmentQueue;

  beforeEach(async () => {
    // 1. Create a fresh, isolated in-memory database for the test
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    repos = createRepositories(db);
    queue = new EnrichmentQueue(db);

    memStore = new MemoryBlobStore();
    setBlobStore(memStore);

    // 2. Initialize full database topology
    await setupLineageTestFixture(db);

    // 3. Provide a Scrape Run for lineage
    await db.execute(
      "INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets) VALUES (?, ?, ?, ?, ?, ?)",
      ["run-regression", "tenant_A", "person_A", "plan_A", "running", "[]"]
    );
  });

  const provenance = {
    runId: "run-regression",
    executionPlanId: "plan_A",
    definitionId: "def1",
    familyId: "fam1",
    portal: "LinkedIn",
    page: 1,
    catalogVersion: "1.0",
    plannerVersion: "1.0",
    ruleVersion: "1.0",
    searchQuery: "VP Test"
  };

  it("1. proves that a valid payload resolves and becomes a persisted document", async () => {
    const ledger = await repos.acquisition.upsertDiscoveredJob({
      canonicalJobId: "linkedin:test-opp-1",
      sourcePortal: "LinkedIn",
      sourceJobId: "test-opp-1",
      canonicalUrl: "http://test",
      title: "VP Test",
      companyName: "Test Company",
      state: "DISCOVERED",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });

    await repos.acquisition.recordIngestionLineage({
      scrapeRunId: "run-regression",
      tenantId: "tenant_A",
      personId: "person_A",
      acquisitionLedgerId: ledger.id,
      cardId: "card-1",
      ingestionAttempt: 1,
      sourcePortal: "LinkedIn",
      sourceJobId: "test-opp-1",
      sourceUrl: "http://test",
      captureState: "CAPTURED",
      documentState: "PENDING"
    });

    await memStore.put("payloads/valid.json", JSON.stringify({
      id: "test-opp-1",
      portal: "LinkedIn",
      title: "VP Test",
      company: "Test Company",
      location: "Remote",
      cardHash: "hash-valid",
      descriptionText: "This is a valid payload."
    }));

    await queue.enqueue("card-1", "hash-valid", "payloads/valid.json", "ext_v2", provenance, 10, 5, "payloads/valid.json");

    // Run the real worker loop with explicit DI seam
    const { enrichJobsForRun } = await import("../../scripts/enrich");
    await enrichJobsForRun("run-regression", { queue, repos });

    const job = await db.one<any>("SELECT status, last_error FROM enrichment_jobs WHERE job_hash = ?", ["hash-valid"]);
    expect(job).not.toBeNull();
    expect(job.status).toBe("COMPLETE");

    const docs = await db.many<any>("SELECT * FROM documents");
    expect(docs.length).toBe(1);
    expect(docs[0].lifecycle).toBe("Parsed");
    expect(docs[0].source_id).toBe("LinkedIn");
  });

  it("2. proves that a failed payload resolution remains explicitly failed rather than becoming a hollow success", async () => {
    const ledger = await repos.acquisition.upsertDiscoveredJob({
      canonicalJobId: "linkedin:test-opp-missing",
      sourcePortal: "LinkedIn",
      sourceJobId: "test-opp-missing",
      canonicalUrl: "http://test",
      title: "VP Missing",
      companyName: "Test Company",
      state: "DISCOVERED",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });

    await repos.acquisition.recordIngestionLineage({
      scrapeRunId: "run-regression",
      tenantId: "tenant_A",
      personId: "person_A",
      acquisitionLedgerId: ledger.id,
      cardId: "card-missing",
      ingestionAttempt: 1,
      sourcePortal: "LinkedIn",
      sourceJobId: "test-opp-missing",
      sourceUrl: "http://test",
      captureState: "CAPTURED",
      documentState: "PENDING"
    });

    await queue.enqueue("card-missing", "hash-missing", "payloads/missing.json", "ext_v2", provenance, 10, 5, "payloads/missing.json");

    const { enrichJobsForRun } = await import("../../scripts/enrich");
    await enrichJobsForRun("run-regression", { queue, repos });

    const job = await db.one<any>("SELECT status, failure_type, last_error FROM enrichment_jobs WHERE job_hash = ?", ["hash-missing"]);
    expect(job).not.toBeNull();
    expect(job.status).toBe("FAILED");
    expect(job.last_error).toContain("Enrichment payload not found");

    const docs = await db.many<any>("SELECT * FROM documents WHERE source_id = ?", ["linkedin:test-opp-missing"]);
    expect(docs.length).toBe(0);
  });

  it("3. proves recovery is idempotent", async () => {
    const ledger = await repos.acquisition.upsertDiscoveredJob({
      canonicalJobId: "linkedin:test-opp-retry",
      sourcePortal: "LinkedIn",
      sourceJobId: "test-opp-retry",
      canonicalUrl: "http://test",
      title: "VP Retry",
      companyName: "Test Company",
      state: "DISCOVERED",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });

    await repos.acquisition.recordIngestionLineage({
      scrapeRunId: "run-regression",
      tenantId: "tenant_A",
      personId: "person_A",
      acquisitionLedgerId: ledger.id,
      cardId: "card-retry",
      ingestionAttempt: 1,
      sourcePortal: "LinkedIn",
      sourceJobId: "test-opp-retry",
      sourceUrl: "http://test",
      captureState: "CAPTURED",
      documentState: "FAILED"
    });

    await memStore.put("payloads/valid-retry.json", JSON.stringify({
      id: "test-opp-retry",
      portal: "LinkedIn",
      title: "VP Retry",
      company: "Test Company",
      location: "Remote",
      cardHash: "hash-retry",
      descriptionText: "Valid payload now exists."
    }));

    await repos.acquisition.recordIngestionLineage({
      scrapeRunId: "run-regression",
      tenantId: "tenant_A",
      personId: "person_A",
      acquisitionLedgerId: ledger.id,
      cardId: "card-retry",
      ingestionAttempt: 2,
      sourcePortal: "LinkedIn",
      sourceJobId: "test-opp-retry",
      sourceUrl: "http://test",
      captureState: "CAPTURED",
      documentState: "PENDING"
    });

    await queue.enqueue("card-retry", "hash-retry", "payloads/valid-retry.json", "ext_v2", provenance, 10, 5, "payloads/valid-retry.json");

    const { enrichJobsForRun } = await import("../../scripts/enrich");
    await enrichJobsForRun("run-regression", { queue, repos });

    // Assert 1: Exactly one canonical opportunity for the source identity
    const opps = await db.many<any>("SELECT * FROM opportunities WHERE fingerprint = ?", ["hash-retry"]);
    expect(opps.length).toBe(1);
    expect(opps[0].canonical_title).toBe("VP Retry");

    // Assert 2: Exactly one persisted document linked to that canonical opportunity
    const docs = await db.many<any>("SELECT * FROM documents WHERE source_id = ?", ["LinkedIn"]);
    expect(docs.length).toBe(1);
    expect(docs[0].opportunity_id).toBe(opps[0].id);
    expect(docs[0].lifecycle).toBe("Parsed");

    // Assert 3: Successful document/evidence lineage is established with grounded facts
    const evidence = await db.many<any>("SELECT * FROM evidence WHERE document_id = ?", [docs[0].id]);
    expect(evidence.length).toBe(1);
    expect(evidence[0].text).toContain("VP Engineering");

    const facts = await db.many<any>("SELECT * FROM facts WHERE opportunity_id = ?", [opps[0].id]);
    expect(facts.length).toBe(1);

    // Assert 4: Attempt history reflects failure followed by recovery attempt
    const lineage = await db.many<any>(
      "SELECT ingestion_attempt, document_state FROM acquisition_ingestion_lineage WHERE card_id = ? ORDER BY ingestion_attempt ASC",
      ["card-retry"]
    );
    expect(lineage.length).toBe(2);
    expect(lineage[0]).toEqual({ ingestion_attempt: 1, document_state: "FAILED" });
    expect(lineage[1]).toEqual({ ingestion_attempt: 2, document_state: "PENDING" });

    // Assert 5: A subsequent re-enrichment or re-enqueue run does NOT duplicate opportunity or documents
    await queue.enqueue("card-retry", "hash-retry", "payloads/valid-retry.json", "ext_v2", provenance, 10, 5, "payloads/valid-retry.json");
    await enrichJobsForRun("run-regression", { queue, repos });

    const oppsPostRetry = await db.many<any>("SELECT * FROM opportunities WHERE fingerprint = ?", ["hash-retry"]);
    expect(oppsPostRetry.length).toBe(1);

    const docsPostRetry = await db.many<any>("SELECT * FROM documents WHERE opportunity_id = ?", [opps[0].id]);
    expect(docsPostRetry.length).toBe(1);
  });

  it("4. guards cross-host backend safety", () => {
    expect(supportsCrossHostEnrichment({ RADAR_DEPLOYMENT_MODE: "single_host" } as NodeJS.ProcessEnv)).toBe(false);
    expect(supportsCrossHostEnrichment({
      RADAR_DEPLOYMENT_MODE: "distributed",
      BLOB_STORAGE_ENDPOINT: "https://storage.example.test",
      BLOB_STORAGE_BUCKET: "radar-payloads",
    } as NodeJS.ProcessEnv)).toBe(true);
  });
});
