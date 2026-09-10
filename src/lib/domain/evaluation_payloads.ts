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

/**
 * A versioned, evaluator-produced explanation trace for future materialized
 * evaluations. It is an additive output record: it neither participates in
 * evaluation identity nor supplies inputs to scoring.
 *
 * Historical payloads legitimately omit this field. In particular, an absent
 * trace must never be backfilled by reverse-engineering a score.
 */
export interface CanonicalDecisionTraceV1 {
  readonly version: "canonical-decision-trace/v1";
  readonly relationships: readonly CanonicalDecisionTraceRelationship[];
  readonly components: readonly CanonicalDecisionTraceComponent[];
}

export interface CanonicalDecisionTraceRelationship {
  /** The evaluator's canonical capability relationship, not an editorial join. */
  readonly jobCapabilityKey: string;
  readonly candidateCapabilityKey: string;
  /** Source-backed identifiers available to the evaluator at materialization. */
  readonly jobEvidenceIds: readonly string[];
  readonly candidateEvidenceIds: readonly string[];
  readonly relationship: "MATCH" | "ADJACENT" | "GAP" | "UNKNOWN";
  readonly basis: "EVALUATOR";
}

export interface CanonicalDecisionTraceComponent {
  /** Evaluator factor name; no free-form rationale is persisted here. */
  readonly dimension: string;
  readonly state: "STRENGTH" | "CONSTRAINT" | "UNKNOWN";
  /** Present only if the evaluator actually emits stable evidence identifiers. */
  readonly evidenceIds: readonly string[];
}

export interface CanonicalEvaluatedPayloadV4_3 extends EvaluationProvenanceV4_3 {
  readonly schemaVersion: "v4.3-intrinsic";
  readonly evaluationState: "EVALUATED";
  readonly decision: "PURSUE" | "CONSIDER" | "PASS";
  readonly score: number;
  readonly diligenceStatus: "READY" | "INSUFFICIENT" | "STALE" | "FAILED" | "UNKNOWN";
  /** Exact intrinsic projection used by the scoring run; never a presentation DTO. */
  readonly jobProjection: unknown;
  /** Optional forward-only evaluator output; old intrinsic payloads omit it safely. */
  readonly decisionTrace?: CanonicalDecisionTraceV1;
  /** Optional additive presentation artifact; never a source of decision truth. */
  readonly dossierPresentation?: import("./dossier_presentation").CanonicalDossierPresentationV1;
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

function isCanonicalDecisionTraceV1(value: unknown): value is CanonicalDecisionTraceV1 {
  if (!value || typeof value !== "object") return false;
  const trace = value as Record<string, unknown>;
  return trace.version === "canonical-decision-trace/v1"
    && Array.isArray(trace.relationships)
    && trace.relationships.every((relationship) => (
      relationship && typeof relationship === "object"
      && typeof (relationship as Record<string, unknown>).jobCapabilityKey === "string"
      && typeof (relationship as Record<string, unknown>).candidateCapabilityKey === "string"
      && ["MATCH", "ADJACENT", "GAP", "UNKNOWN"].includes(String((relationship as Record<string, unknown>).relationship))
      && (relationship as Record<string, unknown>).basis === "EVALUATOR"
      && Array.isArray((relationship as Record<string, unknown>).jobEvidenceIds)
      && ((relationship as Record<string, unknown>).jobEvidenceIds as unknown[]).every((id) => typeof id === "string")
      && Array.isArray((relationship as Record<string, unknown>).candidateEvidenceIds)
      && ((relationship as Record<string, unknown>).candidateEvidenceIds as unknown[]).every((id) => typeof id === "string")
    ))
    && Array.isArray(trace.components)
    && trace.components.every((component) => (
      component && typeof component === "object"
      && typeof (component as Record<string, unknown>).dimension === "string"
      && ["STRENGTH", "CONSTRAINT", "UNKNOWN"].includes(String((component as Record<string, unknown>).state))
      && Array.isArray((component as Record<string, unknown>).evidenceIds)
      && ((component as Record<string, unknown>).evidenceIds as unknown[]).every((id) => typeof id === "string")
    ));
}

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

  if (p.decisionTrace !== undefined && !isCanonicalDecisionTraceV1(p.decisionTrace)) {
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
