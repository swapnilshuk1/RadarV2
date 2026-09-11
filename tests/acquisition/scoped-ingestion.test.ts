import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { MemoryBlobStore } from "../../src/lib/storage/blob-store";
import {
  EXTRACTOR_VERSION,
  SCRAPER_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "../../scripts/scraper/versions";

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
      CREATE TABLE enrichment_jobs (
        id TEXT PRIMARY KEY,
        job_hash TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL,
        opportunity_version TEXT NOT NULL,
        pipeline_version TEXT NOT NULL,
        snapshot_path TEXT,
        payload_key TEXT NOT NULL,
        run_id TEXT,
        execution_plan_id TEXT,
        definition_id TEXT,
        family_id TEXT,
        portal TEXT,
        page INTEGER,
        catalog_version TEXT,
        planner_version TEXT,
        rule_version TEXT,
        search_query TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        business_priority INTEGER DEFAULT 10,
        execution_priority INTEGER DEFAULT 0,
        created_at TEXT,
        UNIQUE(canonical_job_id, opportunity_version, pipeline_version)
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
      INSERT INTO scrape_runs VALUES (
        'run_A',
        'tenant_A',
        'person_A',
        'plan_A',
        'running',
        '[]',
        datetime('now'),
        NULL,
        NULL
      );
    `);
    const blobStore = new MemoryBlobStore();
    return { raw, db: new SqliteAdapter(raw), blobStore };
  }

  const SCOPE_A = {
    mode: "SCOPED" as const,
    tenantId: "tenant_A",
    personId: "person_A",
    searchPlanId: "plan_A",
    runId: "run_A",
  };

  const GLOBAL_SCOPE = {
    mode: "GLOBAL_MARKET" as const,
  };

  function makeEnrichmentDispatch(
    sourceJobId: string,
    title: string,
    company: string,
    location: string,
    rawText: string,
    portal: "LinkedIn" | "Indeed" = "LinkedIn",
  ) {
    const isIndeed = portal === "Indeed";
    const detailUrl = isIndeed
      ? `https://in.indeed.com/viewjob?jk=${sourceJobId}`
      : `https://www.linkedin.com/jobs/view/${sourceJobId}`;
    return {
      pipelineVersion: EXTRACTOR_VERSION,
      detailedCard: {
        cardHash: `test-${sourceJobId}`,
        sourceJobId,
        portal,
        keyword: title,
        searchUrl: isIndeed ? "https://in.indeed.com/jobs" : "https://www.linkedin.com/jobs/search/",
        discoveryUrl: detailUrl,
        detailUrl,
        discoveredAt: "2026-01-01T00:00:00.000Z",
        title,
        company,
        location,
        rawHtml: "",
        rawText,
        snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
        scraperVersion: SCRAPER_VERSION,
        detail: {
          fetched: true,
          rawHtml: "",
          rawText,
          extractedTitle: title,
          extractedCompany: company,
          finalUrl: detailUrl,
        },
        telemetry: {
          cardExtractMs: 0,
          detailExtractMs: 0,
          totalMs: 0,
        },
      },
    };
  }

  const SUBSTANTIVE_TEXT = "VP Growth owns commercial growth, market strategy, revenue operations, and executive team leadership across multi-region enterprise markets with full P&L oversight, cross-functional organizational accountability, and high-impact board governance.";

  it("keeps the public canonical opportunity while projecting it only into the initiating tenant/person plan", async () => {
    const { raw, db, blobStore } = createScopedTestDatabase();
    const result = await new CanonicalIngestionService(db, blobStore).ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "scoped-job",
      canonicalUrl: "https://www.linkedin.com/jobs/view/scoped-job",
      jobTitle: "VP Growth",
      companyName: "Acme",
      location: "Gurugram",
      rawContent: SUBSTANTIVE_TEXT,
      contentOrigin: "DETAIL_DOCUMENT",
      enrichmentDispatch: makeEnrichmentDispatch("scoped-job", "VP Growth", "Acme", "Gurugram", SUBSTANTIVE_TEXT, "LinkedIn"),
    }, SCOPE_A);

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
      contentOrigin: "DETAIL_DOCUMENT" as const,
      enrichmentDispatch: makeEnrichmentDispatch("ABC123", "VP Growth", "Acme", "Gurugram", SUBSTANTIVE_TEXT, "Indeed"),
    };
    const indeedService = new CanonicalIngestionService(db, blobStore);
    await indeedService.ingestOpportunity(indeedPayload, SCOPE_A);
    await indeedService.ingestOpportunity({
      ...indeedPayload,
      sourceJobId: "caller-value-is-not-identity",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=ABC123",
      finalUrl: undefined,
      enrichmentDispatch: makeEnrichmentDispatch("ABC123", "VP Growth", "Acme", "Gurugram", SUBSTANTIVE_TEXT, "Indeed"),
    }, SCOPE_A);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities WHERE source = 'Indeed'").get()).toEqual({ count: 1 });

    await indeedService.ingestOpportunity({
      ...indeedPayload,
      sourceJobId: "another-provisional-value",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=XYZ789",
      finalUrl: undefined,
      enrichmentDispatch: makeEnrichmentDispatch("XYZ789", "VP Growth", "Acme", "Gurugram", SUBSTANTIVE_TEXT, "Indeed"),
    }, SCOPE_A);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities WHERE source = 'Indeed'").get()).toEqual({ count: 2 });

    await expect(indeedService.ingestOpportunity({
      ...indeedPayload,
      sourceJobId: "unverified-sponsored-observation",
      finalUrl: undefined,
    }, SCOPE_A)).rejects.toThrow("verified external listing identity");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities WHERE source = 'Indeed'").get()).toEqual({ count: 2 });
  });

  it("keeps an access-denied response in acquisition evidence rather than creating a canonical market record", async () => {
    const { raw, db, blobStore } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db, blobStore);

    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "blocked-job", canonicalUrl: "https://www.linkedin.com/jobs/view/blocked-job",
      jobTitle: "VP Growth", companyName: "Acme", location: "Gurugram",
      rawContent: "Security verification required. Please wait while we verify your request.".repeat(10), httpStatus: 403,
    }, SCOPE_A)).rejects.toThrow("Cannot canonically ingest unusable document");

    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM opportunity_versions").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM search_plan_candidates").get()).toEqual({ count: 0 });
  });

  it("rejects partial acquisition scope with PARTIAL_SCOPE_REJECTED", async () => {
    const { db, blobStore } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db, blobStore);

    const testPayload = {
      sourcePortal: "LinkedIn" as const,
      sourceJobId: "partial-scope-job-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/ps1",
      jobTitle: "VP Growth",
      companyName: "Acme",
      location: "Gurugram",
      rawContent: SUBSTANTIVE_TEXT,
      contentOrigin: "DETAIL_DOCUMENT" as const,
      enrichmentDispatch: makeEnrichmentDispatch("partial-scope-job-1", "VP Growth", "Acme", "Gurugram", SUBSTANTIVE_TEXT),
    };

    // Missing searchPlanId
    await expect(service.ingestOpportunity(testPayload, {
      mode: "SCOPED",
      tenantId: "tenant_A",
      personId: "person_A",
      runId: "run_A",
    } as any)).rejects.toThrow("PARTIAL_SCOPE_REJECTED");

    // Missing tenantId
    await expect(service.ingestOpportunity({
      ...testPayload,
      sourceJobId: "partial-scope-job-2",
      canonicalUrl: "https://www.linkedin.com/jobs/view/ps2",
    }, {
      mode: "SCOPED",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: "run_A",
    } as any)).rejects.toThrow("PARTIAL_SCOPE_REJECTED");

    // Missing runId
    await expect(service.ingestOpportunity({
      ...testPayload,
      sourceJobId: "partial-scope-job-3",
      canonicalUrl: "https://www.linkedin.com/jobs/view/ps3",
    }, {
      mode: "SCOPED",
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
    } as any)).rejects.toThrow("PARTIAL_SCOPE_REJECTED");

    // Malformed no mode
    await expect(
      service.ingestOpportunity(
        testPayload,
        {
          tenantId: "tenant_A",
          personId: "person_A",
          searchPlanId: "plan_A",
          runId: "run_A",
        } as any,
      ),
    ).rejects.toThrow("MALFORMED_SCOPE_REJECTED");
  });

  it("enforces strict character boundaries and positive provenance", async () => {
    const { raw, db, blobStore } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db, blobStore);

    // Tier 1: 0-49 chars -> UNUSABLE (INSUFFICIENT_CONTENT)
    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "sparse-49", canonicalUrl: "https://linkedin.com/jobs/49",
      jobTitle: "VP Engineering", companyName: "Acme", location: "Gurugram",
      rawContent: "1234567890123456789012345678901234567890123456789", // 49 chars
      contentOrigin: "DETAIL_DOCUMENT",
    }, SCOPE_A)).rejects.toThrow("INSUFFICIENT_CONTENT");

    // Tier 2: 50-199 chars + DETAIL_DOCUMENT -> valid GENUINELY_SPARSE
    const sparseText = "Independent Board Advisor. Advisory role for Series B fintech startup. Two hours per month."; // 91 chars
    const res50 = await service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "sparse-50", canonicalUrl: "https://linkedin.com/jobs/50",
      jobTitle: "VP Engineering", companyName: "Acme", location: "Gurugram",
      rawContent: sparseText,
      contentOrigin: "DETAIL_DOCUMENT",
      enrichmentDispatch: makeEnrichmentDispatch("sparse-50", "VP Engineering", "Acme", "Gurugram", sparseText),
    }, SCOPE_A);
    expect(res50.canonicalJobId).toBeDefined();
    const versionRow = raw.prepare("SELECT acquisition_quality FROM opportunity_versions WHERE canonical_job_id = ?").get(res50.canonicalJobId) as any;
    expect(versionRow.acquisition_quality).toBe("MINIMAL");

    // Tier 3: 50-199 chars + DISCOVERY_CARD_FALLBACK -> UNUSABLE (PARTIAL_CONTENT)
    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "sparse-fallback", canonicalUrl: "https://linkedin.com/jobs/fallback",
      jobTitle: "VP Engineering", companyName: "Acme", location: "Gurugram",
      rawContent: sparseText,
      contentOrigin: "DISCOVERY_CARD_FALLBACK",
    }, SCOPE_A)).rejects.toThrow("PARTIAL_CONTENT");

    // Tier 4: >= 200 chars -> valid SUBSTANTIVE
    const res200 = await service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "substantive-200", canonicalUrl: "https://linkedin.com/jobs/200",
      jobTitle: "VP Engineering", companyName: "Acme", location: "Gurugram",
      rawContent: SUBSTANTIVE_TEXT,
      contentOrigin: "DETAIL_DOCUMENT",
      enrichmentDispatch: makeEnrichmentDispatch("substantive-200", "VP Engineering", "Acme", "Gurugram", SUBSTANTIVE_TEXT),
    }, SCOPE_A);
    expect(res200.canonicalJobId).toBeDefined();
  });

  it("validates verifiedRunId against scrape_runs scope and rejects mismatches", async () => {
    const { raw, db, blobStore } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db, blobStore);

    const usablePayloadWithDispatch = {
      sourcePortal: "LinkedIn" as const,
      sourceJobId: "matching-run-job",
      canonicalUrl: "https://linkedin.com/jobs/matching",
      jobTitle: "VP Growth",
      companyName: "Acme",
      location: "Gurugram",
      rawContent: SUBSTANTIVE_TEXT,
      contentOrigin: "DETAIL_DOCUMENT" as const,
      enrichmentDispatch: makeEnrichmentDispatch("matching-run-job", "VP Growth", "Acme", "Gurugram", SUBSTANTIVE_TEXT),
    };

    // Missing/nonexistent run -> RUN_SCOPE_MISMATCH
    await expect(
      service.ingestOpportunity(
        usablePayloadWithDispatch,
        {
          mode: "SCOPED",
          tenantId: "tenant_A",
          personId: "person_A",
          searchPlanId: "plan_A",
          runId: "non-existent-run",
        },
      ),
    ).rejects.toThrow("RUN_SCOPE_MISMATCH");

    // Matching active run -> successfully ingests and attaches
    const res = await service.ingestOpportunity(
      usablePayloadWithDispatch,
      SCOPE_A,
    );
    expect(res.canonicalJobId).toBeDefined();

    // Terminal-state test: completed run rejects canonical admission
    raw.prepare(`
      UPDATE scrape_runs
      SET status = 'completed'
      WHERE id = 'run_A'
    `).run();

    const anotherUsablePayloadWithDispatch = {
      sourcePortal: "LinkedIn" as const,
      sourceJobId: "another-scoped-job",
      canonicalUrl: "https://www.linkedin.com/jobs/view/another-scoped-job",
      jobTitle: "VP Growth",
      companyName: "Acme",
      location: "Gurugram",
      rawContent: SUBSTANTIVE_TEXT,
      contentOrigin: "DETAIL_DOCUMENT" as const,
      enrichmentDispatch: makeEnrichmentDispatch("another-scoped-job", "VP Growth", "Acme", "Gurugram", SUBSTANTIVE_TEXT),
    };

    await expect(
      service.ingestOpportunity(
        anotherUsablePayloadWithDispatch,
        SCOPE_A,
      ),
    ).rejects.toThrow(/must be 'running'|RUN_STATUS_INVALID/);
  });

  it("supports explicit GLOBAL_MARKET mode without projecting search plan candidates", async () => {
    const { raw, db, blobStore } = createScopedTestDatabase();
    const service = new CanonicalIngestionService(db, blobStore);

    const res = await service.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "global-market-job",
      canonicalUrl: "https://linkedin.com/jobs/global",
      jobTitle: "Chief Technology Officer",
      companyName: "Global Tech",
      location: "Gurugram",
      rawContent: SUBSTANTIVE_TEXT,
      contentOrigin: "DETAIL_DOCUMENT",
      enrichmentDispatch: makeEnrichmentDispatch("global-market-job", "Chief Technology Officer", "Global Tech", "Gurugram", SUBSTANTIVE_TEXT),
    }, GLOBAL_SCOPE);

    expect(res.canonicalJobId).toBeDefined();
    expect(res.plansEvaluated).toBe(0);
    expect(res.candidatesProjected).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities WHERE id = ?").get(res.canonicalJobId)).toEqual({ count: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM search_plan_candidates WHERE canonical_job_id = ?").get(res.canonicalJobId)).toEqual({ count: 0 });
  });
});
