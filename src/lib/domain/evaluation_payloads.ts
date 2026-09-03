export type UnavailableReasonCode = 
  | "ACQUISITION_PENDING"
  | "ACQUISITION_FAILED"
  | "EXPIRED"
  | "SPARSE_SPEC"
  | "NOT_EVALUABLE";

export interface EvaluationProvenanceV4_3 {
  readonly evaluationContractVersion: "v4.3";
  readonly evaluationInputHash: string;
  readonly canonicalJobId: string;
  readonly opportunityVersion: string;
  readonly jobHash: string;
  readonly evaluatedAt: string;
  readonly contextFingerprint: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly policyVersion: string;
  readonly ontologyVersion: string;
  readonly ontologyFingerprint: string;
  readonly profileVersion: string;
}

export interface CanonicalEvaluatedPayloadV4_3 extends EvaluationProvenanceV4_3 {
  readonly schemaVersion: "v4.3-intrinsic";
  readonly evaluationState: "EVALUATED";
  readonly decision: "PURSUE" | "CONSIDER" | "PASS";
  readonly score: number;
  readonly diligenceStatus: "READY" | "INSUFFICIENT" | "STALE" | "FAILED" | "UNKNOWN";
  /** Exact intrinsic projection used by the scoring run; never a presentation DTO. */
  readonly jobProjection: unknown;
}

export interface CanonicalUnavailablePayloadV4_3 extends EvaluationProvenanceV4_3 {
  readonly schemaVersion: "v4.3-unavailable";
  readonly evaluationState: UnavailableReasonCode;
  readonly reasonCode: UnavailableReasonCode;
  readonly missingFields?: readonly string[];
}

export type PersistedEvaluationPayloadV4_3 = 
  | CanonicalEvaluatedPayloadV4_3
  | CanonicalUnavailablePayloadV4_3;

export function isCanonicalIntrinsicEvaluationV4_3(payload: unknown): payload is CanonicalEvaluatedPayloadV4_3 {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  
  if (
    p.schemaVersion !== "v4.3-intrinsic" ||
    p.evaluationContractVersion !== "v4.3" ||
    p.evaluationState !== "EVALUATED" ||
    typeof p.evaluationInputHash !== "string" ||
    typeof p.canonicalJobId !== "string" ||
    typeof p.opportunityVersion !== "string" ||
    typeof p.jobHash !== "string" ||
    typeof p.evaluatedAt !== "string" ||
    typeof p.contextFingerprint !== "string" ||
    typeof p.tenantId !== "string" ||
    typeof p.personId !== "string" ||
    typeof p.policyVersion !== "string" ||
    typeof p.ontologyVersion !== "string" ||
    typeof p.ontologyFingerprint !== "string" ||
    typeof p.profileVersion !== "string" ||
    !p.jobProjection || typeof p.jobProjection !== "object"
  ) {
    return false;
  }

  if (p.decision !== "PURSUE" && p.decision !== "CONSIDER" && p.decision !== "PASS") {
    return false;
  }

  if (typeof p.score !== "number" || !isFinite(p.score) || isNaN(p.score) || p.score < 0 || p.score > 100) {
    return false;
  }

  const allowedDiligence = ["READY", "INSUFFICIENT", "STALE", "FAILED", "UNKNOWN"];
  if (typeof p.diligenceStatus !== "string" || !allowedDiligence.includes(p.diligenceStatus)) {
    return false;
  }

  return true;
}

export function isCanonicalUnavailablePayload(payload: unknown): payload is CanonicalUnavailablePayloadV4_3 {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  
  if (
    p.schemaVersion !== "v4.3-unavailable" ||
    p.evaluationContractVersion !== "v4.3" ||
    typeof p.evaluationInputHash !== "string" ||
    typeof p.canonicalJobId !== "string" ||
    typeof p.opportunityVersion !== "string" ||
    typeof p.jobHash !== "string" ||
    typeof p.evaluatedAt !== "string" ||
    typeof p.contextFingerprint !== "string" ||
    typeof p.tenantId !== "string" ||
    typeof p.personId !== "string" ||
    typeof p.policyVersion !== "string" ||
    typeof p.ontologyVersion !== "string" ||
    typeof p.ontologyFingerprint !== "string" ||
    typeof p.profileVersion !== "string"
  ) {
    return false;
  }

  const allowedReasons = ["ACQUISITION_PENDING", "ACQUISITION_FAILED", "EXPIRED", "SPARSE_SPEC", "NOT_EVALUABLE"];
  if (typeof p.reasonCode !== "string" || !allowedReasons.includes(p.reasonCode)) {
    return false;
  }
  
  if (p.evaluationState !== p.reasonCode) {
    return false;
  }
  
  if (p.missingFields !== undefined) {
    if (!Array.isArray(p.missingFields) || !p.missingFields.every(f => typeof f === "string")) {
      return false;
    }
  }

  return true;
}
