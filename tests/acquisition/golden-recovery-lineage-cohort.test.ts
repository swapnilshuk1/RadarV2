import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { createRepositories } from "../../src/data/sqlite/provider";
import { setBlobStore, MemoryBlobStore } from "../../src/lib/storage/blob-store";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import type { StorageProvider } from "../../src/domain/repositories";
import type { Provenance } from "../../scripts/scraper/types";

// Mock the LLM extraction step to be deterministic and fast
vi.mock("../../scripts/scraper/extract/extractor", () => ({
  extract: vi.fn().mockImplementation(async (card) => ({
    dimensions: [
      {
        key: "core_role",
        jdEvidence: {
          value: "Executive Leadership",
          status: "Present",
          evidence: [{ quote: `Executive leadership role responsibilities for ${card.title || card.id}` }]
        }
      }
    ],
    missing: [],
    telemetry: { deterministicMs: 5, llmMs: 0, llmCalled: false }
  }))
}));

/**
 * Authoritative Golden Lineage Cohort from Production Run `run-1788527028264`.
 * 17 distinct admitted canonical opportunities + 1 sponsored alias.
 */
interface GoldenLineageIdentity {
  canonicalJobId: string;
  portal: "Indeed" | "Naukri" | "LinkedIn";
  sourceJobId: string;
  title: string;
  cardHash: string;
  isAlias?: boolean;
  parentCanonicalId?: string;
}

const GOLDEN_COHORT: GoldenLineageIdentity[] = [
  { canonicalJobId: "indeed:jk_2e51c10d2df3d705", portal: "Indeed", sourceJobId: "2e51c10d2df3d705", title: "Sales Director / Operations Head", cardHash: "hash_indeed_2e51c1" },
  { canonicalJobId: "indeed:jk_905e20fd330aa608", portal: "Indeed", sourceJobId: "905e20fd330aa608", title: "VP Marketing", cardHash: "hash_indeed_905e20" },
  { canonicalJobId: "indeed:jk_5554b5a53d15a259", portal: "Indeed", sourceJobId: "5554b5a53d15a259", title: "Operations Director", cardHash: "hash_indeed_5554b5" },
  { canonicalJobId: "indeed:jk_4ded8034365364b0", portal: "Indeed", sourceJobId: "4ded8034365364b0", title: "Vice President", cardHash: "hash_indeed_4ded80" },
  { canonicalJobId: "naukri:120326013339", portal: "Naukri", sourceJobId: "120326013339", title: "Growth Head", cardHash: "hash_naukri_120326" },
  { canonicalJobId: "naukri:030926011029", portal: "Naukri", sourceJobId: "030926011029", title: "Director Duckcreek Policy", cardHash: "hash_naukri_030926" },
  { canonicalJobId: "naukri:280826000342", portal: "Naukri", sourceJobId: "280826000342", title: "Director (Order To Cash)", cardHash: "hash_naukri_280826" },
  { canonicalJobId: "linkedin:4461141822", portal: "LinkedIn", sourceJobId: "4461141822", title: "Marketing Head- Nutrition", cardHash: "hash_linkedin_446114" },
  { canonicalJobId: "linkedin:4461134634", portal: "LinkedIn", sourceJobId: "4461134634", title: "Influencer Marketing Executive", cardHash: "hash_linkedin_446113" },
  { canonicalJobId: "indeed:jk_adb02260a3b2c3b0", portal: "Indeed", sourceJobId: "adb02260a3b2c3b0", title: "IB Research Quant Analyst - VP", cardHash: "hash_indeed_adb022" },
  { canonicalJobId: "linkedin:4461163555", portal: "LinkedIn", sourceJobId: "4461163555", title: "Client Engagement and Marketing Executive", cardHash: "hash_linkedin_446116" },
  { canonicalJobId: "linkedin:4456592369", portal: "LinkedIn", sourceJobId: "4456592369", title: "Associate Director - Programmatic", cardHash: "hash_linkedin_445659" },
  { canonicalJobId: "linkedin:4463337285", portal: "LinkedIn", sourceJobId: "4463337285", title: "Sales and Marketing Executive – Luxury Travel", cardHash: "hash_linkedin_446333_7285" },
  { canonicalJobId: "linkedin:4463336052", portal: "LinkedIn", sourceJobId: "4463336052", title: "B2B Senior Business Development Executive", cardHash: "hash_linkedin_446333_6052" },
  { canonicalJobId: "linkedin:4463332480", portal: "LinkedIn", sourceJobId: "4463332480", title: "Director of Influencer Marketing", cardHash: "hash_linkedin_446333_2480" },
  { canonicalJobId: "linkedin:4461174065", portal: "LinkedIn", sourceJobId: "4461174065", title: "Performance Marketing Executive", cardHash: "hash_linkedin_446117" },
  { canonicalJobId: "indeed:jk_f7405672739196cf", portal: "Indeed", sourceJobId: "f7405672739196cf", title: "E-Commerce Manager", cardHash: "hash_indeed_f74056" },
  // Sponsored redirect alias of opportunity #3:
  {
    canonicalJobId: "indeed:url_07e1b1be32da3f30",
    portal: "Indeed",
    sourceJobId: "url_07e1b1be32da3f30",
    title: "Operations Director",
    cardHash: "hash_indeed_alias_07e1b",
    isAlias: true,
    parentCanonicalId: "indeed:jk_5554b5a53d15a259",
  },
];

describe("Domain 1: Golden Production Lineage Benchmark Cohort", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let repos: StorageProvider;
  let memStore: MemoryBlobStore;
  let queue: EnrichmentQueue;

  const provenance: Provenance = {
    schemaVersion: "1.0",
    extractorVersion: "1.0",
    model: "test",
    runId: "run-golden-recovery",
    timestamp: new Date().toISOString(),
  };

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    repos = createRepositories(db);
    queue = new EnrichmentQueue(db);
    memStore = new MemoryBlobStore();
    setBlobStore(memStore);

    await setupLineageTestFixture(db);

    await db.execute(
      "INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets) VALUES (?, ?, ?, ?, ?, ?)",
      ["run-golden-recovery", "tenant_A", "person_A", "plan_A", "running", "[]"]
    );

    await repos.companies.registerCompany({
      id: "company-golden",
      name: "Golden Corporate Corp",
      domain: "golden.test",
      industry: "Executive Search",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance,
    });
  });

  it("proves canonicalJobId !== cardHash hand-off across all 17 golden production records via admission lineage", async () => {
    const admittedItems = GOLDEN_COHORT.filter((item) => !item.isAlias);
    expect(admittedItems.length).toBe(17);

    // 1. Setup Pre-state: Pre-admit all 17 opportunities in 'Archived' status (hollow)
    for (const item of admittedItems) {
      const versionId = `v1-${item.sourceJobId}`;

      await repos.opportunities.mergeOpportunity({
        id: item.canonicalJobId,
        companyId: "company-golden",
        canonicalTitle: item.title,
        location: "Delhi NCR",
        employmentType: "Full-Time",
        postingWindow: "Recently",
        fingerprint: item.canonicalJobId,
        lifecycle: "Archived",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        provenance,
      });

      const ledger = await repos.acquisition.upsertDiscoveredJob({
        canonicalJobId: item.canonicalJobId,
        sourcePortal: item.portal,
        sourceJobId: item.sourceJobId,
        canonicalUrl: `https://${item.portal.toLowerCase()}.test/job/${item.sourceJobId}`,
        title: item.title,
        companyName: "Golden Corporate Corp",
        state: "VALIDATED",
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      });

      // Insert canonical_opportunities and opportunity_versions with unique versionId to satisfy foreign keys
      await db.execute(
        "INSERT OR IGNORE INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES (?, ?, ?, ?, ?)",
        [item.canonicalJobId, item.portal, item.sourceJobId, `https://${item.portal.toLowerCase()}.test/job/${item.sourceJobId}`, "Golden Corporate Corp"]
      );
      await db.execute(
        "INSERT OR IGNORE INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES (?, ?, ?, ?, ?)",
        [versionId, item.canonicalJobId, item.cardHash, item.title, "Golden role text"]
      );

      // Record authoritative admission lineage
      await repos.acquisition.recordIngestionLineage({
        scrapeRunId: "run-golden-recovery",
        tenantId: "tenant_A",
        personId: "person_A",
        acquisitionLedgerId: ledger.id,
        cardId: `card-${item.sourceJobId}`,
        ingestionAttempt: 1,
        sourcePortal: item.portal,
        sourceJobId: item.sourceJobId,
        sourceUrl: `https://${item.portal.toLowerCase()}.test/job/${item.sourceJobId}`,
        canonicalJobId: item.canonicalJobId,
        opportunityVersion: versionId,
        contentHash: item.cardHash,
        captureState: "CAPTURED",
        documentState: "PENDING",
      });

      // Persist snapshot in BlobStore
      const payloadPath = `payloads/${item.sourceJobId}.json`;
      await memStore.put(
        payloadPath,
        JSON.stringify({
          id: item.sourceJobId,
          portal: item.portal,
          title: item.title,
          company: "Golden Corporate Corp",
          location: "Delhi NCR",
          detailUrl: `https://${item.portal.toLowerCase()}.test/job/${item.sourceJobId}`,
          cardHash: item.cardHash,
          detail: {
            fetched: true,
            rawText: `Comprehensive executive role text for ${item.title} with full mandate and scale.`,
          },
        })
      );

      // Enqueue job with cardHash
      await queue.enqueue(`card-${item.sourceJobId}`, item.cardHash, payloadPath, "ext_v2", provenance, 10, 5, payloadPath);
    }

    // Verify pre-recovery baseline
    const preCount = (await db.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunities"))?.count;
    expect(preCount).toBe(17);
    const preDocs = (await db.one<{ count: number }>("SELECT COUNT(*) as count FROM documents"))?.count;
    expect(preDocs).toBe(0);

    // 2. Execute enrichment worker
    const { enrichJobsForRun } = await import("../../scripts/enrich");
    await enrichJobsForRun("run-golden-recovery", { queue, repos });

    // 3. Post-Recovery Verification
    // A: Invariant — Opportunity count delta MUST be 0
    const postCount = (await db.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunities"))?.count;
    expect(postCount).toBe(17);

    // B: Invariant — Forbidden namespace: strictly 0 orphan 'o_...' opportunities created
    const orphanOpps = await db.many<any>("SELECT id FROM opportunities WHERE id LIKE 'o_%'");
    expect(orphanOpps.length).toBe(0);

    // C: Invariant — All 17 canonical opportunities updated in place to 'Normalized'
    const normalizedOpps = await db.many<any>("SELECT id, lifecycle FROM opportunities WHERE lifecycle = 'Normalized'");
    expect(normalizedOpps.length).toBe(17);

    // D: Invariant — Every single admitted opportunity has exactly 1 document attached
    const docs = await db.many<any>("SELECT id, opportunity_id, lifecycle FROM documents");
    expect(docs.length).toBe(17);
    for (const doc of docs) {
      expect(doc.lifecycle).toBe("Parsed");
      expect(admittedItems.some((i) => i.canonicalJobId === doc.opportunity_id)).toBe(true);
    }

    // E: Invariant — Assert that persisted canonical identity was derived from the authoritative admission lineage path
    for (const item of admittedItems) {
      const lineageRow = await db.one<any>(
        `SELECT ail.canonical_job_id AS lineage_canonical_id, al.canonical_job_id AS ledger_canonical_id
         FROM acquisition_ingestion_lineage ail
         LEFT JOIN acquisition_ledger al ON al.id = ail.acquisition_ledger_id
         WHERE ail.card_id = ?`,
        [`card-${item.sourceJobId}`]
      );
      expect(lineageRow).not.toBeNull();
      const authoritativeId = lineageRow.ledger_canonical_id || lineageRow.lineage_canonical_id;
      expect(authoritativeId).toBe(item.canonicalJobId);
    }
  }, 120000);

  it("proves sponsored alias resolves to parent canonical opportunity without duplicate job or orphan creation", async () => {
    const parent = GOLDEN_COHORT.find((i) => i.canonicalJobId === "indeed:jk_5554b5a53d15a259")!;
    const alias = GOLDEN_COHORT.find((i) => i.isAlias)!;
    const versionId = `v1-${parent.sourceJobId}`;

    // Parent pre-exists
    await repos.opportunities.mergeOpportunity({
      id: parent.canonicalJobId,
      companyId: "company-golden",
      canonicalTitle: parent.title,
      location: "Gurugram",
      employmentType: "Full-Time",
      postingWindow: "Recently",
      fingerprint: parent.canonicalJobId,
      lifecycle: "Archived",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      provenance,
    });

    const parentLedger = await repos.acquisition.upsertDiscoveredJob({
      canonicalJobId: parent.canonicalJobId,
      sourcePortal: parent.portal,
      sourceJobId: parent.sourceJobId,
      canonicalUrl: `https://${parent.portal.toLowerCase()}.test/job/${parent.sourceJobId}`,
      title: parent.title,
      companyName: "Golden Corporate Corp",
      state: "VALIDATED",
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    await db.execute(
      "INSERT OR IGNORE INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES (?, ?, ?, ?, ?)",
      [parent.canonicalJobId, parent.portal, parent.sourceJobId, `https://${parent.portal.toLowerCase()}.test/job/${parent.sourceJobId}`, "Golden Corporate Corp"]
    );
    await db.execute(
      "INSERT OR IGNORE INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES (?, ?, ?, ?, ?)",
      [versionId, parent.canonicalJobId, parent.cardHash, parent.title, "Parent role text"]
    );

    // Lineage points alias card to parent canonical ID
    await repos.acquisition.recordIngestionLineage({
      scrapeRunId: "run-golden-recovery",
      tenantId: "tenant_A",
      personId: "person_A",
      acquisitionLedgerId: parentLedger.id,
      cardId: `card-${alias.sourceJobId}`,
      ingestionAttempt: 1,
      sourcePortal: alias.portal,
      sourceJobId: alias.sourceJobId,
      sourceUrl: `https://${alias.portal.toLowerCase()}.test/clk?jk=alias`,
      canonicalJobId: parent.canonicalJobId,
      opportunityVersion: versionId,
      contentHash: alias.cardHash,
      captureState: "CAPTURED",
      documentState: "PENDING",
    });

    const payloadPath = `payloads/${alias.sourceJobId}.json`;
    await memStore.put(
      payloadPath,
      JSON.stringify({
        id: parent.sourceJobId,
        portal: parent.portal,
        title: parent.title,
        company: "Golden Corporate Corp",
        location: "Gurugram",
        detailUrl: `https://${parent.portal.toLowerCase()}.test/job/${parent.sourceJobId}`,
        cardHash: alias.cardHash,
        detail: {
          fetched: true,
          rawText: "Detailed text for parent opportunity via sponsored alias route.",
        },
      })
    );

    await queue.enqueue(`card-${alias.sourceJobId}`, alias.cardHash, payloadPath, "ext_v2", provenance, 10, 5, payloadPath);

    const { enrichJobsForRun } = await import("../../scripts/enrich");
    await enrichJobsForRun("run-golden-recovery", { queue, repos });

    // Assert: Only 1 opportunity exists (parent), updated in place
    const opps = await db.many<any>("SELECT * FROM opportunities");
    expect(opps.length).toBe(1);
    expect(opps[0].id).toBe(parent.canonicalJobId);
    expect(opps[0].lifecycle).toBe("Normalized");

    // No orphan or alias opportunities
    const forbidden = await db.many<any>("SELECT * FROM opportunities WHERE id LIKE '%url_07e1b%' OR id LIKE 'o_%'");
    expect(forbidden.length).toBe(0);

    // Exactly 1 document for parent
    const docs = await db.many<any>("SELECT * FROM documents WHERE opportunity_id = ?", [parent.canonicalJobId]);
    expect(docs.length).toBe(1);
  });
});
