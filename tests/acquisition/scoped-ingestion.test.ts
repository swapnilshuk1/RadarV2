import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { SqliteAdapter } from "../../src/data/database/sqlite";

describe("authenticated canonical ingestion scope", () => {
  it("keeps the public canonical opportunity while projecting it only into the initiating tenant/person plan", async () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, status TEXT NOT NULL, criteria_json TEXT);
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
    `);
    const db = new SqliteAdapter(raw);
    const result = await new CanonicalIngestionService(db).ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "scoped-job",
      canonicalUrl: "https://www.linkedin.com/jobs/view/scoped-job",
      jobTitle: "VP Growth",
      companyName: "Acme",
      location: "Gurugram",
      rawContent: "VP Growth owns commercial growth, market strategy, revenue operations, and executive team leadership.",
    }, { tenantId: "tenant_A", personId: "person_A" });

    expect(result.plansEvaluated).toBe(1);
    expect(result.candidatesProjected).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities").get()).toEqual({ count: 1 });
    expect(raw.prepare("SELECT tenant_id, person_id, search_plan_id FROM search_plan_candidates").all()).toEqual([
      { tenant_id: "tenant_A", person_id: "person_A", search_plan_id: "plan_A" },
    ]);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM search_plan_candidates WHERE tenant_id = 'tenant_B'").get()).toEqual({ count: 0 });
  });

  it("keeps an access-denied response in acquisition evidence rather than creating a canonical market record", async () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, status TEXT NOT NULL, criteria_json TEXT);
      CREATE TABLE canonical_opportunities (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_job_id TEXT NOT NULL, canonical_url TEXT, company_name TEXT, created_at TEXT, last_seen_at TEXT, UNIQUE(source, source_job_id));
      CREATE TABLE opportunity_versions (id TEXT PRIMARY KEY, canonical_job_id TEXT NOT NULL, content_hash TEXT NOT NULL, job_title TEXT, company_name TEXT, location TEXT, employment_type TEXT, posted_at TEXT, posted_precision TEXT, raw_content TEXT, acquisition_status TEXT, acquisition_quality TEXT, failure_class TEXT, lifecycle_state TEXT, evidence_state TEXT, source_payload_key TEXT, source_media_type TEXT, document_extraction_state TEXT, category_ids TEXT, created_at TEXT, UNIQUE(canonical_job_id, content_hash));
      CREATE TABLE search_plan_candidates (tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, search_plan_id TEXT NOT NULL, canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL, attention_decision TEXT NOT NULL, eligibility TEXT, eligibility_reason_codes_json TEXT, location_policy TEXT, location_evidence TEXT, created_at TEXT, PRIMARY KEY(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version));
      CREATE TABLE evaluation_jobs (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT, opportunity_version TEXT, evaluation_context_fingerprint TEXT, status TEXT, attempts INTEGER, max_attempts INTEGER, next_attempt_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint));
      CREATE TABLE active_evaluation_contexts (tenant_id TEXT, person_id TEXT, search_plan_id TEXT, context_fingerprint TEXT);
      CREATE TABLE evaluation_contexts (context_fingerprint TEXT, tenant_id TEXT, person_id TEXT);
      CREATE TABLE recovery_queue (id TEXT PRIMARY KEY, tenant_id TEXT, canonical_job_id TEXT, opportunity_version_id TEXT, source TEXT, canonical_url TEXT, reason TEXT, failure_class TEXT, attempt_count INTEGER, status TEXT, next_attempt_at TEXT, created_at TEXT);
      INSERT INTO tenants VALUES ('tenant_A');
      INSERT INTO people VALUES ('person_A', 'tenant_A');
      INSERT INTO search_plans VALUES ('plan_A', 'tenant_A', 'person_A', 'active', '{}');
    `);
    const service = new CanonicalIngestionService(new SqliteAdapter(raw));

    await expect(service.ingestOpportunity({
      sourcePortal: "LinkedIn", sourceJobId: "blocked-job", canonicalUrl: "https://www.linkedin.com/jobs/view/blocked-job",
      jobTitle: "VP Growth", companyName: "Acme", location: "Gurugram",
      rawContent: "Security verification required. Please wait while we verify your request.".repeat(10), httpStatus: 403,
    }, { tenantId: "tenant_A", personId: "person_A" })).rejects.toThrow("Cannot canonically ingest unusable document");

    expect(raw.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM opportunity_versions").get()).toEqual({ count: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM search_plan_candidates").get()).toEqual({ count: 0 });
  });
});
