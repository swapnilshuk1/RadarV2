import { describe, test, expect } from "vitest";
import { buildCanonicalEvaluatedPayload, buildCanonicalUnavailablePayload, ContractViolationError, materializeCanonicalPayload } from "../../src/lib/intelligence/evaluation/PayloadMapper";
import type { EvaluationContext } from "../../src/lib/domain/evaluation_context";
import type { Presented } from "../../src/lib/intelligence/present";
import type { EvaluationArtifact } from "../../src/lib/intelligence/engine";
import { computeEvaluationIdentity } from "../../src/lib/domain/evaluation_fingerprint";
import { isCanonicalIntrinsicEvaluationV4_3, isCanonicalUnavailablePayload } from "../../src/lib/domain/evaluation_payloads";
import { isCanonicalDossierPresentationV1 } from "../../src/lib/domain/dossier_presentation";

// Phase 2B Strict Contract Signature Verification
// This static test proves that a UI 'Presented' DTO cannot ever be assigned to or mapped from
// the intrinsic 'EvaluationArtifact' used in the persistence mapper.
type AssertNotAssignable<T, U> = T extends U ? false : true;
type ProvePresentedIsRejected = AssertNotAssignable<Presented, EvaluationArtifact>;
const _staticBoundaryCheck: ProvePresentedIsRejected = true;

describe("PayloadMapper", () => {
  const mockContext: EvaluationContext = {
    contextFingerprint: "ctx-123",
    tenantId: "tenant-A",
    personId: "person-B",
    searchPlanSnapshotId: "snap-456",
    ontologyVersion: "1.0",
    ontologyFingerprint: "ont-789",
    policyVersion: "2.0",
    profileVersion: "3.0",
    createdAt: "2026-08-28T00:00:00Z"
  };

  const mockArtifact: EvaluationArtifact = {
    jobProjection: {} as any,
    opportunity: { jobHash: "hash-001" },
    sourceIdentity: { jobHash: "hash-001" },
    recommendation: {} as any,
    record: {
      jobHash: "hash-001",
      engineVersion: "1.0",
      recommendationVersion: "1.0",
      verb: "PURSUE",
      qualityScore: 92.5,
      priority: null,
      decisionSummary: {} as any,
      decisionDrivers: [],
      decisionRisks: [],
      stability: {} as any,
      headspace: {} as any,
      comparison: {} as any,
      explanation: {} as any,
      trace: {} as any,
      diligenceStatus: "READY"
    }
  };

  test("maps a successful evaluated payload exactly as specified", () => {
    const payload = buildCanonicalEvaluatedPayload(
      mockArtifact, mockContext, "canonical-job-xyz", "opp-ver-1", "2026-08-28T00:00:00Z"
    );
    
    expect(payload.schemaVersion).toBe("v4.3-intrinsic");
    expect(payload.evaluationContractVersion).toBe("v4.3");
    expect(payload.decision).toBe("PURSUE");
    expect(payload.score).toBe(92.5);
    expect(payload.jobProjection).toBe(mockArtifact.jobProjection);
    
    const expectedIdentity = computeEvaluationIdentity("canonical-job-xyz", "opp-ver-1", mockContext.contextFingerprint);
    expect(payload.evaluationInputHash).toBe(expectedIdentity.idempotencyKey); 
    
    expect(isCanonicalIntrinsicEvaluationV4_3(payload)).toBe(true);
    expect((payload as any).presented).toBeUndefined();
    expect((payload as any).dimensions).toBeUndefined();
  });

  test("translates evaluated and unavailable canonical payloads losslessly", () => {
    const evaluated = buildCanonicalEvaluatedPayload(
      mockArtifact, mockContext, "canonical-job-xyz", "opp-ver-1", "2026-08-28T00:00:00Z"
    );
    const evaluatedRow = materializeCanonicalPayload(evaluated);
    expect(evaluatedRow.id).toBe(evaluated.evaluationInputHash);
    expect(evaluatedRow.evaluationState).toBe("EVALUATED");
    expect(evaluatedRow.decision).toBe("PURSUE");
    expect(evaluatedRow.qualityScore).toBe(92.5);
    expect(JSON.parse(evaluatedRow.evaluationJson).jobProjection).toEqual(mockArtifact.jobProjection);

    const unavailable = buildCanonicalUnavailablePayload(
      "hash-002", "NOT_EVALUABLE", mockContext, "canonical-job-xyz", "opp-ver-1", "2026-08-28T00:00:00Z"
    );
    const unavailableRow = materializeCanonicalPayload(unavailable);
    expect(unavailableRow.evaluationState).toBe("NOT_EVALUABLE");
    expect(unavailableRow.decision).toBeNull();
    expect(unavailableRow.qualityScore).toBeNull();
    expect(JSON.parse(unavailableRow.evaluationJson).reasonCode).toBe("NOT_EVALUABLE");
  });
  
  test("maps each unavailable state accurately", () => {
    const states = [
      "ACQUISITION_PENDING", 
      "ACQUISITION_FAILED", 
      "EXPIRED", 
      "SPARSE_SPEC", 
      "NOT_EVALUABLE"
    ] as const;
    
    for (const state of states) {
      const payload = buildCanonicalUnavailablePayload(
        "hash-002", state, mockContext, "canonical-job-xyz", "opp-ver-1", "2026-08-28T00:00:00Z"
      );
      expect(payload.schemaVersion).toBe("v4.3-unavailable");
      expect(payload.evaluationState).toBe(state);
      expect(payload.reasonCode).toBe(state);
      
      const expectedIdentity = computeEvaluationIdentity("canonical-job-xyz", "opp-ver-1", mockContext.contextFingerprint);
      expect(payload.evaluationInputHash).toBe(expectedIdentity.idempotencyKey);
      
      expect(isCanonicalUnavailablePayload(payload)).toBe(true);
      expect((payload as any).dimensions).toBeUndefined();
    }
  });

  describe("Validation checks", () => {
    test("rejects missing/blank provenance (Evaluated)", () => {
      expect(() => buildCanonicalEvaluatedPayload(mockArtifact, mockContext, "", "ver", "2026-08-28T00:00:00Z")).toThrowError(ContractViolationError);
      expect(() => buildCanonicalEvaluatedPayload(mockArtifact, mockContext, "job", "", "2026-08-28T00:00:00Z")).toThrowError(ContractViolationError);
      
      const badContext = { ...mockContext, ontologyVersion: "   " };
      expect(() => buildCanonicalEvaluatedPayload(mockArtifact, badContext, "job", "ver", "2026-08-28T00:00:00Z")).toThrowError(ContractViolationError);
    });

    test("rejects missing/blank provenance (Unavailable)", () => {
      expect(() => buildCanonicalUnavailablePayload("hash", "EXPIRED", mockContext, "", "ver", "2026-08-28T00:00:00Z")).toThrowError(ContractViolationError);
      const badContext = { ...mockContext, tenantId: "" };
      expect(() => buildCanonicalUnavailablePayload("hash", "EXPIRED", badContext, "job", "ver", "2026-08-28T00:00:00Z")).toThrowError(ContractViolationError);
    });

    test("rejects NaN, infinity, negative, and >100 scores", () => {
      const cases = [NaN, Infinity, -Infinity, -1, 101, 100.1];
      for (const badScore of cases) {
        const badArtifact = { ...mockArtifact, record: { ...mockArtifact.record, qualityScore: badScore } } as any;
        expect(() => buildCanonicalEvaluatedPayload(badArtifact, mockContext, "job", "ver", "2026-08-28T00:00:00Z"))
          .toThrowError(ContractViolationError);
      }
    });

    test("rejects unsupported record verbs", () => {
      const badArtifact = { ...mockArtifact, record: { ...mockArtifact.record, verb: "NOT_EVALUABLE" } } as any;
      expect(() => buildCanonicalEvaluatedPayload(badArtifact, mockContext, "job", "ver", "2026-08-28T00:00:00Z"))
        .toThrowError(ContractViolationError);
    });

    test("rejects invalid timestamp", () => {
      expect(() => buildCanonicalEvaluatedPayload(mockArtifact, mockContext, "job", "ver", "not-a-date"))
        .toThrowError(ContractViolationError);
    });

    test("rejects invalid diligence status", () => {
      const badArtifact = { ...mockArtifact, record: { ...mockArtifact.record, diligenceStatus: "INVALID_STATUS" } } as any;
      expect(() => buildCanonicalEvaluatedPayload(badArtifact, mockContext, "job", "ver", "2026-08-28T00:00:00Z"))
        .toThrowError(ContractViolationError);
    });
  });

  describe("Runtime Schema Guards", () => {
    test("treats dossier presentation as optional and validates it independently", () => {
      const valid = {
        schemaVersion: "dossier-v1",
        generatedAt: "2026-08-28T00:00:00Z",
        evaluationInputHash: "eval-1",
        brief: { structuredSections: { context: {}, mandate: {}, synthesis: {}, evidence: {}, strategy: {} }, oneMinuteTLDR: { whyPursue: [], watchFor: [] }, strategicUpside: { points: [] }, proofPoints: [] },
        jobProjection: {},
        executionPackage: { recommendationConditions: [], screeningQuestions: [], resumeGaps: [], linkedInStrategy: {}, interviewPrep: {} },
        rawDimensions: [],
        focusTopic: null,
        whyRoleExists: null,
      };
      expect(isCanonicalDossierPresentationV1(valid)).toBe(true);
      expect(isCanonicalDossierPresentationV1({ ...valid, evaluationInputHash: "" })).toBe(false);

      const payload = buildCanonicalEvaluatedPayload(mockArtifact, mockContext, "canonical-job-xyz", "opp-ver-1", "2026-08-28T00:00:00Z");
      expect(isCanonicalIntrinsicEvaluationV4_3({ ...payload, dossierPresentation: { schemaVersion: "dossier-v1" } })).toBe(true);
    });

    test("rejects malformed evaluated payloads", () => {
      const valid = buildCanonicalEvaluatedPayload(mockArtifact, mockContext, "canonical-job-xyz", "opp-ver-1", "2026-08-28T00:00:00Z");
      expect(isCanonicalIntrinsicEvaluationV4_3(valid)).toBe(true);

      expect(isCanonicalIntrinsicEvaluationV4_3(null)).toBe(false);
      expect(isCanonicalIntrinsicEvaluationV4_3({ ...valid, schemaVersion: "wrong" })).toBe(false);
      expect(isCanonicalIntrinsicEvaluationV4_3({ ...valid, decision: "INVALID" })).toBe(false);
      expect(isCanonicalIntrinsicEvaluationV4_3({ ...valid, score: NaN })).toBe(false);
      expect(isCanonicalIntrinsicEvaluationV4_3({ ...valid, diligenceStatus: "wrong" })).toBe(false);
      expect(isCanonicalIntrinsicEvaluationV4_3({ ...valid, tenantId: undefined })).toBe(false);
    });

    test("rejects malformed unavailable payloads", () => {
      const valid = buildCanonicalUnavailablePayload("hash", "EXPIRED", mockContext, "job", "ver", "2026-08-28T00:00:00Z");
      expect(isCanonicalUnavailablePayload(valid)).toBe(true);

      expect(isCanonicalUnavailablePayload(null)).toBe(false);
      expect(isCanonicalUnavailablePayload({ ...valid, schemaVersion: "wrong" })).toBe(false);
      expect(isCanonicalUnavailablePayload({ ...valid, reasonCode: "INVALID" })).toBe(false);
      expect(isCanonicalUnavailablePayload({ ...valid, evaluationState: "DIFFERENT" })).toBe(false);
      expect(isCanonicalUnavailablePayload({ ...valid, personId: 123 })).toBe(false);
    });
  });
});
