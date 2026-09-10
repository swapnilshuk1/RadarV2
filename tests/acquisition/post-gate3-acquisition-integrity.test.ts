import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  CanonicalIngestionService,
  AcquisitionIntegrityError,
} from "../../src/lib/acquisition/CanonicalIngestionService";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { sourceIdentityForCard, acquisitionSurfaceKey } from "../../src/lib/acquisition/canonical-identity";
import { RunController } from "../../scripts/scraper/run/manager";
import { assertCanonicalPayloadIdentity } from "../../scripts/enrich";
import { computeVariantsSignature } from "../../scripts/scrape";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";
import { extractionPath, readExtractionIfFresh, writeExtraction, collectRecords } from "../../scripts/scraper/persist/writer";
import { EXTRACTION_DIR } from "../../scripts/scraper/config";
import { SqliteScrapeRunStore } from "../../src/data/sqlite/repositories/SqliteScrapeRunStore";
import path from "path";
import fs from "fs";

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
      id TEXT PRIMARY KEY, job_hash TEXT NOT NULL, canonical_job_id TEXT,
      opportunity_version TEXT, pipeline_version TEXT, snapshot_path TEXT,
      payload_key TEXT, run_id TEXT, execution_plan_id TEXT, definition_id TEXT, family_id TEXT,
      portal TEXT, page INTEGER, catalog_version TEXT, planner_version TEXT, rule_version TEXT,
      search_query TEXT, status TEXT NOT NULL, business_priority INTEGER, execution_priority INTEGER,
      lease_owner TEXT, lease_expires_at TEXT, attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3, last_error TEXT, failure_type TEXT, next_retry_at TEXT,
      started_at TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT,
      UNIQUE(canonical_job_id, opportunity_version, pipeline_version)
    );
    CREATE TABLE enrichment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_payload TEXT,
      created_at TEXT
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
    CREATE TABLE scrape_runs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      search_plan_id TEXT NOT NULL,
      status TEXT NOT NULL,
      portal_targets TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      total_discovered INTEGER NOT NULL DEFAULT 0,
      total_enqueued INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_scrape_runs_active_scope ON scrape_runs(tenant_id, person_id) 
    WHERE status IN ('queued', 'initializing', 'running', 'waiting_for_confirmation', 'stopping', 'enriching', 'completing');

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

  it("asserts payload identity using assertCanonicalPayloadIdentity", () => {
    const boundJob: any = {
      id: "job-1",
      canonical_job_id: "canon_123",
      opportunity_version: "v_alpha",
    };
    const matchingPayload: any = {
      evaluationEvidence: {
        canonicalJobId: "canon_123",
        opportunityVersion: "v_alpha",
      },
    };
    const mismatchedPayload: any = {
      evaluationEvidence: {
        canonicalJobId: "canon_123",
        opportunityVersion: "v_beta",
      },
    };
    const missingEvidencePayload: any = {};
    const legacyUnboundJob: any = {
      id: "job-legacy",
      canonical_job_id: null,
      opportunity_version: null,
    };

    // Matching succeeds
    expect(() => assertCanonicalPayloadIdentity(boundJob, matchingPayload)).not.toThrow();

    // Mismatched version fails closed
    expect(() => assertCanonicalPayloadIdentity(boundJob, mismatchedPayload)).toThrowError(
      /ENRICHMENT_PAYLOAD_IDENTITY_MISMATCH/
    );

    // Missing evidence fails closed
    expect(() => assertCanonicalPayloadIdentity(boundJob, missingEvidencePayload)).toThrowError(
      /ENRICHMENT_PAYLOAD_IDENTITY_MISMATCH/
    );

    // Unbound legacy job passes safely
    expect(() => assertCanonicalPayloadIdentity(legacyUnboundJob, mismatchedPayload)).not.toThrow();
  });

  it("computes deterministic variants signature as canonical SHA-256 digest", () => {
    const variantA = {
      portal: "LinkedIn" as const,
      query: "VP Product",
      location: "Bengaluru",
      postedWithinDays: 7,
    };
    const variantB = {
      portal: "Indeed" as const,
      query: "VP Engineering",
      location: "Remote",
      postedWithinDays: 14,
    };

    // Order of variants in array must produce identical signature
    const sig1 = computeVariantsSignature([variantA, variantB]);
    const sig2 = computeVariantsSignature([variantB, variantA]);
    expect(sig1).toBeDefined();
    expect(sig1).toBe(sig2);

    // Different variant parameter must produce different signature
    const sig3 = computeVariantsSignature([
      { ...variantA, postedWithinDays: 30 },
      variantB,
    ]);
    expect(sig3).not.toBe(sig1);

    // Empty or undefined variants return undefined
    expect(computeVariantsSignature([])).toBeUndefined();
    expect(computeVariantsSignature(undefined)).toBeUndefined();
  });

  it("strictly enforces pipeline_version predicate when leasing enrichment jobs", async () => {
    const { raw, db } = createInMemoryDatabase();
    const queue = new EnrichmentQueue(db);

    const nowIso = new Date().toISOString();
    // 1. Target pipeline version job
    raw.prepare(`
      INSERT INTO enrichment_jobs (
        id, job_hash, canonical_job_id, opportunity_version, pipeline_version,
        snapshot_path, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
    `).run("job-target-v1", "hash-1", "canon-1", "ver-1", "1.0.0", "snapshots/hash-1.json", nowIso, nowIso);

    // 2. Incompatible pipeline version job
    raw.prepare(`
      INSERT INTO enrichment_jobs (
        id, job_hash, canonical_job_id, opportunity_version, pipeline_version,
        snapshot_path, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
    `).run("job-incompatible-v2", "hash-2", "canon-2", "ver-2", "2.0.0", "snapshots/hash-2.json", nowIso, nowIso);

    // 3. Legacy unbound job (pipeline_version IS NULL and canonical_job_id IS NULL and opportunity_version IS NULL)
    raw.prepare(`
      INSERT INTO enrichment_jobs (
        id, job_hash, canonical_job_id, opportunity_version, pipeline_version,
        snapshot_path, status, attempts, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, NULL, ?, 'PENDING', 0, ?, ?)
    `).run("job-legacy-unbound", "hash-3", "snapshots/hash-3.json", nowIso, nowIso);

    // Lease jobs requesting pipeline version 1.0.0
    const leased = await queue.leaseJobs("worker-test", 10, 300, "1.0.0");
    const leasedIds = leased.map((j) => j.id);

    // Should include target version 1.0.0 and legacy unbound, but NOT 2.0.0
    expect(leasedIds).toContain("job-target-v1");
    expect(leasedIds).toContain("job-legacy-unbound");
    expect(leasedIds).not.toContain("job-incompatible-v2");
  });

  it("preserves cause and sets failureKind in AcquisitionIntegrityError", () => {
    const innerCause = new Error("Turso cloud transaction rolled back");
    const err = new AcquisitionIntegrityError("Failed to persist canonical opportunity", innerCause);

    expect(err.name).toBe("AcquisitionIntegrityError");
    expect(err.failureKind).toBe("INTEGRITY_FAILURE");
    expect(err.message).toBe("Failed to persist canonical opportunity");
    expect(err.cause).toBe(innerCause);
    expect(err instanceof AcquisitionIntegrityError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("generates version-addressed extraction paths", () => {
    const pathWithVersion = extractionPath("test_card_123", "1.0.0");
    expect(pathWithVersion).toContain("test_card_123__v1.0.0.json");

    const pathWithoutVersion = extractionPath("test_card_123");
    expect(pathWithoutVersion).toContain("test_card_123.json");
  });

  it("supersedes identity-mismatched active durable run leaving exactly one active run", async () => {
    const { raw, db } = createInMemoryDatabase();
    const scrapeRunStore = new SqliteScrapeRunStore(db);
    const runScope = { tenantId: "tenant_A", personId: "person_A" };

    // 1. Initial run created in 'running' state with plan_1 identity
    await scrapeRunStore.createRun(runScope, {
      id: "run-stale-active",
      searchPlanId: "plan_1",
      portalTargets: ["LinkedIn"],
      initialStatus: "running",
      config: {
        acquisitionIdentity: {
          searchPlanId: "plan_1",
          snapshotId: "snap_1",
          contextFingerprint: "ctx_1",
          variantsSignature: "sig_1",
        },
      },
    });

    // Verify exactly one active run exists initially
    const activeBefore = raw.prepare("SELECT * FROM scrape_runs WHERE tenant_id = 'tenant_A' AND status IN ('initializing', 'running', 'enriching')").all();
    expect(activeBefore.length).toBe(1);

    // 2. Incoming run has identity mismatch (plan_2 vs plan_1)
    const existingDurableRun = await scrapeRunStore.getRun(runScope, "run-stale-active");
    expect(existingDurableRun).not.toBeNull();

    // Under supersession policy, if active and mismatched, supersede stale run first
    if (
      existingDurableRun &&
      (existingDurableRun.status === "initializing" ||
        existingDurableRun.status === "running" ||
        existingDurableRun.status === "enriching")
    ) {
      await scrapeRunStore.updateRunStatus(
        runScope,
        existingDurableRun.id,
        "aborted",
        "Superseded by fresh run due to search plan identity mismatch or non-resumable state"
      );
    }

    // Now create the fresh durable run
    await scrapeRunStore.createRun(runScope, {
      id: "run-fresh-active",
      searchPlanId: "plan_2",
      portalTargets: ["LinkedIn"],
      initialStatus: "initializing",
      config: {
        acquisitionIdentity: {
          searchPlanId: "plan_2",
          snapshotId: "snap_2",
          contextFingerprint: "ctx_2",
          variantsSignature: "sig_2",
        },
      },
    });

    // 3. Verify DB state: stale run is aborted, fresh run is initializing, exactly one active run
    const staleRun = await scrapeRunStore.getRun(runScope, "run-stale-active");
    expect(staleRun?.status).toBe("aborted");
    expect(staleRun?.errorMessage).toContain("Superseded");

    const freshRun = await scrapeRunStore.getRun(runScope, "run-fresh-active");
    expect(freshRun?.status).toBe("initializing");

    const activeRuns = raw.prepare("SELECT * FROM scrape_runs WHERE tenant_id = 'tenant_A' AND status IN ('initializing', 'running', 'enriching')").all();
    expect(activeRuns.length).toBe(1);
    expect((activeRuns[0] as any).id).toBe("run-fresh-active");
  });

  it("reuses immutable BlobStore payload and skips mutation on duplicate admission of the same canonical version", async () => {
    const { db } = createInMemoryDatabase();
    
    const putSpy = vi.fn();
    const blobData = new Map<string, string>();
    const mockBlobStore: any = {
      put: async (key: string, data: any, contentType?: string) => {
        putSpy(key, data, contentType);
        blobData.set(key, typeof data === "string" ? data : data.toString());
        return key;
      },
      get: async (key: string) => {
        const val = blobData.get(key);
        return val ? Buffer.from(val) : null;
      },
      exists: async (key: string) => blobData.has(key),
      delete: async (key: string) => {
        blobData.delete(key);
      },
      healthCheck: async () => ({ ok: true, backend: "mock" }),
    };

    const service = new CanonicalIngestionService(db, mockBlobStore);

    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-immut-101",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-immut-101",
      jobTitle: "VP Platform Engineering",
      companyName: "Acme Corp",
      location: "Bengaluru",
      rawContent: "Executive engineering leadership responsible for global infrastructure and architecture.".repeat(10),
      enrichmentDispatch: {
        detailedCard: {
          title: "VP Platform Engineering",
          company: "Acme Corp",
          description: "Executive engineering leadership",
          detail: { rawText: "Full JD details for platform engineering..." },
        } as any,
        runId: "run-immut-1",
      },
    };

    const scope = {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: "run-immut-1",
    };

    // First admission: writes blob to store
    const res1 = await service.ingestOpportunity(payload, scope);
    expect(putSpy).toHaveBeenCalledTimes(1);
    const expectedKey = `acquisition/${res1.canonicalJobId}/${res1.opportunityVersion}/snapshot.json`;
    expect(putSpy).toHaveBeenCalledWith(expectedKey, expect.any(String), "application/json");
    expect(await mockBlobStore.exists(expectedKey)).toBe(true);

    const initialContent = blobData.get(expectedKey);
    putSpy.mockClear();

    // Second admission: same canonical version admitted again
    const res2 = await service.ingestOpportunity(payload, scope);
    expect(res2.canonicalJobId).toBe(res1.canonicalJobId);
    expect(res2.opportunityVersion).toBe(res1.opportunityVersion);

    // Verifies: store.put was SKIPPED on duplicate admission to protect immutable worker payload
    expect(putSpy).not.toHaveBeenCalled();
    // Payload remains identical and unmutated
    expect(blobData.get(expectedKey)).toBe(initialContent);
  });

  it("leaves shared BlobStore payload in place without synchronous deletion if DB transaction fails during admission", async () => {
    const { db } = createInMemoryDatabase();
    
    const blobData = new Map<string, string>();
    const deleteSpy = vi.fn();
    const mockBlobStore: any = {
      put: async (key: string, data: any, contentType?: string) => {
        blobData.set(key, typeof data === "string" ? data : data.toString());
        return key;
      },
      get: async (key: string) => {
        const val = blobData.get(key);
        return val ? Buffer.from(val) : null;
      },
      exists: async (key: string) => blobData.has(key),
      delete: async (key: string) => {
        deleteSpy(key);
        blobData.delete(key);
      },
      healthCheck: async () => ({ ok: true, backend: "mock" }),
    };

    // Pre-populate a shared payload (as if Runner A committed it concurrently)
    const canonicalId = "c_linkedin_job-shared-102";
    const oppVer = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";
    const sharedKey = `acquisition/${canonicalId}/${oppVer}/snapshot.json`;
    blobData.set(sharedKey, JSON.stringify({ title: "VP Security", valid: true }));

    // Database whose transaction throws an error (Runner B)
    const failingDb: any = {
      one: db.one.bind(db),
      many: db.many.bind(db),
      execute: db.execute.bind(db),
      transaction: async () => {
        throw new Error("Simulated Turso connection dropped during transaction");
      },
    };

    const service = new CanonicalIngestionService(failingDb, mockBlobStore);

    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-shared-102",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-shared-102",
      jobTitle: "VP Security",
      companyName: "SecureCorp",
      location: "Bengaluru",
      rawContent: "Executive security leadership responsible for global cybersecurity and compliance.".repeat(10),
      enrichmentDispatch: {
        detailedCard: {
          title: "VP Security",
          company: "SecureCorp",
          description: "Executive security leadership",
        } as any,
        runId: "run-shared-1",
      },
    };

    await expect(
      service.ingestOpportunity(payload, {
        tenantId: "tenant_A",
        personId: "person_A",
        searchPlanId: "plan_A",
      })
    ).rejects.toThrow(AcquisitionIntegrityError);

    // Invariant: Runner B MUST NOT delete the shared BlobStore key
    expect(deleteSpy).toHaveBeenCalledTimes(0);
    expect(blobData.has(sharedKey)).toBe(true);
  });

  it("wraps search plans query failure into AcquisitionIntegrityError", async () => {
    const { db } = createInMemoryDatabase();
    const failingDb: any = {
      one: db.one.bind(db),
      many: async () => {
        throw new Error("Libsql query failure on search_plans");
      },
      execute: db.execute.bind(db),
      transaction: db.transaction.bind(db),
    };

    const service = new CanonicalIngestionService(failingDb);
    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-plan-err-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-plan-err-1",
      jobTitle: "VP Operations",
      companyName: "OpsCorp",
      location: "Bengaluru",
      rawContent: "VP Operations leading supply chain and strategy.".repeat(10),
    };

    await expect(
      service.ingestOpportunity(payload, {
        tenantId: "tenant_A",
        personId: "person_A",
        searchPlanId: "plan_A",
      })
    ).rejects.toThrow(AcquisitionIntegrityError);
  });

  it("returns persisted versionCreatedAt from CanonicalIngestionResult and preserves it on reuse", async () => {
    const { raw, db } = createInMemoryDatabase();
    const service = new CanonicalIngestionService(db);

    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-createdat-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-createdat-1",
      jobTitle: "VP Marketing",
      companyName: "GrowthCorp",
      location: "Bengaluru",
      rawContent: "VP Marketing driving enterprise growth and pipeline.".repeat(10),
    };
    const scope = {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
    };

    const res1 = await service.ingestOpportunity(payload, scope);
    expect(res1.versionCreatedAt).toBeDefined();

    // Verify row in database
    const verRow = raw.prepare("SELECT created_at FROM opportunity_versions WHERE id = ?").get(res1.opportunityVersion) as any;
    expect(verRow.created_at).toBe(res1.versionCreatedAt);

    // Ingest again: should reuse existing version and return identical versionCreatedAt
    const res2 = await service.ingestOpportunity(payload, scope);
    expect(res2.isNewVersion).toBe(false);
    expect(res2.versionCreatedAt).toBe(res1.versionCreatedAt);
  });

  it("refuses fresh acquisition when existing run is enriching or completing, but supersedes initializing or running", async () => {
    const { raw, db } = createInMemoryDatabase();
    const scrapeRunStore = new SqliteScrapeRunStore(db);
    const runScope = { tenantId: "tenant_A", personId: "person_A" };

    // Case 1: Existing run is 'enriching'
    await scrapeRunStore.createRun(runScope, {
      id: "run-enriching-active",
      searchPlanId: "plan_1",
      portalTargets: ["LinkedIn"],
      initialStatus: "enriching",
    });

    const enrichingRun = await scrapeRunStore.getRun(runScope, "run-enriching-active");
    expect(enrichingRun?.status).toBe("enriching");

    // Supersession check policy in scrape.ts
    const attemptSupersession = async (run: typeof enrichingRun) => {
      if (run && (run.status === "enriching" || run.status === "completing")) {
        throw new Error(`Cannot start fresh acquisition: active run ${run.id} is currently ${run.status}.`);
      }
      if (run && (run.status === "initializing" || run.status === "running")) {
        await scrapeRunStore.updateRunStatus(runScope, run.id, "aborted", "Superseded");
      }
    };

    await expect(attemptSupersession(enrichingRun)).rejects.toThrow(/Cannot start fresh acquisition/);

    // Case 2: Existing run is 'running' -> gets superseded cleanly
    raw.exec("DELETE FROM scrape_runs");
    await scrapeRunStore.createRun(runScope, {
      id: "run-running-active",
      searchPlanId: "plan_1",
      portalTargets: ["LinkedIn"],
      initialStatus: "running",
    });
    const runningRun = await scrapeRunStore.getRun(runScope, "run-running-active");
    await attemptSupersession(runningRun);

    const abortedRun = await scrapeRunStore.getRun(runScope, "run-running-active");
    expect(abortedRun?.status).toBe("aborted");
  });

  it("deterministically chooses newer opportunity version in collectRecords by versionCreatedAt even when older version has lexically larger hash", () => {
    const tempDir = EXTRACTION_DIR;
    fs.mkdirSync(tempDir, { recursive: true });

    const jobHash = "deterministic_job_hash_chronology_999";
    // Older V1: SHA-256 hash starting with 'f' (lexically large), created 2026-09-01
    const olderLexicallyLargerHash = "f" + "1".repeat(63);
    const fileV1 = path.join(tempDir, `v1_test_file__v1.0.0.json`);
    fs.writeFileSync(
      fileV1,
      JSON.stringify({
        extractorVersion: "1.0.0",
        jobHash,
        opportunityVersion: olderLexicallyLargerHash,
        versionCreatedAt: "2026-09-01T10:00:00.000Z",
        role: "VP Engineering Older",
        company: "Tech Giant",
        location: "Bengaluru",
      })
    );

    // Newer V2: SHA-256 hash starting with '0' (lexically small), created 2026-09-10
    const newerLexicallySmallerHash = "0" + "9".repeat(63);
    const fileV2 = path.join(tempDir, `v2_test_file__v1.0.0.json`);
    fs.writeFileSync(
      fileV2,
      JSON.stringify({
        extractorVersion: "1.0.0",
        jobHash,
        opportunityVersion: newerLexicallySmallerHash,
        versionCreatedAt: "2026-09-10T10:00:00.000Z",
        role: "VP Engineering Newer",
        company: "Tech Giant",
        location: "Bengaluru",
      })
    );

    try {
      const records = collectRecords("1.0.0") as any[];
      const matched = records.filter((r) => r.jobHash === jobHash);
      expect(matched.length).toBe(1);
      // Chronologically newer V2 must be chosen despite lexically smaller hash
      expect(matched[0].opportunityVersion).toBe(newerLexicallySmallerHash);
      expect(matched[0].role).toBe("VP Engineering Newer");
    } finally {
      if (fs.existsSync(fileV1)) fs.unlinkSync(fileV1);
      if (fs.existsSync(fileV2)) fs.unlinkSync(fileV2);
    }
  });
});

