import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { SqliteAdapter } from "../../src/data/database/sqlite";

describe("authenticated canonical ingestion scope", () => {
  function createScopedTestDatabase() {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, status TEXT NOT NULL, criteria_json TEXT);
      CREATE TABLE scrape_runs (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_id TEXT, status TEXT, portal_targets TEXT, started_at TEXT, finished_at TEXT, error_message TEXT);
      CREATE TABLE canonical_opportunities (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_job_id TEXT NOT NULL, canonical_url TEXT, company_name TEXT, created_at TEXT, last_seen_at TEXT, UNIQUE(source, source_job_id));
      CREATE TABLE opportunity_versions (
        id TEXT PRIMARY KEY, canonical_job_id TEXT NOT NULL, content_hash TEXT NOT NULL, job_title TEXT, company_name TEXT,
        location TEXT, employment_type TEXT, posted_at TEXT, posted_precision TEXT, raw_content TEXT,
        acquisition_status TEXT, acquisition_quality TEXT, failure_class TEXT, lifecycle_state TEXT, evidence_state TEXT,
        source_payload_key TEXT, source_media_type TEXT, document_extraction_state TEXT, category_ids TEXT, created_at TEXT,
        UNIQUE(canonical_job_id, content_hash)
      );
      CREATE TABLE search_plan_candidates (
        tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, search_plan_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL, attention_decision TEXT NOT NULL,
        eligibility TEXT, eligibility_reason_codes_json TEXT, location_policy TEXT, location_evidence TEXT, created_at TEXT,
        PRIMARY KEY(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
      );
      CREATE TABLE evaluation_jobs (
        id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT,
        opportunity_version TEXT, evaluation_context_fingerprint TEXT, status TEXT, attempts INTEGER, max_attempts INTEGER,
        next_attempt_at TEXT, created_at TEXT, updated_at TEXT,
        UNIQUE(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
      );
      CREATE TABLE evaluation_requirements (
        id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT,
        opportunity_version TEXT, required_enrichment_pipeline_version TEXT,
        evaluation_context_fingerprint TEXT, status TEXT, blocked_reason TEXT, created_at TEXT, updated_at TEXT,
        UNIQUE(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
      );
      CREATE TABLE scrape_run_evaluation_requirements (
        run_id TEXT, evaluation_requirement_id TEXT,
        PRIMARY KEY(run_id, evaluation_requirement_id)
      );
      CREATE TABLE scrape_run_enrichment_requirements (
        run_id TEXT, enrichment_job_id TEXT,
        PRIMARY KEY(run_id, enrichment_job_id)
      );
      CREATE TABLE active_evaluation_contexts (tenant_id TEXT, person_id TEXT, search_plan_id TEXT, context_fingerprint TEXT);
      CREATE TABLE evaluation_contexts (context_fingerprint TEXT, tenant_id TEXT, person_id TEXT);
      CREATE TABLE recovery_queue (id TEXT PRIMARY KEY, tenant_id TEXT, canonical_job_id TEXT, opportunity_version_id TEXT, source TEXT, canonical_url TEXT, reason TEXT, failure_class TEXT, attempt_count INTEGER, status TEXT, next_attempt_at TEXT, created_at TEXT);

      INSERT INTO tenants VALUES ('tenant_A'), ('tenant_B');
      INSERT INTO people VALUES ('person_A', 'tenant_A'), ('person_B', 'tenant_B');
      INSERT INTO search_plans VALUES
        ('plan_A', 'tenant_A', 'person_A', 'active', '{"targetSeniority":["VP"],"targetRoles":["VP Growth"],"targetLocations":["Gurugram"]}'),
        ('plan_B', 'tenant_B', 'person_B', 'active', '{"targetSeniority":["VP"],"targetRoles":["VP Growth"],"targetLocations":["Gurugram"]}');
      INSERT INTO active_evaluation_contexts VALUES ('tenant_A', 'person_A', 'plan_A', 'ctx_A'), ('tenant_B', 'person_B', 'plan_B', 'ctx_B');
      INSERT INTO evaluation_contexts VALUES ('ctx_A', 'tenant_A', 'person_A'), ('ctx_B', 'tenant_B', 'person_B');
      INSERT INTO scrape_runs VALUES ('run_A', 'tenant_A', 'person_A', 'plan_A', 'completed', '[]', datetime('now'), datetime('now'), NULL);
    `);
    return { raw, db: new SqliteAdapter(raw) };
  }

  const SUBSTANTIVE_TEXT = "VP Growth owns commercial growth, market strategy, revenue operations, and executive team leadership across multi-region enterprise markets with full P&L oversight, cross-functional organizational accountability, and high-impact board governance.";

  it("keeps the public canonical opportunity while projecting it only into the initiating tenant/person plan", async () => {
    const { raw, db } = createScopedTestDatabase();
    const result = await new CanonicalIngestionService(db).ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "scoped-job",
      canonicalUrl: "https://www.linkedin.com/jobs/view/scoped-job",
      jobTitle: "VP Growth",
      companyName: "Acme",
      location: "Gurugram",
      rawContent: SUBSTANTIVE_TEXT,
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" });

    expect(result.plansEvaluated).toBe(1);
    expect(result.candidatesProjected).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities").get()).toEqual({ count: 1 });
    expect(raw.prepare("SELECT tenant_id, person_id, search_plan_id FROM search_plan_candidates").all()).toEqual([
      { tenant_id: "tenant_A", person_id: "person_A", search_plan_id: "plan_A" },
    ]);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM search_plan_candidates WHERE tenant_id = 'tenant_B'").get()).toEqual({ count: 0 });

    const indeedPayload = {
      sourcePortal: "Indeed" as const,
      sourceJobId: "provisional-sponsored-observation",
      canonicalUrl: "https://in.indeed.com/pagead/clk?tracking=opaque",
      finalUrl: "https://in.indeed.com/viewjob?jk=ABC123&from=pagead",
      jobTitle: "VP Growth",
      companyName: "Acme",
      location: "Gurugram",
      rawContent: SUBSTANTIVE_TEXT,
    };
    const indeedService = new CanonicalIngestionService(db);
    await indeedService.ingestOpportunity(indeedPayload, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" });
    await indeedService.ingestOpportunity({
      ...indeedPayload,
      sourceJobId: "caller-value-is-not-identity",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=ABC123",
      finalUrl: undefined,
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities WHERE source = 'Indeed'").get()).toEqual({ count: 1 });

    await indeedService.ingestOpportunity({
      ...indeedPayload,
      sourceJobId: "another-provisional-value",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=XYZ789",
      finalUrl: undefined,
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities WHERE source = 'Indeed'").get()).toEqual({ count: 2 });

    await expect(indeedService.ingestOpportunity({
      ...indeedPayload,
      sourceJobId: "unverified-sponsored-observation",
      finalUrl: undefined,
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" })).rejects.toThrow("verified external listing identity");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities WHERE source = 'Indeed'").get()).toEqual({ count: 2 });
  });

  it("keeps an access-denied response in acquisition evidence rather than creating a canonical market record", async () => {
    const { raw, db } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db);

    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "blocked-job", canonicalUrl: "https://www.linkedin.com/jobs/view/blocked-job",
      jobTitle: "VP Growth", companyName: "Acme", location: "Gurugram",
      rawContent: "Security verification required. Please wait while we verify your request.".repeat(10), httpStatus: 403,
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" })).rejects.toThrow("Cannot canonically ingest unusable document");

    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM opportunity_versions").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM search_plan_candidates").get()).toEqual({ count: 0 });
  });

  it("rejects partial acquisition scope with PARTIAL_SCOPE_REJECTED", async () => {
    const { db } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db);

    // Missing searchPlanId
    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "partial-scope-job-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/ps1", jobTitle: "VP Growth", companyName: "Acme",
      rawContent: SUBSTANTIVE_TEXT,
    }, { tenantId: "tenant_A", personId: "person_A" } as any)).rejects.toThrow("PARTIAL_SCOPE_REJECTED");

    // Missing tenantId
    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "partial-scope-job-2",
      canonicalUrl: "https://www.linkedin.com/jobs/view/ps2", jobTitle: "VP Growth", companyName: "Acme",
      rawContent: SUBSTANTIVE_TEXT,
    }, { personId: "person_A", searchPlanId: "plan_A" } as any)).rejects.toThrow("PARTIAL_SCOPE_REJECTED");
  });

  it("enforces strict character boundaries and positive provenance", async () => {
    const { raw, db } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db);

    // Tier 1: 0-49 chars -> UNUSABLE (INSUFFICIENT_CONTENT)
    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "sparse-49", canonicalUrl: "https://linkedin.com/jobs/49",
      jobTitle: "VP Engineering", companyName: "Acme",
      rawContent: "1234567890123456789012345678901234567890123456789", // 49 chars
      contentOrigin: "DETAIL_DOCUMENT",
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" })).rejects.toThrow("INSUFFICIENT_CONTENT");

    // Tier 2: 50-199 chars + DETAIL_DOCUMENT -> valid GENUINELY_SPARSE
    const res50 = await service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "sparse-50", canonicalUrl: "https://linkedin.com/jobs/50",
      jobTitle: "VP Engineering", companyName: "Acme",
      rawContent: "Independent Board Advisor. Advisory role for Series B fintech startup. Two hours per month.", // 91 chars
      contentOrigin: "DETAIL_DOCUMENT",
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" });
    expect(res50.canonicalJobId).toBeDefined();
    const versionRow = raw.prepare("SELECT acquisition_quality FROM opportunity_versions WHERE canonical_job_id = ?").get(res50.canonicalJobId) as any;
    expect(versionRow.acquisition_quality).toBe("MINIMAL");

    // Tier 3: 50-199 chars + DISCOVERY_CARD_FALLBACK -> UNUSABLE (PARTIAL_CONTENT)
    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "sparse-fallback", canonicalUrl: "https://linkedin.com/jobs/fallback",
      jobTitle: "VP Engineering", companyName: "Acme",
      rawContent: "Independent Board Advisor. Advisory role for Series B fintech startup. Two hours per month.", // 91 chars
      contentOrigin: "DISCOVERY_CARD_FALLBACK",
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" })).rejects.toThrow("PARTIAL_CONTENT");

    // Tier 4: >= 200 chars -> valid SUBSTANTIVE
    const res200 = await service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "substantive-200", canonicalUrl: "https://linkedin.com/jobs/200",
      jobTitle: "VP Engineering", companyName: "Acme",
      rawContent: SUBSTANTIVE_TEXT,
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" });
    expect(res200.canonicalJobId).toBeDefined();
  });

  it("validates verifiedRunId against scrape_runs scope and rejects mismatches", async () => {
    const { db } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db);

    // Mismatched runId -> RUN_SCOPE_MISMATCH
    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "mismatch-run-job", canonicalUrl: "https://linkedin.com/jobs/mismatch",
      jobTitle: "VP Growth", companyName: "Acme",
      rawContent: SUBSTANTIVE_TEXT,
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A", runId: "non-existent-run" }))
      .rejects.toThrow("RUN_SCOPE_MISMATCH");

    // Matching runId -> successfully ingests and attaches
    const res = await service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "matching-run-job", canonicalUrl: "https://linkedin.com/jobs/matching",
      jobTitle: "VP Growth", companyName: "Acme",
      rawContent: SUBSTANTIVE_TEXT,
    }, { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A", runId: "run_A" });
    expect(res.canonicalJobId).toBeDefined();
  });

  it("supports explicit GLOBAL_MARKET mode without projecting search plan candidates", async () => {
    const { raw, db } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db);

    const res = await service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "global-market-job", canonicalUrl: "https://linkedin.com/jobs/global",
      jobTitle: "Chief Technology Officer", companyName: "Global Tech",
      rawContent: SUBSTANTIVE_TEXT,
    }, { mode: "GLOBAL_MARKET" });

    expect(res.canonicalJobId).toBeDefined();
    expect(res.plansEvaluated).toBe(0);
    expect(res.candidatesProjected).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities WHERE id = ?").get(res.canonicalJobId)).toEqual({ count: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM search_plan_candidates WHERE canonical_job_id = ?").get(res.canonicalJobId)).toEqual({ count: 0 });
  });
});
