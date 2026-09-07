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

    // 4. Register default test company
    await repos.companies.registerCompany({
      id: "company-test",
      name: "Test Company",
      domain: "test.company",
      industry: "Tech",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: { schemaVersion: "1.0", extractorVersion: "1.0", model: "test", runId: "run-regression", timestamp: new Date().toISOString() }
    });
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
    await repos.opportunities.mergeOpportunity({
      id: "linkedin:test-opp-1",
      companyId: "company-test",
      canonicalTitle: "VP Test",
      location: "Remote",
      employmentType: "Full-Time",
      postingWindow: "Recently",
      fingerprint: "linkedin:test-opp-1",
      lifecycle: "Archived",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: { schemaVersion: "1.0", extractorVersion: "1.0", model: "test", runId: "run-regression", timestamp: new Date().toISOString() }
    });

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
    await repos.opportunities.mergeOpportunity({
      id: "linkedin:test-opp-retry",
      companyId: "company-test",
      canonicalTitle: "VP Retry",
      location: "Remote",
      employmentType: "Full-Time",
      postingWindow: "Recently",
      fingerprint: "linkedin:test-opp-retry",
      lifecycle: "Archived",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: { schemaVersion: "1.0", extractorVersion: "1.0", model: "test", runId: "run-regression", timestamp: new Date().toISOString() }
    });

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
    const opps = await db.many<any>("SELECT * FROM opportunities WHERE id = ?", ["linkedin:test-opp-retry"]);
    expect(opps.length).toBe(1);
    expect(opps[0].canonical_title).toBe("VP Retry");
    expect(opps[0].fingerprint).toBe("linkedin:test-opp-retry");

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

    const oppsPostRetry = await db.many<any>("SELECT * FROM opportunities WHERE id = ?", ["linkedin:test-opp-retry"]);
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

  it("5. proves canonicalJobId !== cardHash enriches admitted opportunity in place without producing o_... duplicates", async () => {
    const admittedCanonicalId = "indeed:jk_production_sample_123";
    const payloadHash = "hash_completely_distinct_abc456";

    await repos.companies.registerCompany({
      id: "company-test",
      name: "Acme Corp",
      domain: "acme.test",
      industry: "Tech",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: { schemaVersion: "1.0", extractorVersion: "1.0", model: "test", runId: "run-regression", timestamp: new Date().toISOString() }
    });

    // 1. Admission: opportunity pre-exists in opportunities table with canonicalJobId
    await repos.opportunities.mergeOpportunity({
      id: admittedCanonicalId,
      companyId: "company-test",
      canonicalTitle: "VP of Engineering",
      location: "Bengaluru",
      employmentType: "Full-Time",
      postingWindow: "Recently",
      fingerprint: admittedCanonicalId,
      lifecycle: "Archived",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: { schemaVersion: "1.0", extractorVersion: "1.0", model: "test", runId: "run-regression", timestamp: new Date().toISOString() }
    });

    const ledger = await repos.acquisition.upsertDiscoveredJob({
      canonicalJobId: admittedCanonicalId,
      sourcePortal: "Indeed",
      sourceJobId: "production_sample_123",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=production_sample_123",
      title: "VP of Engineering",
      companyName: "Acme Corp",
      state: "VALIDATED",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    await db.execute(
      "INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES (?, ?, ?, ?, ?)",
      [admittedCanonicalId, "Indeed", "production_sample_123", "https://in.indeed.com/viewjob?jk=production_sample_123", "Acme Corp"]
    );
    await db.execute(
      "INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES (?, ?, ?, ?, ?)",
      ["1.0", admittedCanonicalId, payloadHash, "VP of Engineering", "Sample JD"]
    );

    await repos.acquisition.recordIngestionLineage({
      scrapeRunId: "run-regression",
      tenantId: "tenant_A",
      personId: "person_A",
      acquisitionLedgerId: ledger.id,
      cardId: "card-distinct-1",
      ingestionAttempt: 1,
      sourcePortal: "Indeed",
      sourceJobId: "production_sample_123",
      sourceUrl: "https://in.indeed.com/viewjob?jk=production_sample_123",
      canonicalJobId: admittedCanonicalId,
      opportunityVersion: "1.0",
      contentHash: payloadHash,
      captureState: "CAPTURED",
      documentState: "PENDING"
    });

    // 2. Payload has completely distinct cardHash
    await memStore.put("payloads/distinct.json", JSON.stringify({
      id: "production_sample_123",
      portal: "Indeed",
      title: "VP of Engineering",
      company: "Acme Corp",
      location: "Bengaluru",
      detailUrl: "https://in.indeed.com/viewjob?jk=production_sample_123",
      cardHash: payloadHash,
      detail: {
        fetched: true,
        rawText: "We are seeking a VP Engineering to lead our systems team with extensive executive leadership."
      }
    }));

    await queue.enqueue("card-distinct-1", payloadHash, "payloads/distinct.json", "ext_v2", provenance, 10, 5, "payloads/distinct.json");

    // 3. Run worker
    const { enrichJobsForRun } = await import("../../scripts/enrich");
    await enrichJobsForRun("run-regression", { queue, repos });

    // Assert: Exactly 1 opportunity in DB
    const allOpps = await db.many<any>("SELECT * FROM opportunities");
    expect(allOpps.length).toBe(1);
    expect(allOpps[0].id).toBe(admittedCanonicalId);
    expect(allOpps[0].fingerprint).toBe(admittedCanonicalId);
    expect(allOpps[0].lifecycle).toBe("Normalized");

    // Explicitly test the forbidden namespace
    const forbiddenOpps = await db.many<any>("SELECT id, fingerprint FROM opportunities WHERE id LIKE 'o_%'");
    expect(forbiddenOpps.length).toBe(0);

    // Document linked to canonical ID
    const docs = await db.many<any>("SELECT * FROM documents WHERE opportunity_id = ?", [admittedCanonicalId]);
    expect(docs.length).toBe(1);
    expect(docs[0].lifecycle).toBe("Parsed");

    // Evidence linked to document
    const evidence = await db.many<any>("SELECT * FROM evidence WHERE document_id = ?", [docs[0].id]);
    expect(evidence.length).toBeGreaterThan(0);

    // Facts linked to canonical opportunity ID
    const facts = await db.many<any>("SELECT * FROM facts WHERE opportunity_id = ?", [admittedCanonicalId]);
    expect(facts.length).toBeGreaterThan(0);

    // Assert retry / re-enqueue idempotency:
    await queue.enqueue("card-distinct-1", payloadHash, "payloads/distinct.json", "ext_v2", provenance, 10, 5, "payloads/distinct.json");
    await enrichJobsForRun("run-regression", { queue, repos });

    const oppsPostRetry = await db.many<any>("SELECT * FROM opportunities");
    expect(oppsPostRetry.length).toBe(1);
    const docsPostRetry = await db.many<any>("SELECT * FROM documents");
    expect(docsPostRetry.length).toBe(1);
    const forbiddenPostRetry = await db.many<any>("SELECT * FROM opportunities WHERE id LIKE 'o_%'");
    expect(forbiddenPostRetry.length).toBe(0);
  });

  it("6. proves fail-closed contract when an explicit canonical ID is supplied but does not exist in opportunities", async () => {
    const { ingestIntoSqlite } = await import("../../scripts/scraper/persist/ingest");
    const ghostCard: any = {
      portal: "Indeed",
      detailUrl: "https://in.indeed.com/viewjob?jk=ghost_id",
      title: "VP Ghost",
      company: "Ghost Inc",
      cardHash: "ghost_hash_123"
    };

    await expect(
      ingestIntoSqlite(ghostCard, JSON.stringify({ dimensions: [], missing: [], telemetry: {} }), "1.0", true, repos, "indeed:jk_ghost_id")
    ).rejects.toThrow("Canonical opportunity indeed:jk_ghost_id was explicitly supplied but does not exist in repository");

    const docs = await db.many<any>("SELECT * FROM documents WHERE opportunity_id = 'indeed:jk_ghost_id'");
    expect(docs.length).toBe(0);
    const opps = await db.many<any>("SELECT * FROM opportunities WHERE id = 'indeed:jk_ghost_id'");
    expect(opps.length).toBe(0);
  });

  it("7. proves dual-mode contract: unadmitted standalone card preserves deterministic legacy o_... generation", async () => {
    const { ingestIntoSqlite } = await import("../../scripts/scraper/persist/ingest");
    const standaloneCard: any = {
      portal: "Standalone",
      title: "VP Standalone",
      company: "Standalone Corp",
      cardHash: "standalone_hash_999"
    };

    const report = await ingestIntoSqlite(standaloneCard, JSON.stringify({ dimensions: [], missing: [], telemetry: {} }), "1.0", true, repos);
    expect(report.opportunitiesCreated).toBe(1);

    const legacyOpps = await db.many<any>("SELECT * FROM opportunities WHERE fingerprint = 'standalone_hash_999'");
    expect(legacyOpps.length).toBe(1);
    expect(legacyOpps[0].id).toMatch(/^o_/);
  });

  it("8. proves sponsored alias resolution invariant: alias resolves to single canonical parent without orphan creation", async () => {
    const parentCanonicalId = "indeed:jk_5554b5a53d15a259";
    const aliasJobHash = "alias_hash_click_07e1b";

    await repos.opportunities.mergeOpportunity({
      id: parentCanonicalId,
      companyId: "company-test",
      canonicalTitle: "Director of Product",
      location: "Gurugram",
      employmentType: "Full-Time",
      postingWindow: "Recently",
      fingerprint: parentCanonicalId,
      lifecycle: "Archived",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance: { schemaVersion: "1.0", extractorVersion: "1.0", model: "test", runId: "run-regression", timestamp: new Date().toISOString() }
    });

    const ledger = await repos.acquisition.upsertDiscoveredJob({
      canonicalJobId: parentCanonicalId,
      sourcePortal: "Indeed",
      sourceJobId: "5554b5a53d15a259",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=5554b5a53d15a259",
      title: "Director of Product",
      companyName: "Acme Corp",
      state: "VALIDATED",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });

    await repos.acquisition.recordIngestionLineage({
      scrapeRunId: "run-regression",
      tenantId: "tenant_A",
      personId: "person_A",
      acquisitionLedgerId: ledger.id,
      cardId: "card-alias-1",
      ingestionAttempt: 1,
      sourcePortal: "Indeed",
      sourceJobId: "url_07e1b1be32da3f30",
      sourceUrl: "https://in.indeed.com/pagead/clk?mo=0&ad=-6NYlbfkN0...",
      captureState: "CAPTURED",
      documentState: "PENDING"
    });

    await memStore.put("payloads/alias.json", JSON.stringify({
      id: "5554b5a53d15a259",
      portal: "Indeed",
      title: "Director of Product",
      company: "Acme Corp",
      location: "Gurugram",
      detailUrl: "https://in.indeed.com/viewjob?jk=5554b5a53d15a259",
      cardHash: aliasJobHash,
      detail: {
        fetched: true,
        rawText: "We are seeking a Director of Product to lead product innovation."
      }
    }));

    await queue.enqueue("card-alias-1", aliasJobHash, "payloads/alias.json", "ext_v2", provenance, 10, 5, "payloads/alias.json");

    const { enrichJobsForRun } = await import("../../scripts/enrich");
    await enrichJobsForRun("run-regression", { queue, repos });

    const opps = await db.many<any>("SELECT * FROM opportunities WHERE id = ?", [parentCanonicalId]);
    expect(opps.length).toBe(1);
    expect(opps[0].lifecycle).toBe("Normalized");

    const forbidden = await db.many<any>("SELECT * FROM opportunities WHERE id LIKE '%url_07e1b%' OR id LIKE 'o_%'");
    expect(forbidden.length).toBe(0);

    const docs = await db.many<any>("SELECT * FROM documents WHERE opportunity_id = ?", [parentCanonicalId]);
    expect(docs.length).toBe(1);
  });
});
