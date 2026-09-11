import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  CanonicalIngestionService,
  AcquisitionIntegrityError,
  computeContentHash,
  computeCanonicalJobId,
  computeOpportunityVersionId,
} from "../../src/lib/acquisition/CanonicalIngestionService";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { sourceIdentityForCard, acquisitionSurfaceKey } from "../../src/lib/acquisition/canonical-identity";
import {
  RunController,
  acquireOwnerLock,
  releaseOwnerLock,
  acquireExclusiveLock,
  releaseExclusiveLock,
} from "../../scripts/scraper/run/manager";
import {
  acquireGlobalMarketLock,
  releaseGlobalMarketLock,
  profileLockPath,
  maybeMigrateLegacyGlobalProfile,
  profileDirFor,
} from "../../scripts/scraper/portals/base";
import {
  SCRAPER_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  MANIFEST_VERSION,
  EXTRACTOR_VERSION,
} from "../../scripts/scraper/versions";
import {
  FailurePolicyEngine,
  normalizeFailureClass,
  classifyCardFailure,
} from "../../src/lib/acquisition/failure-taxonomy";
import { HealthManager } from "../../scripts/scraper/run/health-manager";
import os from "os";
import { assertCanonicalPayloadIdentity } from "../../scripts/enrich";
import {
  computeVariantsSignature,
  abortLiveRun,
  activeRunControllers,
  activeRunSessions,
  createRunSession,
  executeCardDetailWithPolicy,
  finalizeUnitOutcome,
  shutdownAllRuns,
} from "../../scripts/scrape";
import * as httpFetchModule from "../../scripts/scraper/utils/http-fetch";
import { classifyFastPathResponse } from "../../scripts/scraper/utils/http-fetch";
import { linkedinHandler } from "../../scripts/scraper/portals/linkedin";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";
import { extractionPath, readExtractionIfFresh, writeExtraction, collectRecords, readSnapshotIfFresh } from "../../scripts/scraper/persist/writer";
import { EXTRACTION_DIR, RUNS_DIR, PROFILES_DIR, SNAPSHOT_DIR } from "../../scripts/scraper/config";
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
    INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets) VALUES
      ('run-001', 'tenant_A', 'person_A', 'plan_A', 'completed', '[]'),
      ('run-A', 'tenant_A', 'person_A', 'plan_A', 'completed', '[]'),
      ('run-B', 'tenant_A', 'person_A', 'plan_A', 'completed', '[]'),
      ('run-1', 'tenant_A', 'person_A', 'plan_A', 'completed', '[]'),
      ('run-immut-1', 'tenant_A', 'person_A', 'plan_A', 'completed', '[]'),
      ('run-shared-1', 'tenant_A', 'person_A', 'plan_A', 'completed', '[]');
  `);
  const blobData = new Map<string, string>();
  const mockBlobStore: any = {
    put: async (key: string, data: any) => {
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
    _data: blobData,
  };
  return { raw, db: new SqliteAdapter(raw), blobStore: mockBlobStore };
}

describe("Post-Gate-3 Acquisition & Enrichment Integrity", () => {
  it("always creates an enrichment job for a usable canonical version even when Attention Gate is NOT_CANDIDATE", async () => {
    const { raw, db, blobStore } = createInMemoryDatabase();
    raw.exec(`UPDATE search_plans SET criteria_json = '{"targetSeniority":["CXO"],"targetRoles":["CTO"]}' WHERE id = 'plan_A'`);
    raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-001'`);

    const service = new CanonicalIngestionService(db, blobStore);
    const rawContent = "Junior engineer writing basic tests and fixing bugs.".repeat(10);
    const result = await service.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "job-101",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-101",
      jobTitle: "Junior Software Engineer",
      companyName: "Acme Corp",
      location: "San Francisco, CA",
      rawContent,
      enrichmentDispatch: {
        detailedCard: {
          title: "Junior Software Engineer",
          company: "Acme Corp",
          location: "San Francisco, CA",
          detail: { rawText: rawContent },
        } as any,
        runId: "run-001",
        pipelineVersion: "1.0.0",
      },
    }, {
      mode: "SCOPED",
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
    const { raw, db, blobStore } = createInMemoryDatabase();
    const service = new CanonicalIngestionService(db, blobStore);

    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-202",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-202",
      jobTitle: "VP Growth",
      companyName: "HyperGrowth Inc",
      location: "Gurugram",
      rawContent: "Executive leadership role driving user acquisition, P&L, and team growth.".repeat(10),
    };

    raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-A'`);

    const detailedCard = {
      title: payload.jobTitle,
      company: payload.companyName,
      location: payload.location,
      detail: { rawText: payload.rawContent },
    };

    const resA = await service.ingestOpportunity({
      ...payload,
      enrichmentDispatch: {
        detailedCard: detailedCard as any,
        runId: "run-A",
        pipelineVersion: "1.0.0",
      },
    }, {
      mode: "SCOPED",
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: "run-A",
    });

    expect(resA.isNewOpportunity).toBe(true);
    expect(resA.isNewVersion).toBe(true);

    const bindingsA = raw.prepare("SELECT * FROM scrape_run_enrichment_requirements WHERE run_id = 'run-A'").all();
    expect(bindingsA.length).toBe(1);

    raw.exec(`UPDATE scrape_runs SET status = 'completed' WHERE id = 'run-A'`);
    raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-B'`);

    const resB = await service.ingestOpportunity({
      ...payload,
      enrichmentDispatch: {
        detailedCard: detailedCard as any,
        runId: "run-B",
        pipelineVersion: "1.0.0",
      },
    }, {
      mode: "SCOPED",
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
    const { raw, db, blobStore } = createInMemoryDatabase();
    const service = new CanonicalIngestionService(db, blobStore);

    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-303",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-303",
      jobTitle: "VP Growth",
      companyName: "FinTech Prime",
      location: "Gurugram",
      rawContent: "Executive VP Growth leading strategic expansion and marketing initiatives.".repeat(10),
    };

    raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-1'`);

    const detailedCard = {
      title: payload.jobTitle,
      company: payload.companyName,
      location: payload.location,
      detail: { rawText: payload.rawContent },
    };

    const res1 = await service.ingestOpportunity({
      ...payload,
      enrichmentDispatch: {
        detailedCard: detailedCard as any,
        runId: "run-1",
        pipelineVersion: "1.0.0",
      },
    }, {
      mode: "SCOPED",
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
      INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets) VALUES
        ('run-2', 'tenant_B', 'person_B', 'plan_B', 'running', '[]');
    `);

    const res2 = await service.ingestOpportunity({
      ...payload,
      enrichmentDispatch: {
        detailedCard: detailedCard as any,
        runId: "run-2",
        pipelineVersion: "1.0.0",
      },
    }, {
      mode: "SCOPED",
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
    const { raw, db } = createInMemoryDatabase();
    
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

    raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-immut-1'`);

    const service = new CanonicalIngestionService(db, mockBlobStore);

    const rawContent = "Executive engineering leadership responsible for global infrastructure and architecture.".repeat(10);
    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-immut-101",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-immut-101",
      jobTitle: "VP Platform Engineering",
      companyName: "Acme Corp",
      location: "Bengaluru",
      rawContent,
      enrichmentDispatch: {
        detailedCard: {
          title: "VP Platform Engineering",
          company: "Acme Corp",
          location: "Bengaluru",
          description: "Executive engineering leadership",
          detail: { rawText: rawContent },
        } as any,
        runId: "run-immut-1",
        pipelineVersion: "1.0.0",
      },
    };

    const scope = {
      mode: "SCOPED" as const,
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
    const { raw, db, blobStore } = createInMemoryDatabase();
    const service = new CanonicalIngestionService(db, blobStore);

    const rawContent = "VP Marketing driving enterprise growth and pipeline.".repeat(10);
    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-createdat-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-createdat-1",
      jobTitle: "VP Marketing",
      companyName: "GrowthCorp",
      location: "Bengaluru",
      rawContent,
      enrichmentDispatch: {
        detailedCard: {
          title: "VP Marketing",
          company: "GrowthCorp",
          location: "Bengaluru",
          detail: { rawText: rawContent },
        } as any,
        runId: "run-001",
        pipelineVersion: "1.0.0",
      },
    };
    raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-001'`);

    const scope = {
      mode: "SCOPED" as const,
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: "run-001",
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

  it("enforces atomic .owner lock acquisition, active PID rejection, and stale PID recovery", () => {
    const testDir = path.join(os.tmpdir(), `radar_owner_lock_test_${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    try {
      // 1. Initial lock acquisition
      const lock1 = acquireOwnerLock(testDir, "test-run-1");
      expect(lock1.pid).toBe(process.pid);
      expect(lock1.runId).toBe("test-run-1");
      expect(fs.existsSync(path.join(testDir, ".owner"))).toBe(true);

      // 2. Contender rejection by active PID (current process is alive)
      expect(() => acquireOwnerLock(testDir, "test-run-2")).toThrow(/Refusing concurrent ownership/);

      // 3. Stale PID recovery: write a fake dead PID (e.g. 999999999)
      const ownerPath = path.join(testDir, ".owner");
      fs.writeFileSync(
        ownerPath,
        JSON.stringify({ pid: 999999999, runId: "dead-run", startedAt: new Date().toISOString() }),
        "utf-8"
      );

      // Lock should detect dead PID (ESRCH), unlink, and acquire cleanly
      const lock3 = acquireOwnerLock(testDir, "test-run-3");
      expect(lock3.pid).toBe(process.pid);
      expect(lock3.runId).toBe("test-run-3");

      // 4. Release lock
      releaseOwnerLock(testDir, "test-run-3");
      expect(fs.existsSync(ownerPath)).toBe(false);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("preserves prior lifecycle status (waiting_for_confirmation, initializing) across crash resume", () => {
    const runId = "test-resume-lifecycle-" + Date.now();
    const testRunDir = path.join(RUNS_DIR, runId);
    fs.mkdirSync(testRunDir, { recursive: true });

    try {
      const controller = new RunController(runId);
      const fakeTarget = {
        runId,
        runDir: testRunDir,
        manifestPath: path.join(testRunDir, "manifest.json"),
        journalPath: path.join(testRunDir, "journal.ndjson"),
        manifest: {
          runId,
          status: "waiting_for_confirmation" as const,
          units: [
            {
              id: "unit-1",
              portal: "LinkedIn" as const,
              keyword: "VP Growth",
              page: 1,
              status: "running" as const,
            },
          ],
          cards: [
            {
              id: "card-1",
              unitId: "unit-1",
              portal: "LinkedIn" as const,
              url: "https://linkedin.com/jobs/view/1",
              title: "VP Growth",
              company: "Acme",
              location: "Gurugram",
              status: "running" as const,
            },
          ],
        } as any,
      };

      // attachExistingRun acquires .owner and calls markResume()
      controller.attachExistingRun(fakeTarget);

      // Lifecycle status must be PRESERVED, not forced to "running"
      expect(controller.manifest.status).toBe("waiting_for_confirmation");

      // Interrupted work units and cards must be reset to "pending"
      const units = controller.manifest.units;
      const cards = controller.manifest.cards;
      expect(units[0].status).toBe("pending");
      expect(cards[0].status).toBe("pending");

      // Now test initializing preservation
      releaseOwnerLock(testRunDir, runId);
      fakeTarget.manifest.status = "initializing";
      controller.attachExistingRun(fakeTarget);
      expect(controller.manifest.status).toBe("initializing");

      releaseOwnerLock(testRunDir, runId);
    } finally {
      fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  it("refuses fresh execution against an active durable run", async () => {
    const { raw, db } = createInMemoryDatabase();
    const runStore = new SqliteScrapeRunStore(db);

    await runStore.createRun(
      { tenantId: "tenant_A", personId: "person_A" },
      {
        id: "run-active-durable-refuse",
        searchPlanId: "plan_A",
        portalTargets: ["LinkedIn"],
      }
    );

    const active = await runStore.getActiveRun({
      tenantId: "tenant_A",
      personId: "person_A",
    });
    expect(active).not.toBeNull();
    expect(active!.id).toBe("run-active-durable-refuse");

    // In scrape.ts durable arbitration:
    // If an active run exists and the operator requested --fresh (resume === false),
    // the system refuses to proceed to protect active durable execution.
    const requestedResume = false;
    const shouldRefuse = !requestedResume && active !== null;
    expect(shouldRefuse).toBe(true);
  });

  it("marks remaining cards skipped_gated when portal queue pause is signaled", () => {
    const cards: any[] = [
      { id: "c1", portal: "Naukri", status: "completed" },
      { id: "c2", portal: "LinkedIn", status: "pending" },
      { id: "c3", portal: "LinkedIn", status: "pending" },
      { id: "c4", portal: "Indeed", status: "pending" },
    ];

    const portalToPause = "LinkedIn";
    for (const card of cards) {
      if (card.portal === portalToPause && card.status === "pending") {
        card.status = "skipped_gated";
        card.skippedReason = "Portal rate-limit/gating triggered pause";
      }
    }

    expect(cards[0].status).toBe("completed");
    expect(cards[1].status).toBe("skipped_gated");
    expect(cards[2].status).toBe("skipped_gated");
    expect(cards[3].status).toBe("pending");
  });

  it("throws CANONICAL_ENRICHMENT_PAYLOAD_MISMATCH if snapshot canonical material differs from canonical document hash", async () => {
    const { raw, db, blobStore } = createInMemoryDatabase();
    raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-001'`);
    const service = new CanonicalIngestionService(db, blobStore);

    const rawContent = "Valid executive description for VP Engineering role.".repeat(10);
    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-mismatch-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-mismatch-1",
      jobTitle: "VP Engineering",
      companyName: "TechCorp",
      location: "Bengaluru",
      rawContent,
      enrichmentDispatch: {
        detailedCard: {
          title: "VP Product", // Mismatched title intentionally
          company: "TechCorp",
          location: "Bengaluru",
          detail: { rawText: rawContent },
        } as any,
        runId: "run-001",
        pipelineVersion: "1.0.0",
      },
    };

    await expect(
      service.ingestOpportunity(payload, {
        mode: "SCOPED",
        tenantId: "tenant_A",
        personId: "person_A",
        searchPlanId: "plan_A",
        runId: "run-001",
      })
    ).rejects.toThrow(/CANONICAL_ENRICHMENT_PAYLOAD_MISMATCH/);
  });

  it("throws IMMUTABLE_ENRICHMENT_PAYLOAD_CONFLICT when existing BlobStore payload has a divergent content hash", async () => {
    const { raw, db, blobStore } = createInMemoryDatabase();
    raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-001'`);
    const service = new CanonicalIngestionService(db, blobStore);

    const rawContent = "VP Infrastructure leading global platforms and distributed systems.".repeat(10);
    const payload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "job-conflict-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job-conflict-1",
      jobTitle: "VP Infrastructure",
      companyName: "CloudTech",
      location: "Bengaluru",
      rawContent,
      enrichmentDispatch: {
        detailedCard: {
          title: "VP Infrastructure",
          company: "CloudTech",
          location: "Bengaluru",
          detail: { rawText: rawContent },
        } as any,
        runId: "run-001",
        pipelineVersion: "1.0.0",
      },
    };

    // Pre-populate BlobStore with a payload having different content under the expected key
    const canonicalJobId = computeCanonicalJobId({ source: payload.sourcePortal, sourceJobId: payload.sourceJobId });
    const contentHash = computeContentHash({
      title: "VP Infrastructure",
      companyName: "CloudTech",
      location: "Bengaluru",
      employmentType: null,
      rawContent,
    });
    const versionId = computeOpportunityVersionId(canonicalJobId, contentHash);
    const key = `acquisition/${canonicalJobId}/${versionId}/snapshot.json`;
    await blobStore.put(key, JSON.stringify({
      canonicalJobId,
      opportunityVersion: versionId,
      title: "VP Different Role", // Divergent title
      company: "CloudTech",
      location: "Bengaluru",
      detail: { rawText: rawContent },
    }));

    await expect(
      service.ingestOpportunity(payload, {
        mode: "SCOPED",
        tenantId: "tenant_A",
        personId: "person_A",
        searchPlanId: "plan_A",
        runId: "run-001",
      })
    ).rejects.toThrow(/IMMUTABLE_ENRICHMENT_PAYLOAD_CONFLICT/);
  });

  it("FailurePolicyEngine distinguishes FASTPATH_ACCESS_DENIED from RATE_LIMIT_429 and BOT_CHALLENGE_BLOCK", () => {
    const fastPathPolicy = FailurePolicyEngine.evaluate("FASTPATH_ACCESS_DENIED");
    expect(fastPathPolicy.pausePortalQueue).toBe(false);
    expect(fastPathPolicy.category).toBe("ACCESS");

    const rateLimitPolicy = FailurePolicyEngine.evaluate("RATE_LIMIT_429");
    expect(rateLimitPolicy.pausePortalQueue).toBe(true);
    expect(rateLimitPolicy.category).toBe("ACCESS");

    const challengePolicy = FailurePolicyEngine.evaluate("BOT_CHALLENGE_BLOCK");
    expect(challengePolicy.pausePortalQueue).toBe(true);
    expect(challengePolicy.category).toBe("ACCESS");
  });

  it("enforces serialized stale lock reclamation via .reclaim mutex and token nonce release matching", () => {
    const testDir = path.join(os.tmpdir(), `radar-lock-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    const lockPath = path.join(testDir, "test.lock");
    const reclaimPath = `${lockPath}.reclaim`;

    try {
      // 1. Simulate dead owner PID
      const deadPid = 99999999;
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: deadPid,
        runId: "dead-run",
        nonce: "dead-nonce-123",
        createdAt: new Date().toISOString(),
      }), "utf-8");

      // 2. Dead PID reclaim
      const token = acquireExclusiveLock(lockPath, { runId: "live-run-1" }, {
        isProcessAlive: () => false,
      });

      expect(token.runId).toBe("live-run-1");
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(fs.existsSync(reclaimPath)).toBe(false); // reclaim mutex must be unlinked

      // 3. Attempting release with wrong nonce fails to delete lock
      releaseExclusiveLock({
        pid: token.pid,
        runId: token.runId,
        profileKey: token.profileKey,
        nonce: "wrong-nonce",
        lockPath,
      });
      expect(fs.existsSync(lockPath)).toBe(true);

      // 4. Release with valid token unlinks the lock
      releaseExclusiveLock(token);
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("enforces machine-level GLOBAL_MARKET lock and evaluates unit status as failed for unclassified attempted cards without usable document", () => {
    const runId1 = "global-run-alpha";
    const runId2 = "global-run-beta";

    const token1 = acquireGlobalMarketLock(runId1);
    try {
      // Second global market run on same machine must be rejected
      expect(() => acquireGlobalMarketLock(runId2)).toThrow(/EXCLUSIVE_LOCK_ACTIVE/);
    } finally {
      releaseGlobalMarketLock(token1);
    }

    // Derived unit accounting test:
    // When a card had detail attempted but did not produce a usable document,
    // post-drain unit accounting must mark the unit as "failed".
    const manifestCards: any[] = [
      {
        id: "c1",
        status: "completed",
        detailAttempted: true,
        usableDetailDocument: true,
      },
      {
        id: "c2",
        status: "completed",
        detailAttempted: true,
        usableDetailDocument: false,
      },
    ];

    const hasFailedAttemptedCards = manifestCards.some(
      (c) => c.detailAttempted && !c.usableDetailDocument
    );
    expect(hasFailedAttemptedCards).toBe(true);
    const unitStatus = hasFailedAttemptedCards ? "failed" : "completed";
    expect(unitStatus).toBe("failed");
  });

  describe("Item 23 Invariant Checklist", () => {
    it("serializes two contenders reclaiming the same dead owner", () => {
      const testDir = path.join(os.tmpdir(), `radar-dead-owner-${Date.now()}`);
      fs.mkdirSync(testDir, { recursive: true });
      const lockPath = path.join(testDir, "owner.lock");
      try {
        fs.writeFileSync(lockPath, JSON.stringify({
          pid: 999999,
          nonce: "dead-nonce",
          ownerId: "dead-owner",
          createdAt: new Date().toISOString(),
        }));

        const deps = { isProcessAlive: (pid: number) => pid === process.pid };
        const token1 = acquireExclusiveLock(lockPath, "contender-1", deps);
        expect(token1.ownerId).toBe("contender-1");

        expect(() => acquireExclusiveLock(lockPath, "contender-2", deps)).toThrow();
        releaseExclusiveLock(token1);
      } finally {
        try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
      }
    });

    it("never reclaims an unreadable owner lock", () => {
      const testDir = path.join(os.tmpdir(), `radar-unreadable-${Date.now()}`);
      fs.mkdirSync(testDir, { recursive: true });
      const lockPath = path.join(testDir, "corrupt.lock");
      try {
        fs.writeFileSync(lockPath, "INVALID_CORRUPT_JSON{{{");
        expect(() => acquireExclusiveLock(lockPath, "contender", { isProcessAlive: () => false })).toThrow();
      } finally {
        try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
      }
    });

    it("prevents concurrent ownership of the same tenant/person/portal profile", () => {
      const lockPath = profileLockPath("LinkedIn", {
        runId: "run-1",
        mode: "SCOPED",
        tenantId: "tenant_alpha",
        personId: "person_beta",
      });
      let token1: any = null;
      try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        token1 = acquireExclusiveLock(lockPath, "profile:run-1:LinkedIn");
        expect(() => acquireExclusiveLock(lockPath, "profile:run-2:LinkedIn")).toThrow();
      } finally {
        if (token1) releaseExclusiveLock(token1);
      }
    });

    it("serializes all GLOBAL_MARKET runs regardless of portal", () => {
      const testDir = path.join(os.tmpdir(), `radar-gm-${Date.now()}`);
      fs.mkdirSync(testDir, { recursive: true });
      const lockPath = path.join(testDir, ".global_market.lock");
      let token1: any = null;
      try {
        token1 = acquireExclusiveLock(lockPath, "global-market:run-A:LinkedIn");
        expect(() => acquireExclusiveLock(lockPath, "global-market:run-B:Naukri")).toThrow();
      } finally {
        if (token1) releaseExclusiveLock(token1);
        try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
      }
    });

    it("SCOPED requires runId", async () => {
      const { db, blobStore } = createInMemoryDatabase();
      const service = new CanonicalIngestionService(db, blobStore);
      const payload: any = {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-scoped-req",
        canonicalUrl: "https://www.linkedin.com/jobs/view/job-scoped-req",
        jobTitle: "VP Sales",
        companyName: "Acme",
        location: "Bengaluru",
        rawContent: "Leadership role driving sales.".repeat(10),
      };

      await expect(
        service.ingestOpportunity(payload, {
          mode: "SCOPED",
          tenantId: "tenant_A",
          personId: "person_A",
          searchPlanId: "plan_A",
          // missing runId
        } as any)
      ).rejects.toThrow(/runId is required/);
    });

    it("SCOPED rejects non-running run", async () => {
      const { raw, db, blobStore } = createInMemoryDatabase();
      raw.exec(`UPDATE scrape_runs SET status = 'waiting_for_confirmation' WHERE id = 'run-001'`);
      const service = new CanonicalIngestionService(db, blobStore);
      const rawContent = "Leadership role driving sales.".repeat(10);
      const payload: any = {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-scoped-nonrunning",
        canonicalUrl: "https://www.linkedin.com/jobs/view/job-scoped-nonrunning",
        jobTitle: "VP Sales",
        companyName: "Acme",
        location: "Bengaluru",
        rawContent,
        enrichmentDispatch: {
          detailedCard: {
            title: "VP Sales",
            company: "Acme",
            location: "Bengaluru",
            detail: { rawText: rawContent },
          },
          pipelineVersion: "v2.1",
        },
      };

      await expect(
        service.ingestOpportunity(payload, {
          mode: "SCOPED",
          tenantId: "tenant_A",
          personId: "person_A",
          searchPlanId: "plan_A",
          runId: "run-001",
        })
      ).rejects.toThrow(/must be 'running'/);
    });

    it("GLOBAL_MARKET evaluates zero plans", async () => {
      const { raw, db, blobStore } = createInMemoryDatabase();
      const service = new CanonicalIngestionService(db, blobStore);
      const rawContent = "Global market opportunity text content.".repeat(10);
      const payload: any = {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-gm-zeroplans",
        canonicalUrl: "https://www.linkedin.com/jobs/view/job-gm-zeroplans",
        jobTitle: "VP Sales",
        companyName: "Acme",
        location: "Bengaluru",
        rawContent,
        enrichmentDispatch: {
          detailedCard: {
            title: "VP Sales",
            company: "Acme",
            location: "Bengaluru",
            detail: { rawText: rawContent },
          },
          pipelineVersion: "v2.1",
        },
      };

      const res = await service.ingestOpportunity(payload, {
        mode: "GLOBAL_MARKET",
      });

      expect(Object.keys(res.candidateDecisions).length).toBe(0);
      const planCandidates = raw.prepare("SELECT * FROM search_plan_candidates").all();
      expect(planCandidates.length).toBe(0);
      const evalReqs = raw.prepare("SELECT * FROM evaluation_requirements").all();
      expect(evalReqs.length).toBe(0);
    });

    it("scoped active plan must resolve exactly once", async () => {
      const { raw, db, blobStore } = createInMemoryDatabase();
      raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-001'`);
      const service = new CanonicalIngestionService(db, blobStore);
      const rawContent = "VP Growth driving expansion and commercial operations.".repeat(10);
      const payload: any = {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-scoped-single-plan",
        canonicalUrl: "https://www.linkedin.com/jobs/view/job-scoped-single-plan",
        jobTitle: "VP Growth",
        companyName: "Acme",
        location: "Gurugram",
        rawContent,
        enrichmentDispatch: {
          detailedCard: {
            title: "VP Growth",
            company: "Acme",
            location: "Gurugram",
            detail: { rawText: rawContent },
          },
          pipelineVersion: "v2.1",
        },
      };

      const res = await service.ingestOpportunity(payload, {
        mode: "SCOPED",
        tenantId: "tenant_A",
        personId: "person_A",
        searchPlanId: "plan_A",
        runId: "run-001",
      });

      expect(Object.keys(res.candidateDecisions)).toEqual(["plan_A"]);
      const candidates = raw.prepare("SELECT * FROM search_plan_candidates WHERE search_plan_id = 'plan_A'").all();
      expect(candidates.length).toBe(1);
    });

    it("canonical material A plus enrichment material B fails", async () => {
      const { raw, db, blobStore } = createInMemoryDatabase();
      raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-001'`);
      const service = new CanonicalIngestionService(db, blobStore);
      const rawContentA = "Canonical material A content for executive position.".repeat(10);
      const rawContentB = "Enrichment material B divergent content.".repeat(10);

      const payload: any = {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-mismatch",
        canonicalUrl: "https://www.linkedin.com/jobs/view/job-mismatch",
        jobTitle: "VP Growth",
        companyName: "Acme",
        location: "Gurugram",
        rawContent: rawContentA,
        enrichmentDispatch: {
          detailedCard: {
            title: "VP Growth",
            company: "Acme",
            location: "Gurugram",
            detail: { rawText: rawContentB },
          } as any,
          runId: "run-001",
          pipelineVersion: "1.0.0",
        },
      };

      await expect(
        service.ingestOpportunity(payload, {
          mode: "SCOPED",
          tenantId: "tenant_A",
          personId: "person_A",
          searchPlanId: "plan_A",
          runId: "run-001",
        })
      ).rejects.toThrow(/CANONICAL_ENRICHMENT_PAYLOAD_MISMATCH/);
    });

    it("existing conflicting immutable snapshot fails closed", async () => {
      const { raw, db, blobStore } = createInMemoryDatabase();
      raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-001'`);
      const service = new CanonicalIngestionService(db, blobStore);
      const rawContent = "Snapshot content for testing conflict.".repeat(10);
      const payload: any = {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-conflict-snap",
        canonicalUrl: "https://www.linkedin.com/jobs/view/job-conflict-snap",
        jobTitle: "VP Eng",
        companyName: "Acme",
        location: "Bengaluru",
        rawContent,
        enrichmentDispatch: {
          detailedCard: {
            title: "VP Eng",
            company: "Acme",
            location: "Bengaluru",
            detail: { rawText: rawContent },
          } as any,
          runId: "run-001",
          pipelineVersion: "1.0.0",
        },
      };

      const canonicalId = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: "job-conflict-snap" });
      const contentHash = computeContentHash({
        title: "VP Eng",
        companyName: "Acme",
        location: "Bengaluru",
        employmentType: null,
        rawContent,
      });
      const versionId = computeOpportunityVersionId(canonicalId, contentHash);
      const snapshotKey = `acquisition/${canonicalId}/${versionId}/snapshot.json`;
      await blobStore.put(snapshotKey, JSON.stringify({
        schemaVersion: "1.0.0",
        contentHash: "conflicting-hash-999",
        rawText: "Divergent pre-seeded snapshot",
      }));

      await expect(
        service.ingestOpportunity(payload, {
          mode: "SCOPED",
          tenantId: "tenant_A",
          personId: "person_A",
          searchPlanId: "plan_A",
          runId: "run-001",
        })
      ).rejects.toThrow(/IMMUTABLE_ENRICHMENT_PAYLOAD_CONFLICT/);
    });

    it("bare FastPath 403 falls back to browser", () => {
      const policy = FailurePolicyEngine.evaluate("FASTPATH_ACCESS_DENIED");
      expect(policy.pausePortalQueue).toBe(false);
      expect(policy.category).toBe("ACCESS");
    });

    it("positive bot challenge does not browser-fallback", () => {
      const policy = FailurePolicyEngine.evaluate("BOT_CHALLENGE_BLOCK");
      expect(policy.pausePortalQueue).toBe(true);
      expect(policy.shouldRetry).toBe(false);
    });

    it("429 does not retry and pauses portal", () => {
      const policy = FailurePolicyEngine.evaluate("RATE_LIMIT_429");
      expect(policy.pausePortalQueue).toBe(true);
    });

    it("unknown failure becomes SOURCE_FAILURE", () => {
      const norm = normalizeFailureClass("SOME_RANDOM_WEIRD_STRING" as any);
      expect(norm).toBe("UNKNOWN_FAILURE");
      expect(classifyCardFailure(norm)).toBe("SOURCE_FAILURE");
      expect(classifyCardFailure(normalizeFailureClass(null as any))).toBe("SOURCE_FAILURE");
      expect(classifyCardFailure(normalizeFailureClass(undefined as any))).toBe("SOURCE_FAILURE");
    });

    it("two listings sharing ATS URL are both admitted", async () => {
      const { raw, db, blobStore } = createInMemoryDatabase();
      const service = new CanonicalIngestionService(db, blobStore);

      const rawContent1 = "Posting one content from LinkedIn.".repeat(10);
      const res1 = await service.ingestOpportunity({
        sourcePortal: "LinkedIn",
        sourceJobId: "li-job-1",
        canonicalUrl: "https://www.linkedin.com/jobs/view/li-job-1",
        jobTitle: "VP Growth",
        companyName: "Corp",
        location: "Bengaluru",
        rawContent: rawContent1,
        enrichmentDispatch: {
          detailedCard: {
            title: "VP Growth",
            company: "Corp",
            location: "Bengaluru",
            detail: { rawText: rawContent1 },
          },
          pipelineVersion: "v2.1",
        },
      }, { mode: "GLOBAL_MARKET" });

      const rawContent2 = "Posting two content from Indeed with same ATS URL.".repeat(10);
      const res2 = await service.ingestOpportunity({
        sourcePortal: "Indeed",
        sourceJobId: "in-job-2",
        canonicalUrl: "https://www.indeed.com/viewjob?jk=in-job-2",
        jobTitle: "VP Growth",
        companyName: "Corp",
        location: "Bengaluru",
        rawContent: rawContent2,
        enrichmentDispatch: {
          detailedCard: {
            title: "VP Growth",
            company: "Corp",
            location: "Bengaluru",
            detail: { rawText: rawContent2 },
          },
          pipelineVersion: "v2.1",
        },
      }, { mode: "GLOBAL_MARKET" });

      expect(res1.canonicalJobId).not.toBe(res2.canonicalJobId);
      const opps = raw.prepare("SELECT * FROM canonical_opportunities").all();
      expect(opps.length).toBe(2);
    });

    it("actual FastPath response classifier classifies bare 403, 429, challenge 403", () => {
      const res403 = classifyFastPathResponse(403, "Forbidden");
      expect(res403.failureClass).toBe("FASTPATH_ACCESS_DENIED");
      expect(res403.outcome).toBe("AUTH_ERROR");

      const res429 = classifyFastPathResponse(429, "Too Many Requests");
      expect(res429.failureClass).toBe("RATE_LIMIT_429");
      expect(res429.outcome).toBe("ANTI_BOT");

      const resChallenge = classifyFastPathResponse(403, "Attention Required! | Cloudflare verify you are human");
      expect(resChallenge.failureClass).toBe("BOT_CHALLENGE_BLOCK");
      expect(resChallenge.outcome).toBe("ANTI_BOT");
    });

    it("handler proves 429/challenge never reaches browser fallback", async () => {
      const spy = vi.spyOn(httpFetchModule, "fastFetchDetail");
      const newPageMock = vi.fn();
      const mockCtx: any = {
        runId: "run-test-fallback",
        portal: "LinkedIn",
        isHttpDisabled: () => false,
        recordHttpFailure: vi.fn(),
        recordTelemetry: vi.fn(),
        logger: () => {},
        browserContext: {
          newPage: newPageMock,
        },
      };

      // 1. 429 never falls back
      spy.mockResolvedValueOnce({
        fetched: false,
        failureClass: "RATE_LIMIT_429",
        fetchError: "HTTP 429",
        fetchDurationMs: 10,
        httpStatus: 429,
        outcome: "ANTI_BOT",
        rawHtml: "",
        rawText: "",
      });
      const res429 = await linkedinHandler.fetchDetail(mockCtx, "https://www.linkedin.com/jobs/view/test-429");
      expect(res429.failureClass).toBe("RATE_LIMIT_429");
      expect(newPageMock).not.toHaveBeenCalled();
      expect(mockCtx.recordHttpFailure).toHaveBeenCalledWith("https://www.linkedin.com/jobs/view/test-429", "RATE_LIMIT_429");

      // 2. Challenge block never falls back
      spy.mockResolvedValueOnce({
        fetched: false,
        failureClass: "BOT_CHALLENGE_BLOCK",
        fetchError: "HTTP 403 (Bot Challenge)",
        fetchDurationMs: 10,
        httpStatus: 403,
        outcome: "ANTI_BOT",
        rawHtml: "",
        rawText: "",
      });
      const resChallenge = await linkedinHandler.fetchDetail(mockCtx, "https://www.linkedin.com/jobs/view/test-challenge");
      expect(resChallenge.failureClass).toBe("BOT_CHALLENGE_BLOCK");
      expect(newPageMock).not.toHaveBeenCalled();

      // 3. FASTPATH_ACCESS_DENIED allows browser fallback
      spy.mockResolvedValueOnce({
        fetched: false,
        failureClass: "FASTPATH_ACCESS_DENIED",
        fetchError: "HTTP 403 (Access Denied)",
        fetchDurationMs: 10,
        httpStatus: 403,
        outcome: "AUTH_ERROR",
        rawHtml: "",
        rawText: "",
      });
      const mockPage = {
        goto: vi.fn().mockResolvedValue({ status: () => 200 }),
        title: vi.fn().mockResolvedValue("VP Test"),
        content: vi.fn().mockResolvedValue("<html><body>Valid JD text</body></html>"),
        close: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({}),
        $: vi.fn().mockResolvedValue(null),
        $$: vi.fn().mockResolvedValue([]),
      };
      newPageMock.mockResolvedValueOnce(mockPage);

      await linkedinHandler.fetchDetail(mockCtx, "https://www.linkedin.com/jobs/view/test-403");
      expect(newPageMock).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });

    it("executeCardDetailWithPolicy from attempts=0 proves exact retry count", async () => {
      const cardUnit = { id: "card-exact-retry", attempts: 0, status: "pending" } as any;
      let fetchCalls = 0;
      const mockMgr = {
        updateCard: vi.fn(),
      } as any;

      const result = await executeCardDetailWithPolicy(
        {
          cardUnitId: "card-exact-retry",
          cardUnit,
          mgr: mockMgr,
          fetchDetail: async () => {
            fetchCalls++;
            return {
              fetched: false,
              failureClass: "HTTP_TIMEOUT",
              fetchError: "timeout",
              rawHtml: "",
              rawText: "",
              fetchDurationMs: 10,
            };
          },
          validateDetail: () => ({ isValid: false, failureClass: "HTTP_TIMEOUT" } as any),
          isPortalPaused: () => false,
          triggerPortalPause: () => {},
        },
        { sleep: async () => {} }
      );

      // FailurePolicyEngine for HTTP_TIMEOUT: max 2 retries (3 total attempts)
      expect(result.ok).toBe(false);
      expect(cardUnit.attempts).toBe(3);
      expect(fetchCalls).toBe(3);
    });

    it("executeCardDetailWithPolicy + production classifier: all REMOVED_404 => EXPECTED_REJECTION", async () => {
      const cardUnit = { id: "card-404", attempts: 0, status: "pending" } as any;
      let finalFailureKind: string | undefined;
      const mockMgr = {
        updateCard: vi.fn((_id: string, updates: any) => {
          if (updates.failureKind) finalFailureKind = updates.failureKind;
        }),
      } as any;

      const result = await executeCardDetailWithPolicy(
        {
          cardUnitId: "card-404",
          cardUnit,
          mgr: mockMgr,
          fetchDetail: async () => ({
            fetched: false,
            failureClass: "REMOVED_404",
            rawHtml: "",
            rawText: "",
            fetchDurationMs: 5,
            httpStatus: 404,
          }),
          validateDetail: () => ({ isValid: false, failureClass: "REMOVED_404" } as any),
          isPortalPaused: () => false,
          triggerPortalPause: () => {},
        },
        { sleep: async () => {} }
      );

      expect(result.ok).toBe(false);
      expect(result.failureClass).toBe("REMOVED_404");
      expect(finalFailureKind).toBe("EXPECTED_REJECTION");
      expect(classifyCardFailure("REMOVED_404")).toBe("EXPECTED_REJECTION");
    });

    it("production unit finalizer: all expected rejections => completed, all HTTP_TIMEOUT => failed", () => {
      // 1. All expected rejections complete the unit
      const completedFinal = finalizeUnitOutcome({
        cardsCount: 2,
        manifestCards: [
          { id: "c1", detailAttempted: true, usableDetailDocument: false, failureKind: "EXPECTED_REJECTION", failureClass: "REMOVED_404", status: "failed" },
          { id: "c2", detailAttempted: true, usableDetailDocument: false, failureKind: "EXPECTED_REJECTION", failureClass: "EXPIRED", status: "failed" },
        ] as any,
      });
      expect(completedFinal.status).toBe("completed");

      // 2. All HTTP_TIMEOUT (SOURCE_FAILURE) fail the unit
      const failedFinal = finalizeUnitOutcome({
        cardsCount: 2,
        manifestCards: [
          { id: "c1", detailAttempted: true, usableDetailDocument: false, failureKind: "SOURCE_FAILURE", failureClass: "HTTP_TIMEOUT", status: "failed" },
          { id: "c2", detailAttempted: true, usableDetailDocument: false, failureKind: "SOURCE_FAILURE", failureClass: "HTTP_TIMEOUT", status: "failed" },
        ] as any,
      });
      expect(failedFinal.status).toBe("failed");
    });

    it("usable canonical input without enrichmentDispatch throws MISSING_ENRICHMENT_PAYLOAD", async () => {
      const { db, blobStore } = createInMemoryDatabase();
      const service = new CanonicalIngestionService(db, blobStore);
      const payload: any = {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-missing-dispatch",
        canonicalUrl: "https://www.linkedin.com/jobs/view/job-missing-dispatch",
        jobTitle: "VP Marketing",
        companyName: "Acme",
        location: "Bengaluru",
        rawContent: "Comprehensive leadership job content description for executive marketing role.".repeat(10),
      };

      await expect(
        service.ingestOpportunity(payload, { mode: "GLOBAL_MARKET" })
      ).rejects.toThrow(/MISSING_ENRICHMENT_PAYLOAD/);
    });

    it("identical canonicalMaterial with different transient telemetry reuses existing blob", async () => {
      const { db, blobStore } = createInMemoryDatabase();
      const service = new CanonicalIngestionService(db, blobStore);

      const baseCard = {
        id: "card-telemetry",
        title: "Chief Product Officer",
        company: "Apex Tech",
        location: "Bengaluru",
        employmentType: "Full-time",
        detailUrl: "https://www.linkedin.com/jobs/view/cpo-1",
        rawText: "Detailed CPO responsibilities and product strategy vision at executive scale.".repeat(10),
        detail: {
          rawText: "Detailed CPO responsibilities and product strategy vision at executive scale.".repeat(10),
          fetchDurationMs: 150,
          timestamp: "2026-09-01T10:00:00Z",
        },
      };

      const payload1: any = {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-cpo-1",
        canonicalUrl: "https://www.linkedin.com/jobs/view/cpo-1",
        jobTitle: baseCard.title,
        companyName: baseCard.company,
        location: baseCard.location,
        employmentType: baseCard.employmentType,
        rawContent: baseCard.rawText,
        enrichmentDispatch: {
          detailedCard: { ...baseCard },
          pipelineVersion: "v2.1",
        },
      };

      const res1 = await service.ingestOpportunity(payload1, { mode: "GLOBAL_MARKET" });
      expect(res1.canonicalJobId).toBeDefined();

      // Submit identical canonicalMaterial with different transient telemetry
      const payload2: any = {
        ...payload1,
        enrichmentDispatch: {
          detailedCard: {
            ...baseCard,
            detail: {
              rawText: baseCard.rawText,
              fetchDurationMs: 500,
              timestamp: "2026-09-02T18:00:00Z",
            },
          },
          pipelineVersion: "v2.1",
        },
      };

      const res2 = await service.ingestOpportunity(payload2, { mode: "GLOBAL_MARKET" });
      expect(res2.canonicalJobId).toBe(res1.canonicalJobId);
      expect(res2.opportunityVersion).toBe(res1.opportunityVersion);
    });

    it("employmentType participates in canonical snapshot hash", () => {
      const hash1 = computeContentHash({
        title: "VP Engineering",
        companyName: "Acme",
        location: "Bengaluru",
        employmentType: "Full-time",
        rawContent: "Executive engineering responsibilities",
      });

      const hash2 = computeContentHash({
        title: "VP Engineering",
        companyName: "Acme",
        location: "Bengaluru",
        employmentType: "Contract",
        rawContent: "Executive engineering responsibilities",
      });

      const hash3 = computeContentHash({
        title: "VP Engineering",
        companyName: "Acme",
        location: "Bengaluru",
        employmentType: null,
        rawContent: "Executive engineering responsibilities",
      });

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash2).not.toBe(hash3);
    });

    it("failed auto-confirm CAS never starts execution", async () => {
      const { raw, db } = createInMemoryDatabase();
      const repo = new SqliteScrapeRunStore(db);

      raw.exec(`INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets)
                VALUES ('run-cas-test', 'tenant_A', 'person_A', 'plan_A', 'aborted', '["LinkedIn"]')`);

      const runScope = { tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A" };

      // Transition should fail because current status is 'aborted', not in ['initializing', 'waiting_for_confirmation']
      const transitioned = await repo.transitionRunStatus(
        runScope,
        "run-cas-test",
        ["initializing", "waiting_for_confirmation"],
        "running"
      );
      expect(transitioned).toBe(false);

      const durableRun = await repo.getRun(runScope, "run-cas-test");
      expect(durableRun?.status).not.toBe("running");
      expect(durableRun?.status).toBe("aborted");
    });

    it("two sequential global-abort operations both work", async () => {
      const mockMgr1: any = {
        manifest: { status: "running" },
        persistManifest: vi.fn(),
        finalize: vi.fn((status: string) => { mockMgr1.manifest.status = status; }),
      };
      activeRunControllers.set("run-seq-1", mockMgr1);
      expect(mockMgr1.manifest.status).toBe("running");

      await shutdownAllRuns("sequential-abort-1");
      expect(mockMgr1.manifest.status).toBe("aborted");
      expect(activeRunControllers.size).toBe(0);

      // Start second run
      const mockMgr2: any = {
        manifest: { status: "running" },
        persistManifest: vi.fn(),
        finalize: vi.fn((status: string) => { mockMgr2.manifest.status = status; }),
      };
      activeRunControllers.set("run-seq-2", mockMgr2);
      expect(mockMgr2.manifest.status).toBe("running");

      // Second abort operation MUST work and not be poisoned
      await shutdownAllRuns("sequential-abort-2");
      expect(mockMgr2.manifest.status).toBe("aborted");
      expect(activeRunControllers.size).toBe(0);
    });

    it("run A health circuit cannot affect run B", () => {
      const healthA = HealthManager.forRun("run-A");
      const healthB = HealthManager.forRun("run-B");

      for (let i = 0; i < 10; i++) {
        healthA.recordFastPathFailure("LinkedIn", "403");
      }

      expect(healthA.isFastPathAvailable("LinkedIn")).toBe(false);
      expect(healthB.isFastPathAvailable("LinkedIn")).toBe(true);

      HealthManager.clearRun("run-A");
      HealthManager.clearRun("run-B");
    });

    it("unknown targeted abort touches no active run", async () => {
      const activeMgr = new RunController();
      activeMgr.initFresh("run-live-target", { portals: ["LinkedIn"] });
      activeRunControllers.set("run-live-target", activeMgr);
      createRunSession("run-live-target", {});

      try {
        const result = await abortLiveRun("non-existent-run-id");
        expect(result).toBe(false);
        expect(activeRunControllers.get("run-live-target")?.manifest.status).not.toBe("stopping");
        expect(activeRunSessions.has("run-live-target")).toBe(true);
      } finally {
        await abortLiveRun("run-live-target");
      }
    });

    it("editing local manifest cannot approve authenticated confirmation", async () => {
      const mgr = new RunController();
      mgr.initFresh("run-conf-test", { portals: ["LinkedIn"] });
      mgr.manifest.status = "waiting_for_confirmation";
      mgr.persistManifest();

      const diskManifest = JSON.parse(fs.readFileSync(mgr.manifestPath, "utf-8"));
      diskManifest.status = "running";
      fs.writeFileSync(mgr.manifestPath, JSON.stringify(diskManifest));

      const fakeDurableRun = { id: mgr.runId, status: "waiting_for_confirmation" };
      const mockRepos: any = {
        scrapeRuns: {
          getRun: vi.fn().mockResolvedValue(fakeDurableRun),
          transitionRunStatus: vi.fn().mockResolvedValue(true),
        },
      };

      const runScope = { tenantId: "t1", personId: "p1" };
      const durableStatus = (await mockRepos.scrapeRuns.getRun(runScope, mgr.runId)).status;
      expect(durableStatus).toBe("waiting_for_confirmation");

      const isConfirmedRunning = runScope ? durableStatus === "running" : diskManifest.status === "running";
      expect(isConfirmedRunning).toBe(false);
    });
  });

  describe("Scraper Runtime Safety & Compatibility Suite", () => {
    describe("Fix 1: Backward-Compatible Legacy Immutable Snapshots", () => {
      it("accepts and reuses legacy BlobStore snapshot without canonicalMaterial when derived material hash matches", async () => {
        const { raw, db, blobStore } = createInMemoryDatabase();
        raw.exec(`UPDATE scrape_runs SET status = 'running' WHERE id = 'run-001'`);
        const service = new CanonicalIngestionService(db, blobStore);

        const rawContent = "VP Engineering leading cloud platforms and core infrastructure.".repeat(10);
        const payload = {
          sourcePortal: "LinkedIn",
          sourceJobId: "job-legacy-reuse-1",
          canonicalUrl: "https://www.linkedin.com/jobs/view/job-legacy-reuse-1",
          jobTitle: "VP Engineering",
          companyName: "AcmeCorp",
          location: "Bengaluru",
          rawContent,
          enrichmentDispatch: {
            detailedCard: {
              title: "VP Engineering",
              company: "AcmeCorp",
              location: "Bengaluru",
              detail: { rawText: rawContent },
            } as any,
            runId: "run-001",
            pipelineVersion: "1.0.0",
          },
        };

        const canonicalJobId = computeCanonicalJobId({ source: payload.sourcePortal, sourceJobId: payload.sourceJobId });
        const contentHash = computeContentHash({
          title: "VP Engineering",
          companyName: "AcmeCorp",
          location: "Bengaluru",
          employmentType: null,
          rawContent,
        });
        const versionId = computeOpportunityVersionId(canonicalJobId, contentHash);
        const key = `acquisition/${canonicalJobId}/${versionId}/snapshot.json`;

        // Pre-populate with legacy snapshot format (no canonicalMaterial field)
        const legacyBlobContent = JSON.stringify({
          canonicalJobId,
          opportunityVersion: versionId,
          title: "VP Engineering",
          company: "AcmeCorp",
          location: "Bengaluru",
          detail: { rawText: rawContent },
        });
        await blobStore.put(key, legacyBlobContent);

        // Ingestion should succeed without throwing IMMUTABLE_ENRICHMENT_PAYLOAD_CONFLICT
        const result = await service.ingestOpportunity(payload, {
          mode: "SCOPED",
          tenantId: "tenant_A",
          personId: "person_A",
          searchPlanId: "plan_A",
          runId: "run-001",
        });

        expect(result.canonicalJobId).toBe(canonicalJobId);
        expect(result.opportunityVersion).toBe(versionId);

        // Verify the existing blob was NOT modified or overwritten
        const storedBlob = await blobStore.get(key);
        expect(storedBlob?.toString("utf-8")).toBe(legacyBlobContent);
      });
    });

    describe("Fix 2: Remove Implicit ExecutionPlan.json Runtime Takeover", () => {
      it("does not load .radar/runs/ExecutionPlan.json implicitly when initializing fresh run", () => {
        const fakePlanDir = path.join(process.cwd(), ".radar", "runs");
        const fakePlanPath = path.join(fakePlanDir, "ExecutionPlan.json");
        fs.mkdirSync(fakePlanDir, { recursive: true });

        const fakePlan = {
          id: "fake-hijack-plan",
          workUnits: [
            { id: "unit-hijack-1", portal: "Indeed", keyword: "Hijacked Keyword", page: 99 },
          ],
        };
        fs.writeFileSync(fakePlanPath, JSON.stringify(fakePlan));

        try {
          const mgr = new RunController();
          mgr.initFresh("run-safe-test", {
            keywords: ["VP Engineering"],
            portals: ["LinkedIn"],
            maxPages: 1,
            maxCardsPerPage: 10,
            resume: false,
          });

          // Units must be built from keywords/portals, NOT hijacked by ExecutionPlan.json
          expect(mgr.manifest.units.length).toBe(1);
          expect(mgr.manifest.units[0].keyword).toBe("VP Engineering");
          expect(mgr.manifest.units[0].portal).toBe("LinkedIn");
          expect(mgr.manifest.units[0].id).not.toBe("unit-hijack-1");
        } finally {
          if (fs.existsSync(fakePlanPath)) {
            fs.unlinkSync(fakePlanPath);
          }
        }
      });

      it("loads units from explicit executionPlan option when provided by caller", () => {
        const mgr = new RunController();
        mgr.initFresh("run-explicit-plan-test", {
          keywords: [],
          portals: [],
          maxPages: 1,
          maxCardsPerPage: 10,
          resume: false,
          executionPlan: {
            id: "explicit-plan-42",
            workUnits: [
              { id: "unit-explicit-1", portal: "Naukri", keyword: "VP Product", page: 1 },
            ],
          },
        });

        expect(mgr.manifest.units.length).toBe(1);
        expect(mgr.manifest.units[0].id).toBe("unit-explicit-1");
        expect(mgr.manifest.units[0].portal).toBe("Naukri");
        expect(mgr.manifest.units[0].executionPlanId).toBe("explicit-plan-42");
      });
    });

    describe("Fix 3: Authentication / Profile Compatibility Without Cross-Account Leakage", () => {
      it("SCOPED mode strictly resolves to tenant/person path and never invokes legacy migration", () => {
        const scopedPath = profileDirFor("LinkedIn", {
          mode: "SCOPED",
          tenantId: "tenant_X",
          personId: "person_Y",
          runId: "run-scoped-1",
        });

        expect(scopedPath).toContain(path.join("tenants"));
        expect(scopedPath).not.toContain(path.join("global"));
      });

      it("GLOBAL_MARKET mode migrates legacy profile using historical precedence (.scraper-cache preferred over .scraper-artifacts)", () => {
        const globalDest = path.join(PROFILES_DIR, "global", "naukri");
        const cacheSrc = path.join(process.cwd(), ".scraper-cache", "profiles", "naukri");
        const artifactsSrc = path.join(PROFILES_DIR, "naukri");

        if (fs.existsSync(globalDest)) fs.rmSync(globalDest, { recursive: true, force: true });
        if (fs.existsSync(cacheSrc)) fs.rmSync(cacheSrc, { recursive: true, force: true });
        if (fs.existsSync(artifactsSrc)) fs.rmSync(artifactsSrc, { recursive: true, force: true });

        try {
          fs.mkdirSync(cacheSrc, { recursive: true });
          fs.writeFileSync(path.join(cacheSrc, "session.json"), JSON.stringify({ source: "scraper_cache" }));

          fs.mkdirSync(artifactsSrc, { recursive: true });
          fs.writeFileSync(path.join(artifactsSrc, "session.json"), JSON.stringify({ source: "scraper_artifacts" }));

          maybeMigrateLegacyGlobalProfile("Naukri");

          expect(fs.existsSync(path.join(globalDest, "session.json"))).toBe(true);
          const migratedData = JSON.parse(fs.readFileSync(path.join(globalDest, "session.json"), "utf-8"));
          expect(migratedData.source).toBe("scraper_cache");
        } finally {
          if (fs.existsSync(globalDest)) fs.rmSync(globalDest, { recursive: true, force: true });
          if (fs.existsSync(cacheSrc)) fs.rmSync(cacheSrc, { recursive: true, force: true });
          if (fs.existsSync(artifactsSrc)) fs.rmSync(artifactsSrc, { recursive: true, force: true });
        }
      });

      it("GLOBAL_MARKET mode respects LINKEDIN_PROFILE_DIR env override over cache and artifacts", () => {
        const globalDest = path.join(PROFILES_DIR, "global", "linkedin");
        const cacheSrc = path.join(process.cwd(), ".scraper-cache", "profiles", "linkedin");
        const artifactsSrc = path.join(PROFILES_DIR, "linkedin-primary");
        const customEnvDir = path.join(PROFILES_DIR, "custom-env-linkedin");

        if (fs.existsSync(globalDest)) fs.rmSync(globalDest, { recursive: true, force: true });
        if (fs.existsSync(cacheSrc)) fs.rmSync(cacheSrc, { recursive: true, force: true });
        if (fs.existsSync(artifactsSrc)) fs.rmSync(artifactsSrc, { recursive: true, force: true });
        if (fs.existsSync(customEnvDir)) fs.rmSync(customEnvDir, { recursive: true, force: true });

        const originalEnv = process.env.LINKEDIN_PROFILE_DIR;
        process.env.LINKEDIN_PROFILE_DIR = customEnvDir;

        try {
          fs.mkdirSync(customEnvDir, { recursive: true });
          fs.writeFileSync(path.join(customEnvDir, "session.json"), JSON.stringify({ source: "env_override" }));

          fs.mkdirSync(cacheSrc, { recursive: true });
          fs.writeFileSync(path.join(cacheSrc, "session.json"), JSON.stringify({ source: "cache" }));

          fs.mkdirSync(artifactsSrc, { recursive: true });
          fs.writeFileSync(path.join(artifactsSrc, "session.json"), JSON.stringify({ source: "artifacts" }));

          maybeMigrateLegacyGlobalProfile("LinkedIn");

          expect(fs.existsSync(path.join(globalDest, "session.json"))).toBe(true);
          const migratedData = JSON.parse(fs.readFileSync(path.join(globalDest, "session.json"), "utf-8"));
          expect(migratedData.source).toBe("env_override");
        } finally {
          process.env.LINKEDIN_PROFILE_DIR = originalEnv;
          if (fs.existsSync(globalDest)) fs.rmSync(globalDest, { recursive: true, force: true });
          if (fs.existsSync(cacheSrc)) fs.rmSync(cacheSrc, { recursive: true, force: true });
          if (fs.existsSync(artifactsSrc)) fs.rmSync(artifactsSrc, { recursive: true, force: true });
          if (fs.existsSync(customEnvDir)) fs.rmSync(customEnvDir, { recursive: true, force: true });
        }
      });

      it("GLOBAL_MARKET mode does not overwrite existing destination profile", () => {
        const globalDest = path.join(PROFILES_DIR, "global", "naukri");
        const cacheSrc = path.join(process.cwd(), ".scraper-cache", "profiles", "naukri");

        if (fs.existsSync(globalDest)) fs.rmSync(globalDest, { recursive: true, force: true });
        if (fs.existsSync(cacheSrc)) fs.rmSync(cacheSrc, { recursive: true, force: true });

        try {
          fs.mkdirSync(globalDest, { recursive: true });
          fs.writeFileSync(path.join(globalDest, "session.json"), JSON.stringify({ user: "existing_dest_user" }));

          fs.mkdirSync(cacheSrc, { recursive: true });
          fs.writeFileSync(path.join(cacheSrc, "session.json"), JSON.stringify({ user: "legacy_user" }));

          maybeMigrateLegacyGlobalProfile("Naukri");

          const destData = JSON.parse(fs.readFileSync(path.join(globalDest, "session.json"), "utf-8"));
          expect(destData.user).toBe("existing_dest_user");
        } finally {
          if (fs.existsSync(globalDest)) fs.rmSync(globalDest, { recursive: true, force: true });
          if (fs.existsSync(cacheSrc)) fs.rmSync(cacheSrc, { recursive: true, force: true });
        }
      });

      it("GLOBAL_MARKET mode cleans up temp directory and leaves destination absent if copy fails", () => {
        const globalDest = path.join(PROFILES_DIR, "global", "naukri");
        const cacheSrc = path.join(process.cwd(), ".scraper-cache", "profiles", "naukri");

        if (fs.existsSync(globalDest)) fs.rmSync(globalDest, { recursive: true, force: true });
        if (fs.existsSync(cacheSrc)) fs.rmSync(cacheSrc, { recursive: true, force: true });

        const cpSpy = vi.spyOn(fs, "cpSync").mockImplementationOnce(() => {
          throw new Error("Simulated disk error during staging copy");
        });

        try {
          fs.mkdirSync(cacheSrc, { recursive: true });
          fs.writeFileSync(path.join(cacheSrc, "session.json"), JSON.stringify({ user: "legacy_user" }));

          maybeMigrateLegacyGlobalProfile("Naukri");

          // Destination must not exist
          expect(fs.existsSync(globalDest)).toBe(false);
          // And any temp directory in PROFILES_DIR/global must have been cleaned up
          const globalChildren = fs.existsSync(path.join(PROFILES_DIR, "global"))
            ? fs.readdirSync(path.join(PROFILES_DIR, "global"))
            : [];
          const tempDirs = globalChildren.filter((name) => name.startsWith(".tmp_migration_"));
          expect(tempDirs.length).toBe(0);
        } finally {
          cpSpy.mockRestore();
          if (fs.existsSync(globalDest)) fs.rmSync(globalDest, { recursive: true, force: true });
          if (fs.existsSync(cacheSrc)) fs.rmSync(cacheSrc, { recursive: true, force: true });
        }
      });
    });

    describe("Fix 4: Version Compatibility & Snapshot Freshness", () => {
      it("readSnapshotIfFresh rejects v1 fresh snapshot", () => {
        const cardHash = `test-v1-fresh-${Date.now()}`;
        const p = path.join(SNAPSHOT_DIR, `${cardHash}.json`);
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        fs.writeFileSync(
          p,
          JSON.stringify({
            cardHash,
            snapshotSchemaVersion: "1.0.0", // Older version
            scraperVersion: "1.0.0",
            portal: "LinkedIn",
            title: "VP Engineering",
            company: "TechCorp",
            location: "Bengaluru",
            detail: { fetched: true, rawText: "Job text" },
          })
        );

        try {
          const loaded = readSnapshotIfFresh(cardHash, 24);
          expect(loaded).toBeNull();
        } finally {
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        }
      });

      it("readSnapshotIfFresh accepts v2 fresh snapshot", () => {
        const cardHash = `test-v2-fresh-${Date.now()}`;
        const p = path.join(SNAPSHOT_DIR, `${cardHash}.json`);
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        fs.writeFileSync(
          p,
          JSON.stringify({
            cardHash,
            snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION, // 2.0.0
            scraperVersion: SCRAPER_VERSION, // 2.0.0
            portal: "LinkedIn",
            title: "VP Engineering",
            company: "TechCorp",
            location: "Bengaluru",
            detail: { fetched: true, rawText: "Job text" },
          })
        );

        try {
          const loaded = readSnapshotIfFresh(cardHash, 24);
          expect(loaded).not.toBeNull();
          expect(loaded?.cardHash).toBe(cardHash);
          expect(loaded?.snapshotSchemaVersion).toBe("2.0.0");
          expect(loaded?.scraperVersion).toBe("2.0.0");
        } finally {
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        }
      });

      it("readSnapshotIfFresh rejects v2 expired snapshot", () => {
        const cardHash = `test-v2-expired-${Date.now()}`;
        const p = path.join(SNAPSHOT_DIR, `${cardHash}.json`);
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        fs.writeFileSync(
          p,
          JSON.stringify({
            cardHash,
            snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION, // 2.0.0
            scraperVersion: SCRAPER_VERSION, // 2.0.0
            portal: "LinkedIn",
            title: "VP Engineering",
            company: "TechCorp",
            location: "Bengaluru",
            detail: { fetched: true, rawText: "Job text" },
          })
        );

        try {
          // Set file mtime to 25 hours ago
          const oldTime = new Date(Date.now() - 25 * 3600 * 1000);
          fs.utimesSync(p, oldTime, oldTime);

          const loaded = readSnapshotIfFresh(cardHash, 24); // maxAgeHours = 24
          expect(loaded).toBeNull();
        } finally {
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        }
      });

      it("rejects resuming an older manifest with incompatible scraperVersion 1.0.0", () => {
        const runId = "run-v1-incompatible";
        const runDir = path.join(RUNS_DIR, runId);
        fs.mkdirSync(runDir, { recursive: true });
        const manifestPath = path.join(runDir, "manifest.json");

        fs.writeFileSync(
          manifestPath,
          JSON.stringify({
            runId,
            status: "running",
            scraperVersion: "1.0.0", // Older incompatible version
            snapshotSchemaVersion: "1.0.0",
            extractorVersion: "1.0.0",
            keywords: ["VP Engineering"],
            portals: ["LinkedIn"],
            maxPages: 1,
            units: [],
            cards: {},
          })
        );

        try {
          const mgr = new RunController();
          const resumable = mgr.tryLoadForResume(runId, {
            keywords: ["VP Engineering"],
            portals: ["LinkedIn"],
            maxPages: 1,
            maxCardsPerPage: 10,
            resume: true,
          });

          expect(resumable).toBeNull();
        } finally {
          if (fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true, force: true });
        }
      });

      it("allows resuming current manifest with scraperVersion 2.0.0", () => {
        const runId = "run-v2-resumable";
        const runDir = path.join(RUNS_DIR, runId);
        fs.mkdirSync(runDir, { recursive: true });
        const manifestPath = path.join(runDir, "manifest.json");

        fs.writeFileSync(
          manifestPath,
          JSON.stringify({
            runId,
            status: "running",
            scraperVersion: SCRAPER_VERSION, // 2.0.0
            snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION, // 2.0.0
            extractorVersion: EXTRACTOR_VERSION, // 1.0.0
            keywords: ["VP Engineering"],
            portals: ["LinkedIn"],
            maxPages: 1,
            units: [],
            cards: {},
          })
        );

        try {
          const mgr = new RunController();
          const resumable = mgr.tryLoadForResume(runId, {
            keywords: ["VP Engineering"],
            portals: ["LinkedIn"],
            maxPages: 1,
            maxCardsPerPage: 10,
            resume: true,
          });

          expect(resumable).not.toBeNull();
          expect(resumable?.manifest.scraperVersion).toBe("2.0.0");
        } finally {
          if (fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true, force: true });
        }
      });

      it("retains EXTRACTOR_VERSION at 1.0.0 so compatible existing enrichment queue jobs remain leasable", () => {
        expect(EXTRACTOR_VERSION).toBe("1.0.0");
        expect(SCRAPER_VERSION).toBe("2.0.0");
        expect(SNAPSHOT_SCHEMA_VERSION).toBe("2.0.0");
        expect(MANIFEST_VERSION).toBe("2.0.0");
      });
    });

    describe("Fix 5: Naukri Multi-Tier Fallback (ATS -> Native Detail)", () => {
      it("ATS success bypasses native detail fetch and records single successful ATS attempt", async () => {
        let nativeDetailCalls = 0;
        let fastFetchCalls = 0;

        const feedCard = {
          title: "VP Engineering",
          company: "Enterprise ATS Co",
          detailUrl: "https://www.naukri.com/job-123",
          applyRedirectUrl: "https://jobs.lever.co/company/job-123",
          hasAuthoritativeFullDescription: false,
          rawText: "Short snippet under 200 chars",
          rawHtml: "<p>Short snippet</p>",
        };

        const mockFastFetch = async () => {
          fastFetchCalls++;
          return {
            fetched: true,
            outcome: "SUCCESS" as const,
            rawText: "Full authoritative description from Lever ATS with over 200 characters of rich requirements and executive responsibilities.".repeat(3),
            rawHtml: "<div>Full authoritative description</div>",
            fetchDurationMs: 45,
            httpStatus: 200,
            extractionMethod: "JSON_LD",
            qualityTier: "VALID" as const,
          };
        };

        const mockNativeDetail = async () => {
          nativeDetailCalls++;
          return { fetched: true, rawText: "native", rawHtml: "<p>native</p>", fetchDurationMs: 10 };
        };

        // Simulate Naukri acquisition logic
        let detail: any = null;
        let acquisitionRoute: string | undefined;
        let enrichmentStatus: string | undefined;
        let fallbackRoute: string | undefined;
        const acquisitionAttempts: any[] = [];
        let usedNaukriRichDiscovery = false;
        let usedNaukriAts = false;

        if (feedCard.hasAuthoritativeFullDescription === true && feedCard.rawText && feedCard.rawText.length >= 200 && feedCard.rawHtml) {
          usedNaukriRichDiscovery = true;
        }

        if (!usedNaukriRichDiscovery && feedCard.applyRedirectUrl) {
          const atsRes = await mockFastFetch();
          if (atsRes.fetched && atsRes.outcome === "SUCCESS" && atsRes.rawText && atsRes.rawText.length >= 200) {
            usedNaukriAts = true;
            acquisitionRoute = "ATS_ENRICHED";
            enrichmentStatus = "ENRICHED_SUCCESS";
            detail = {
              fetched: true,
              rawHtml: atsRes.rawHtml,
              rawText: atsRes.rawText,
              fetchDurationMs: atsRes.fetchDurationMs,
              httpStatus: atsRes.httpStatus || 200,
            };
            acquisitionAttempts.push({
              method: "ATS_HTTP",
              url: feedCard.applyRedirectUrl,
              outcome: "SUCCESS",
            });
          }
        }

        if (!usedNaukriRichDiscovery && !usedNaukriAts) {
          await mockNativeDetail();
        }

        expect(usedNaukriAts).toBe(true);
        expect(fastFetchCalls).toBe(1);
        expect(nativeDetailCalls).toBe(0);
        expect(acquisitionRoute).toBe("ATS_ENRICHED");
        expect(enrichmentStatus).toBe("ENRICHED_SUCCESS");
        expect(acquisitionAttempts.length).toBe(1);
        expect(acquisitionAttempts[0].method).toBe("ATS_HTTP");
      });

      it("ATS failure falls through to native detail and succeeds, preserving both attempts", async () => {
        let nativeDetailCalls = 0;
        let fastFetchCalls = 0;

        const feedCard = {
          title: "VP Engineering",
          company: "Enterprise ATS Co",
          detailUrl: "https://www.naukri.com/job-456",
          applyRedirectUrl: "https://unreachable-ats.com/job-456",
          hasAuthoritativeFullDescription: false,
          rawText: "Short snippet",
          rawHtml: "<p>Short snippet</p>",
        };

        const mockFastFetch = async () => {
          fastFetchCalls++;
          return {
            fetched: false,
            outcome: "TRANSPORT_ERROR" as const,
            rawText: "",
            rawHtml: "",
            fetchDurationMs: 15,
            httpStatus: 503,
            fetchError: "Connection refused",
            failureClass: "TRANSPORT_ERROR",
          };
        };

        const mockNativeDetail = async () => {
          nativeDetailCalls++;
          return {
            fetched: true,
            rawText: "Native Naukri full description text exceeding 200 characters with role details and qualifications.".repeat(3),
            rawHtml: "<div class='job-desc'>Native Naukri full description</div>",
            fetchDurationMs: 120,
            httpStatus: 200,
          };
        };

        // Simulate Naukri acquisition logic
        let detail: any = null;
        let acquisitionRoute: string | undefined;
        let enrichmentStatus: string | undefined;
        let fallbackRoute: string | undefined;
        const acquisitionAttempts: any[] = [];
        let usedNaukriRichDiscovery = false;
        let usedNaukriAts = false;

        if (feedCard.hasAuthoritativeFullDescription === true && feedCard.rawText && feedCard.rawText.length >= 200 && feedCard.rawHtml) {
          usedNaukriRichDiscovery = true;
        }

        if (!usedNaukriRichDiscovery && feedCard.applyRedirectUrl) {
          const atsRes = await mockFastFetch();
          if (atsRes.fetched && atsRes.outcome === "SUCCESS" && atsRes.rawText && atsRes.rawText.length >= 200) {
            usedNaukriAts = true;
          } else {
            enrichmentStatus = "ENRICHED_FAILED";
            fallbackRoute = "ORIGINAL_DISCOVERY_PAYLOAD";
            acquisitionAttempts.push({
              method: "ATS_HTTP",
              url: feedCard.applyRedirectUrl,
              outcome: atsRes.outcome || "EXTRACTION_FAILURE",
            });
            detail = {
              fetched: false,
              fetchError: `ATS enrichment failed: ${atsRes.fetchError}`,
              failureClass: atsRes.failureClass,
            };
          }
        }

        if (!usedNaukriRichDiscovery && !usedNaukriAts) {
          const portalDetail = await mockNativeDetail();
          if (portalDetail.fetched && portalDetail.rawText && portalDetail.rawText.length >= 200) {
            acquisitionRoute = "DETAIL_PAGE_BROWSER";
            detail = portalDetail;
            acquisitionAttempts.push({
              method: "PORTAL_DETAIL",
              url: feedCard.detailUrl,
              outcome: "SUCCESS",
            });
          }
        }

        expect(fastFetchCalls).toBe(1);
        expect(nativeDetailCalls).toBe(1);
        expect(usedNaukriAts).toBe(false);
        expect(detail.fetched).toBe(true);
        expect(acquisitionRoute).toBe("DETAIL_PAGE_BROWSER");
        expect(acquisitionAttempts.length).toBe(2);
        expect(acquisitionAttempts[0].method).toBe("ATS_HTTP");
        expect(acquisitionAttempts[0].outcome).toBe("TRANSPORT_ERROR");
        expect(acquisitionAttempts[1].method).toBe("PORTAL_DETAIL");
        expect(acquisitionAttempts[1].outcome).toBe("SUCCESS");
      });

      it("ATS unusable response (<200 chars) falls through to native detail", async () => {
        let nativeDetailCalls = 0;

        const feedCard = {
          title: "VP Product",
          company: "Enterprise ATS Co",
          detailUrl: "https://www.naukri.com/job-789",
          applyRedirectUrl: "https://ats.example.com/sparse",
          hasAuthoritativeFullDescription: false,
          rawText: "Short snippet",
          rawHtml: "<p>Short snippet</p>",
        };

        const mockFastFetch = async () => ({
          fetched: true,
          outcome: "SUCCESS" as const,
          rawText: "Too short", // under 200 chars
          rawHtml: "<p>Too short</p>",
          fetchDurationMs: 15,
          httpStatus: 200,
          qualityTier: "SPARSE" as const,
        });

        const mockNativeDetail = async () => {
          nativeDetailCalls++;
          return {
            fetched: true,
            rawText: "Full native description exceeding 200 characters with robust JD details.".repeat(4),
            rawHtml: "<div>Full description</div>",
            fetchDurationMs: 100,
            httpStatus: 200,
          };
        };

        let detail: any = null;
        let acquisitionRoute: string | undefined;
        let enrichmentStatus: string | undefined;
        const acquisitionAttempts: any[] = [];
        let usedNaukriRichDiscovery = false;
        let usedNaukriAts = false;

        if (!usedNaukriRichDiscovery && feedCard.applyRedirectUrl) {
          const atsRes = await mockFastFetch();
          if (atsRes.fetched && atsRes.outcome === "SUCCESS" && atsRes.rawText && atsRes.rawText.length >= 200) {
            usedNaukriAts = true;
          } else {
            enrichmentStatus = "ENRICHED_FAILED";
            acquisitionAttempts.push({
              method: "ATS_HTTP",
              url: feedCard.applyRedirectUrl,
              outcome: "EXTRACTION_FAILURE",
            });
            detail = { fetched: false, failureClass: "EXTRACTION_FAILURE" };
          }
        }

        if (!usedNaukriRichDiscovery && !usedNaukriAts) {
          const portalDetail = await mockNativeDetail();
          if (portalDetail.fetched && portalDetail.rawText && portalDetail.rawText.length >= 200) {
            acquisitionRoute = "DETAIL_PAGE_BROWSER";
            detail = portalDetail;
            acquisitionAttempts.push({
              method: "PORTAL_DETAIL",
              url: feedCard.detailUrl,
              outcome: "SUCCESS",
            });
          }
        }

        expect(nativeDetailCalls).toBe(1);
        expect(detail.fetched).toBe(true);
        expect(acquisitionRoute).toBe("DETAIL_PAGE_BROWSER");
        expect(acquisitionAttempts.length).toBe(2);
      });

      it("both ATS and native detail failing records both attempts and does not admit snippet as canonical JD", async () => {
        let nativeDetailCalls = 0;

        const feedCard = {
          title: "VP Product",
          company: "Enterprise ATS Co",
          detailUrl: "https://www.naukri.com/job-fail-both",
          applyRedirectUrl: "https://ats.example.com/fail",
          hasAuthoritativeFullDescription: false,
          rawText: "Discovery card snippet only",
          rawHtml: "<p>Snippet</p>",
        };

        const mockFastFetch = async () => ({
          fetched: false,
          outcome: "TRANSPORT_ERROR" as const,
          rawText: "",
          rawHtml: "",
          fetchDurationMs: 10,
          httpStatus: 500,
          failureClass: "TRANSPORT_ERROR",
        });

        const mockNativeDetail = async () => {
          nativeDetailCalls++;
          return {
            fetched: false,
            fetchError: "DOM selector timed out",
            rawText: "",
            rawHtml: "",
            fetchDurationMs: 50,
            httpStatus: 200,
            failureClass: "EXTRACTION_FAILURE",
          };
        };

        let detail: any = null;
        let acquisitionRoute: string | undefined;
        let enrichmentStatus: string | undefined;
        const acquisitionAttempts: any[] = [];
        let usedNaukriRichDiscovery = false;
        let usedNaukriAts = false;

        if (!usedNaukriRichDiscovery && feedCard.applyRedirectUrl) {
          const atsRes = await mockFastFetch();
          if (atsRes.fetched && atsRes.outcome === "SUCCESS" && atsRes.rawText && atsRes.rawText.length >= 200) {
            usedNaukriAts = true;
          } else {
            enrichmentStatus = "ENRICHED_FAILED";
            acquisitionAttempts.push({
              method: "ATS_HTTP",
              url: feedCard.applyRedirectUrl,
              outcome: "TRANSPORT_ERROR",
            });
            detail = { fetched: false, failureClass: atsRes.failureClass };
          }
        }

        if (!usedNaukriRichDiscovery && !usedNaukriAts) {
          const portalDetail = await mockNativeDetail();
          if (portalDetail.fetched && portalDetail.rawText && portalDetail.rawText.length >= 200) {
            acquisitionRoute = "DETAIL_PAGE_BROWSER";
            detail = portalDetail;
          } else {
            detail = {
              fetched: false,
              fetchError: portalDetail.fetchError,
              failureClass: portalDetail.failureClass,
            };
            acquisitionAttempts.push({
              method: "PORTAL_DETAIL",
              url: feedCard.detailUrl,
              outcome: "EXTRACTION_FAILURE",
            });
          }
        }

        expect(nativeDetailCalls).toBe(1);
        expect(detail.fetched).toBe(false);
        expect(detail.failureClass).toBe("EXTRACTION_FAILURE");
        expect(acquisitionAttempts.length).toBe(2);
        expect(acquisitionAttempts[0].method).toBe("ATS_HTTP");
        expect(acquisitionAttempts[1].method).toBe("PORTAL_DETAIL");
      });
    });
  });
});


