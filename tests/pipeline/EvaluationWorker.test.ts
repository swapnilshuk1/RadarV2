import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EvaluationWorker } from "../../src/lib/intelligence/EvaluationWorker";
import { DatabaseAdapter } from "../../src/data/database";
import { computeEvaluationIdentity } from "../../src/lib/domain/evaluation_fingerprint";
import { isCanonicalIntrinsicEvaluationV4_3, isCanonicalUnavailablePayload } from "../../src/lib/domain/evaluation_payloads";
import type { EvaluationContext } from "../../src/lib/domain/evaluation_context";
import { runEngineSingle, runEngineSingleIntrinsic } from "../../src/lib/intelligence/engine";
import { buildCanonicalDossierPresentation } from "../../src/lib/intelligence/dossier/CanonicalDossierBuilder";

vi.mock("../../src/lib/intelligence/engine", () => ({
  runEngineSingleIntrinsic: vi.fn(),
  runEngineSingle: vi.fn()
}));
vi.mock("../../src/lib/intelligence/dossier/CanonicalDossierBuilder", () => ({
  buildCanonicalDossierPresentation: vi.fn(),
}));

const mockLeaseToken = "lease-token-123";
const workerId = "test-worker";

const mockContext: EvaluationContext = {
  contextFingerprint: "ctx-123",
  tenantId: "t-1",
  personId: "p-1",
  searchPlanSnapshotId: "snap-1",
  ontologyVersion: "1.0",
  ontologyFingerprint: "ont-1",
  policyVersion: "2.0",
  profileVersion: "3.0",
  createdAt: "2026-08-28T00:00:00Z"
};

const mockIdentity = computeEvaluationIdentity("job-1", "v1", mockContext.contextFingerprint);

describe("EvaluationWorker - Phase 2C Integration", () => {
  let db: any;
  let worker: EvaluationWorker;

  beforeEach(() => {
    db = {
      one: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn(async (cb) => {
        return await cb(db);
      })
    };
    worker = new EvaluationWorker(workerId, { adapter: db as unknown as DatabaseAdapter });
    vi.mocked(buildCanonicalDossierPresentation).mockReturnValue({
      schemaVersion: "dossier-v1",
      generatedAt: "2026-08-28T00:00:00Z",
      evaluationInputHash: mockIdentity.idempotencyKey,
      brief: {}, jobProjection: {}, executionPackage: {}, rawDimensions: [], focusTopic: null, whyRoleExists: null,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists a canonical evaluated payload and matches relational fields", async () => {
    const job = {
      id: "job-id",
      tenantId: "t-1",
      personId: "p-1",
      searchPlanId: "snap-1",
      canonicalJobId: "job-1",
      opportunityVersion: "v1",
      evaluationContextFingerprint: mockContext.contextFingerprint,
      leaseToken: mockLeaseToken,
      attempts: 0,
      maxAttempts: 3
    };

    const mockOppSource = { jobHash: "job-1", role: "CEO", company: "Test" };
    
    // Auth success
    db.one.mockImplementationOnce(async (sql: string) => {
      return { id: "p-1" }; 
    });

    // Version query success (ACQUIRED / ACTIVE)
    db.one.mockImplementationOnce(async () => {
      return {
        raw_content: JSON.stringify(mockOppSource),
        job_title: "CEO",
        company_name: "Test",
        location: "Remote",
        acquisition_status: "ACQUIRED",
        acquisition_quality: "COMPLETE",
        lifecycle_state: "ACTIVE",
        evidence_state: "SUFFICIENT"
      };
    });

    // Context query success
    db.one.mockImplementationOnce(async () => {
      return {
        payload_json: "{}",
        tenant_id: mockContext.tenantId,
        person_id: mockContext.personId,
        search_plan_snapshot_id: mockContext.searchPlanSnapshotId,
        ontology_version: mockContext.ontologyVersion,
        ontology_fingerprint: mockContext.ontologyFingerprint,
        policy_version: mockContext.policyVersion,
        profile_version: mockContext.profileVersion,
        created_at: mockContext.createdAt
      };
    });
    
    // Snapshot followed by projection pinned by the immutable context.
    db.one.mockImplementationOnce(async () => ({ payload_json: "{}" }));
    db.one.mockImplementationOnce(async () => ({ projection_json: JSON.stringify({
      profileVersion: mockContext.profileVersion,
      operatingLevel: { value: "STRATEGIC" }, workNature: { value: "STRATEGIC_WORK" },
      decisionAuthority: { value: "ENTERPRISE" }, commercialScope: { value: "ENTERPRISE" },
      yearsOfExperience: 20, coreCapabilities: ["COMMERCIAL_GROWTH"],
      preferredLocations: ["Gurugram"], preferredWorkModel: "HYBRID", executiveThemes: ["growth"],
    }) }));

    // Mock engine
    vi.mocked(runEngineSingleIntrinsic).mockReturnValueOnce({
      record: {
        verb: "PURSUE",
        qualityScore: 85,
        diligenceStatus: "READY"
      },
      opportunity: { jobHash: "job-1", role: "CEO", company: "Test", location: "Remote", dimensions: [] },
      jobProjection: {}
    } as any);

    // Lease check inside transaction
    db.one.mockImplementationOnce(async () => ({ id: "job-id" }));

    db.execute.mockResolvedValue({ rowsAffected: 1 });

    const result = await worker.processJob(job);

    expect(result.status).toBe("completed");
    expect(result.decision).toBe("PURSUE");
    
    expect(runEngineSingleIntrinsic).toHaveBeenCalledTimes(1);

    // Verify INSERT INTO materialized_evaluations
    const insertCall = db.execute.mock.calls.find((call: any[]) => String(call[0]).includes("INSERT INTO materialized_evaluations"));
    expect(insertCall).toBeDefined();

    const params = insertCall[1];
    expect(params[0]).toBe(mockIdentity.idempotencyKey);
    expect(params[1]).toBe("t-1");
    expect(params[2]).toBe("p-1");
    expect(params[3]).toBe("job-1");
    expect(params[4]).toBe("v1");
    expect(params[5]).toBe(mockContext.contextFingerprint);
    expect(params[6]).toBe(mockIdentity.idempotencyKey); // evaluation fingerprint
    expect(params[7]).toBe("EVALUATED"); // relational evaluation_state
    expect(params[8]).toBe("PURSUE"); // relational decision
    expect(params[9]).toBe(85); // relational quality_score
    expect(JSON.parse(params[12]).dossierPresentation.schemaVersion).toBe("dossier-v1");
  });

  it("persists a canonical unavailable payload for EXPIRED job", async () => {
    const job = {
      id: "job-id",
      tenantId: "t-1",
      personId: "p-1",
      searchPlanId: "snap-1",
      canonicalJobId: "job-1",
      opportunityVersion: "v1",
      evaluationContextFingerprint: mockContext.contextFingerprint,
      leaseToken: mockLeaseToken,
      attempts: 0,
      maxAttempts: 3
    };

    // Auth success
    db.one.mockImplementationOnce(async () => ({ id: "p-1" }));

    // Version query returns EXPIRED
    db.one.mockImplementationOnce(async () => {
      return {
        raw_content: "{}",
        job_title: "CEO",
        company_name: "Test",
        location: "Remote",
        acquisition_status: "ACQUIRED",
        acquisition_quality: "COMPLETE",
        lifecycle_state: "EXPIRED",
        evidence_state: "SUFFICIENT"
      };
    });

    // Context query success
    db.one.mockImplementationOnce(async () => {
      return {
        payload_json: "{}",
        tenant_id: mockContext.tenantId,
        person_id: mockContext.personId,
        search_plan_snapshot_id: mockContext.searchPlanSnapshotId,
        ontology_version: mockContext.ontologyVersion,
        ontology_fingerprint: mockContext.ontologyFingerprint,
        policy_version: mockContext.policyVersion,
        profile_version: mockContext.profileVersion,
        created_at: mockContext.createdAt
      };
    });

    // Lease check inside transaction
    db.one.mockImplementationOnce(async () => ({ id: "job-id" }));
    db.execute.mockResolvedValue({ rowsAffected: 1 });

    const result = await worker.processJob(job);
    expect(result.status).toBe("completed");
    expect(result.decision).toBeNull();

    // Verify INSERT INTO materialized_evaluations
    const insertCall = db.execute.mock.calls.find((call: any[]) => String(call[0]).includes("INSERT INTO materialized_evaluations"));
    expect(insertCall).toBeDefined();

    const params = insertCall[1];
    expect(params[0]).toBe(mockIdentity.idempotencyKey);
    expect(params[1]).toBe("t-1");
    expect(params[2]).toBe("p-1");
    expect(params[3]).toBe("job-1");
    expect(params[4]).toBe("v1");
    expect(params[5]).toBe(mockContext.contextFingerprint);
    expect(params[6]).toBe("EXPIRED"); // relational evaluation_state for unavailable insert shape

    // Verify JSON payload
    const jsonPayload = JSON.parse(params[9]);
    expect(jsonPayload.evaluationState).toBe("EXPIRED");
    expect(jsonPayload.reasonCode).toBe("EXPIRED");
  });
  
  it("rejects gracefully when context is missing, without partial persistence", async () => {
    const job = {
      id: "job-id",
      tenantId: "t-1",
      personId: "p-1",
      searchPlanId: "snap-1",
      canonicalJobId: "job-1",
      opportunityVersion: "v1",
      evaluationContextFingerprint: "missing-ctx",
      leaseToken: mockLeaseToken,
      attempts: 0,
      maxAttempts: 3
    };

    // Auth success
    db.one.mockImplementationOnce(async () => ({ id: "p-1" }));

    // Version query success
    db.one.mockImplementationOnce(async () => {
      return {
        raw_content: "{}",
        job_title: "CEO",
        company_name: "Test",
        location: "Remote",
        acquisition_status: "ACQUIRED",
        acquisition_quality: "COMPLETE",
        lifecycle_state: "ACTIVE",
        evidence_state: "SUFFICIENT"
      };
    });

    // Context query fails (returns null)
    db.one.mockImplementationOnce(async () => null);

    db.execute.mockResolvedValue({ rowsAffected: 1 });

    const result = await worker.processJob(job);
    
    // Worker catches Error and schedules retry
    expect(result.status).toBe("retry_scheduled");
    expect(result.error).toContain("Missing evaluation context for fingerprint: missing-ctx");
    
    // Ensure no persistence was attempted
    const insertCall = db.execute.mock.calls.find((call: any[]) => String(call[0]).includes("INSERT INTO materialized_evaluations"));
    expect(insertCall).toBeUndefined();
    
    // Verify that the queue state was updated properly to retry
    const retryCall = db.execute.mock.calls.find((call: any[]) => String(call[0]).includes("UPDATE evaluation_jobs") && String(call[0]).includes("status = 'pending'"));
    expect(retryCall).toBeDefined();
    
    const params = retryCall[1];
    expect(params[0]).toBe(1); // Next attempt number
    expect(params[1]).toContain("Missing evaluation context");
    expect(params[3]).toBe(job.id);
  });
});
