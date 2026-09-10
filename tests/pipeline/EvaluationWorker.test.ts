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
      many: vi.fn(),
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
      canonicalJobId: "canonical-job-1",
      opportunityVersion: "opportunity-version-1",
      evaluationContextFingerprint: mockContext.contextFingerprint,
      leaseToken: mockLeaseToken,
      attempts: 0,
      maxAttempts: 3
    };

    const exactIdentity = computeEvaluationIdentity(job.canonicalJobId, job.opportunityVersion, mockContext.contextFingerprint);
    const mockOppSource = { jobHash: "source-job-hash-1", role: "CEO", company: "Test" };
    
    // Auth success
    db.one.mockImplementationOnce(async (sql: string) => {
      return { id: "p-1" }; 
    });

    // Version query success (ACQUIRED / ACTIVE)
    db.one.mockImplementationOnce(async () => {
      return {
        raw_content: JSON.stringify({ ...mockOppSource, rawDescription: "Own commercial growth and revenue planning." }),
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
    
    // Snapshot followed by explicit scoped ownership and an exactly pinned projection.
    db.one.mockImplementationOnce(async () => ({ payload_json: "{}" }));
    db.one.mockImplementationOnce(async () => ({ id: "p-1" }));
    db.many.mockResolvedValueOnce([{ projection_json: JSON.stringify({
      profileVersion: mockContext.profileVersion,
      operatingLevel: { value: "STRATEGIC", confidence: 1, evidenceIds: [] },
      workNature: { value: "STRATEGIC_WORK", confidence: 1, evidenceIds: [] },
      decisionAuthority: { value: "ENTERPRISE", confidence: 1, evidenceIds: [] },
      commercialScope: { value: "ENTERPRISE", confidence: 1, evidenceIds: [] },
      yearsOfExperience: 20, coreCapabilities: ["COMMERCIAL_GROWTH"],
      preferredLocations: ["Gurugram"], preferredWorkModel: "HYBRID", executiveThemes: ["growth"],
    }) }]);

    // Mock engine
    vi.mocked(runEngineSingleIntrinsic).mockReturnValueOnce({
      record: {
        verb: "PURSUE",
        qualityScore: 85,
        diligenceStatus: "READY",
        trace: { evidenceMapping: [{
          jobCapability: "COMMERCIAL_GROWTH",
          candidateCapability: "COMMERCIAL_GROWTH",
          jobEvidenceIds: ["role-work-1"],
          candidateEvidenceIds: ["candidate-evidence-1"],
        }] },
      },
      opportunity: { jobHash: "source-job-hash-1", role: "CEO", company: "Test", location: "Remote", dimensions: [] },
      jobProjection: { roleWorkEvidence: [{ id: "role-work-1", kind: "RESPONSIBILITY", statement: "Own commercial growth and revenue planning.", sourceQuote: "Own commercial growth and revenue planning.", sourceRegion: "RESPONSIBILITIES", ordinal: 1, confidence: 0.95 }] }
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
    expect(params[0]).toBe(exactIdentity.idempotencyKey);
    expect(params[1]).toBe("t-1");
    expect(params[2]).toBe("p-1");
    expect(params[3]).toBe("canonical-job-1");
    expect(params[4]).toBe("opportunity-version-1");
    expect(params[5]).toBe(mockContext.contextFingerprint);
    expect(params[6]).toBe(exactIdentity.idempotencyKey); // evaluation fingerprint
    expect(params[7]).toBe("EVALUATED"); // relational evaluation_state
    expect(params[8]).toBe("PURSUE"); // relational decision
    expect(params[9]).toBe(85); // relational quality_score
    const persisted = JSON.parse(params[12]);
    expect(persisted.canonicalJobId).toBe("canonical-job-1");
    expect(persisted.jobHash).toBe("source-job-hash-1");
    expect(persisted.opportunityVersion).toBe("opportunity-version-1");
    const traceIds = persisted.decisionTrace.relationships.flatMap((relationship: { jobEvidenceIds: string[] }) => relationship.jobEvidenceIds);
    const exactProjectionIds = persisted.jobProjection.roleWorkEvidence.map((evidence: { id: string }) => evidence.id);
    expect(traceIds.every((id: string) => exactProjectionIds.includes(id))).toBe(true);
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
    expect(result.decision ?? null).toBeNull();

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
    expect(params[6]).toBeNull(); // unavailable payload has no evaluation fingerprint
    expect(params[7]).toBe("EXPIRED"); // relational evaluation_state

    // Verify JSON payload
    const jsonPayload = JSON.parse(params[12]);
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
