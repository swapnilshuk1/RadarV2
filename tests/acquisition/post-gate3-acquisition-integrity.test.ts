import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { sourceIdentityForCard, acquisitionSurfaceKey } from "../../src/lib/acquisition/canonical-identity";
import { RunController } from "../../scripts/scraper/run/manager";

function createInMemoryDatabase() {
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
    CREATE TABLE enrichment_jobs (
      id TEXT PRIMARY KEY, job_hash TEXT NOT NULL, canonical_job_id TEXT NOT NULL,
      opportunity_version TEXT NOT NULL, pipeline_version TEXT NOT NULL, snapshot_path TEXT NOT NULL,
      payload_key TEXT, run_id TEXT, execution_plan_id TEXT, definition_id TEXT, family_id TEXT,
      portal TEXT, page INTEGER, catalog_version TEXT, planner_version TEXT, rule_version TEXT,
      search_query TEXT, status TEXT NOT NULL, business_priority INTEGER, execution_priority INTEGER,
      locked_by TEXT, locked_at TEXT, lease_expires_at TEXT, attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3, error_message TEXT, created_at TEXT, updated_at TEXT,
      UNIQUE(canonical_job_id, opportunity_version, pipeline_version)
    );
    CREATE TABLE scrape_run_enrichment_requirements (
      run_id TEXT NOT NULL, enrichment_job_id TEXT NOT NULL,
      PRIMARY KEY(run_id, enrichment_job_id)
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
    CREATE TABLE active_evaluation_contexts (tenant_id TEXT, person_id TEXT, search_plan_id TEXT, context_fingerprint TEXT);
    CREATE TABLE evaluation_contexts (context_fingerprint TEXT, tenant_id TEXT, person_id TEXT);
    CREATE TABLE recovery_queue (id TEXT PRIMARY KEY, tenant_id TEXT, canonical_job_id TEXT, opportunity_version_id TEXT, source TEXT, canonical_url TEXT, reason TEXT, failure_class TEXT, attempt_count INTEGER, status TEXT, next_attempt_at TEXT, created_at TEXT);

    INSERT INTO tenants VALUES ('tenant_A');
    INSERT INTO people VALUES ('person_A', 'tenant_A');
    INSERT INTO search_plans VALUES
      ('plan_A', 'tenant_A', 'person_A', 'active', '{"targetSeniority":["VP"],"targetRoles":["VP Growth"],"targetLocations":["Gurugram"]}');
    INSERT INTO active_evaluation_contexts VALUES ('tenant_A', 'person_A', 'plan_A', 'ctx_A');
    INSERT INTO evaluation_contexts VALUES ('ctx_A', 'tenant_A', 'person_A');
  `);
  return { raw, db: new SqliteAdapter(raw) };
}

describe("Post-Gate-3 Acquisition & Enrichment Integrity", () => {
  it("always creates an enrichment job for a usable canonical version even when Attention Gate is NOT_CANDIDATE", async () => {
    const { raw, db } = createInMemoryDatabase();
    raw.exec(`UPDATE search_plans SET criteria_json = '{"targetSeniority":["CXO"],"targetRoles":["CTO"]}' WHERE id = 'plan_A'`);

    const service = new CanonicalIngestionService(db);
    const result = await service.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "job-101",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-101",
      jobTitle: "Junior Software Engineer",
      companyName: "Acme Corp",
      location: "San Francisco, CA",
      rawContent: "Junior engineer writing basic tests and fixing bugs.".repeat(10),
      enrichmentDispatch: {
        detailedCard: { cardHash: "card-101" } as any,
        runId: "run-001",
      },
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: "run-001",
    });

    expect(result.candidateDecisions["plan_A"]).toBe("NOT_CANDIDATE");

    const evalReqs = raw.prepare("SELECT * FROM evaluation_requirements").all();
    expect(evalReqs.length).toBe(0);

    const enrichmentJobs = raw.prepare("SELECT * FROM enrichment_jobs").all() as any[];
    expect(enrichmentJobs.length).toBe(1);
    expect(enrichmentJobs[0].canonical_job_id).toBe(result.canonicalJobId);

    const runEnrichmentBindings = raw.prepare("SELECT * FROM scrape_run_enrichment_requirements WHERE run_id = 'run-001'").all() as any[];
    expect(runEnrichmentBindings.length).toBe(1);
    expect(runEnrichmentBindings[0].enrichment_job_id).toBe(enrichmentJobs[0].id);
  });

  it("creates a new run binding when an existing canonical version is reused across runs", async () => {
    const { raw, db } = createInMemoryDatabase();
    const service = new CanonicalIngestionService(db);

    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-202",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-202",
      jobTitle: "VP Growth",
      companyName: "HyperGrowth Inc",
      location: "Gurugram",
      rawContent: "Executive leadership role driving user acquisition, P&L, and team growth.".repeat(10),
    };

    const resA = await service.ingestOpportunity({
      ...payload,
      enrichmentDispatch: {
        detailedCard: { cardHash: "card-202" } as any,
        runId: "run-A",
      },
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: "run-A",
    });

    expect(resA.isNewOpportunity).toBe(true);
    expect(resA.isNewVersion).toBe(true);

    const bindingsA = raw.prepare("SELECT * FROM scrape_run_enrichment_requirements WHERE run_id = 'run-A'").all();
    expect(bindingsA.length).toBe(1);

    const resB = await service.ingestOpportunity({
      ...payload,
      enrichmentDispatch: {
        detailedCard: { cardHash: "card-202" } as any,
        runId: "run-B",
      },
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: "run-B",
    });

    expect(resB.isNewOpportunity).toBe(false);
    expect(resB.isNewVersion).toBe(false);
    expect(resB.opportunityVersion).toBe(resA.opportunityVersion);

    const bindingsB = raw.prepare("SELECT * FROM scrape_run_enrichment_requirements WHERE run_id = 'run-B'").all() as any[];
    expect(bindingsB.length).toBe(1);
    expect(bindingsB[0].enrichment_job_id).toBe((bindingsA[0] as any).enrichment_job_id);
  });

  it("marks a new candidate requirement immediately READY when the enrichment job is already COMPLETE", async () => {
    const { raw, db } = createInMemoryDatabase();
    const service = new CanonicalIngestionService(db);

    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-303",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-303",
      jobTitle: "VP Growth",
      companyName: "FinTech Prime",
      location: "Gurugram",
      rawContent: "Executive VP Growth leading strategic expansion and marketing initiatives.".repeat(10),
    };

    const res1 = await service.ingestOpportunity({
      ...payload,
      enrichmentDispatch: {
        detailedCard: { cardHash: "card-303" } as any,
        runId: "run-1",
      },
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: "run-1",
    });

    const req1 = raw.prepare("SELECT * FROM evaluation_requirements WHERE canonical_job_id = ?").get(res1.canonicalJobId) as any;
    expect(req1.status).toBe("WAITING_ENRICHMENT");

    raw.exec(`UPDATE enrichment_jobs SET status = 'COMPLETE' WHERE canonical_job_id = '${res1.canonicalJobId}'`);

    raw.exec(`
      INSERT INTO tenants VALUES ('tenant_B');
      INSERT INTO people VALUES ('person_B', 'tenant_B');
      INSERT INTO search_plans VALUES
        ('plan_B', 'tenant_B', 'person_B', 'active', '{"targetSeniority":["VP"],"targetRoles":["VP Growth"],"targetLocations":["Gurugram"]}');
      INSERT INTO active_evaluation_contexts VALUES ('tenant_B', 'person_B', 'plan_B', 'ctx_B');
      INSERT INTO evaluation_contexts VALUES ('ctx_B', 'tenant_B', 'person_B');
    `);

    const res2 = await service.ingestOpportunity({
      ...payload,
      enrichmentDispatch: {
        detailedCard: { cardHash: "card-303" } as any,
        runId: "run-2",
      },
    }, {
      tenantId: "tenant_B",
      personId: "person_B",
      searchPlanId: "plan_B",
      runId: "run-2",
    });

    const req2 = raw.prepare("SELECT * FROM evaluation_requirements WHERE tenant_id = 'tenant_B' AND canonical_job_id = ?").get(res2.canonicalJobId) as any;
    expect(req2.status).toBe("READY");
    expect(req2.blocked_reason).toBeNull();
  });

  it("extracts sourceIdentityForCard correctly and preserves Indeed ?jk= identity while ignoring tracking params", () => {
    const cardIndeed = {
      cardHash: "hash-indeed-1",
      detailUrl: "https://www.indeed.com/viewjob?jk=1234567890abcdef&from=serp&vjs=3",
      sourceJobId: "1234567890abcdef",
    };
    expect(sourceIdentityForCard(cardIndeed as any)).toBe("1234567890abcdef");

    const cardIndeedUrlOnly = {
      cardHash: "hash-indeed-2",
      detailUrl: "https://www.indeed.com/viewjob?jk=fedcba0987654321&from=serp",
    };
    expect(sourceIdentityForCard(cardIndeedUrlOnly as any)).toBe("indeed:fedcba0987654321");

    const cardLinkedIn = {
      cardHash: "hash-li-1",
      detailUrl: "https://www.linkedin.com/jobs/view/9988776655/?trackingId=xyz",
      sourceJobId: "9988776655",
    };
    expect(sourceIdentityForCard(cardLinkedIn as any)).toBe("9988776655");

    const cardFallbackUrl = {
      cardHash: "hash-generic-1",
      detailUrl: "https://jobs.example.com/careers/vp-growth?ref=linkedin",
    };
    expect(sourceIdentityForCard(cardFallbackUrl as any)).toBe("https://jobs.example.com/careers/vp-growth");
  });

  it("produces deterministic surface keys with acquisitionSurfaceKey", () => {
    const key1 = acquisitionSurfaceKey({
      portal: "LinkedIn",
      query: "VP Product",
      location: "Bengaluru",
      postedWithinDays: 7,
    });
    const key2 = acquisitionSurfaceKey({
      portal: "LinkedIn",
      query: "VP Product",
      location: "Bengaluru",
      postedWithinDays: 7,
    });
    const key3 = acquisitionSurfaceKey({
      portal: "LinkedIn",
      query: "VP Product",
      location: "Bengaluru",
      postedWithinDays: 1,
    });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toBe("linkedin:vp product:bengaluru:d7:any:any");
    expect(key3).toBe("linkedin:vp product:bengaluru:d1:any:any");
  });

  it("rejects non-resumable runs with RunController.isStatusResumable", () => {
    const terminalStatuses = ["enriching", "completing", "completed", "failed", "aborted", "stopping", "stopped"];
    for (const status of terminalStatuses) {
      expect(RunController.isStatusResumable(status as any)).toBe(false);
    }

    const resumableStatuses = ["initializing", "running"];
    for (const status of resumableStatuses) {
      expect(RunController.isStatusResumable(status as any)).toBe(true);
    }
  });

  it("asserts payload identity and rejects mismatched versions", () => {
    const job = {
      canonical_job_id: "canon_123",
      opportunity_version: "v_alpha",
    };
    const matchingPayload = {
      evaluationEvidence: {
        canonicalJobId: "canon_123",
        opportunityVersion: "v_alpha",
      },
    };
    const mismatchedPayload = {
      evaluationEvidence: {
        canonicalJobId: "canon_123",
        opportunityVersion: "v_beta",
      },
    };

    const validatePayload = (j: typeof job, p: typeof matchingPayload) => {
      const payloadCanonId = p?.evaluationEvidence?.canonicalJobId;
      const payloadVersion = p?.evaluationEvidence?.opportunityVersion;
      if (
        (payloadCanonId && payloadCanonId !== j.canonical_job_id) ||
        (payloadVersion && payloadVersion !== j.opportunity_version)
      ) {
        throw new Error(`ENRICHMENT_PAYLOAD_IDENTITY_MISMATCH: Job specifies ${j.canonical_job_id}@${j.opportunity_version} but payload contains ${payloadCanonId}@${payloadVersion}`);
      }
      return true;
    };

    expect(validatePayload(job, matchingPayload)).toBe(true);
    expect(() => validatePayload(job, mismatchedPayload)).toThrowError(/ENRICHMENT_PAYLOAD_IDENTITY_MISMATCH/);
  });
});
