import { computeEvaluationIdentity } from "../../domain/evaluation_fingerprint";
import type { 
  CanonicalEvaluatedPayloadV4_3, 
  CanonicalUnavailablePayloadV4_3,
  UnavailableReasonCode 
} from "../../domain/evaluation_payloads";
import type { EvaluationContext } from "../../domain/evaluation_context";
import type { EvaluationArtifact } from "../engine";

export class ContractViolationError extends Error {
  constructor(message: string) {
    super(`[ContractViolation] ${message}`);
    this.name = "ContractViolationError";
  }
}

function assertValidString(value: string | undefined | null, fieldName: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContractViolationError(`Missing or empty required field: ${fieldName}`);
  }
}

function assertValidTimestamp(timestamp: string): asserts timestamp is string {
  assertValidString(timestamp, "evaluatedAt");
  if (isNaN(Date.parse(timestamp))) {
    throw new ContractViolationError(`Invalid ISO timestamp: ${timestamp}`);
  }
}

function assertValidContext(context: EvaluationContext): void {
  assertValidString(context.contextFingerprint, "context.contextFingerprint");
  assertValidString(context.tenantId, "context.tenantId");
  assertValidString(context.personId, "context.personId");
  assertValidString(context.policyVersion, "context.policyVersion");
  assertValidString(context.ontologyVersion, "context.ontologyVersion");
  assertValidString(context.ontologyFingerprint, "context.ontologyFingerprint");
  assertValidString(context.profileVersion, "context.profileVersion");
}

export function buildCanonicalEvaluatedPayload(
  artifact: EvaluationArtifact,
  context: EvaluationContext,
  canonicalJobId: string,
  opportunityVersion: string,
  evaluatedAt: string
): CanonicalEvaluatedPayloadV4_3 {
  assertValidString(canonicalJobId, "canonicalJobId");
  assertValidString(opportunityVersion, "opportunityVersion");
  const jobHash = artifact.opportunity?.jobHash ?? artifact.record?.jobHash;
  assertValidString(jobHash, "jobHash");
  assertValidContext(context);
  assertValidTimestamp(evaluatedAt);

  const score = artifact.record.qualityScore;
  if (typeof score !== "number" || isNaN(score) || !isFinite(score) || score < 0 || score > 100) {
    throw new ContractViolationError(`Evaluated payload requires a finite qualityScore in range 0-100. Received: ${score}`);
  }
  
  const decision = artifact.record.verb;
  if (decision !== "PURSUE" && decision !== "CONSIDER" && decision !== "PASS") {
    throw new ContractViolationError(`Evaluated payload requires PURSUE, CONSIDER, or PASS decision. Received: ${decision}`);
  }

  const diligence = artifact.record.diligenceStatus;
  const allowedDiligence = ["READY", "INSUFFICIENT", "STALE", "FAILED", "UNKNOWN"];
  if (typeof diligence !== "string" || !allowedDiligence.includes(diligence)) {
    throw new ContractViolationError(`Evaluated payload requires a valid diligenceStatus. Received: ${diligence}`);
  }

  const inputIdentity = computeEvaluationIdentity(canonicalJobId, opportunityVersion, context.contextFingerprint);

  return {
    schemaVersion: "v4.3-intrinsic",
    evaluationContractVersion: "v4.3",
    evaluationInputHash: inputIdentity.idempotencyKey,
    canonicalJobId,
    opportunityVersion,
    jobHash,
    evaluatedAt,
    contextFingerprint: context.contextFingerprint,
    tenantId: context.tenantId,
    personId: context.personId,
    policyVersion: context.policyVersion,
    ontologyVersion: context.ontologyVersion,
    ontologyFingerprint: context.ontologyFingerprint,
    profileVersion: context.profileVersion,
    evaluationState: "EVALUATED",
    decision: decision,
    score: score,
    diligenceStatus: diligence as "READY" | "INSUFFICIENT" | "STALE" | "FAILED" | "UNKNOWN"
  };
}

export function buildCanonicalUnavailablePayload(
  jobHash: string,
  reasonCode: UnavailableReasonCode,
  context: EvaluationContext,
  canonicalJobId: string,
  opportunityVersion: string,
  evaluatedAt: string,
  missingFields?: readonly string[]
): CanonicalUnavailablePayloadV4_3 {
  assertValidString(canonicalJobId, "canonicalJobId");
  assertValidString(opportunityVersion, "opportunityVersion");
  assertValidString(jobHash, "jobHash");
  assertValidContext(context);
  assertValidTimestamp(evaluatedAt);

  const allowedReasons = ["ACQUISITION_PENDING", "ACQUISITION_FAILED", "EXPIRED", "SPARSE_SPEC", "NOT_EVALUABLE"];
  if (typeof reasonCode !== "string" || !allowedReasons.includes(reasonCode)) {
    throw new ContractViolationError(`Invalid reasonCode: ${reasonCode}`);
  }

  const inputIdentity = computeEvaluationIdentity(canonicalJobId, opportunityVersion, context.contextFingerprint);
  
  return {
    schemaVersion: "v4.3-unavailable",
    evaluationContractVersion: "v4.3",
    evaluationInputHash: inputIdentity.idempotencyKey,
    canonicalJobId,
    opportunityVersion,
    jobHash,
    evaluatedAt,
    contextFingerprint: context.contextFingerprint,
    tenantId: context.tenantId,
    personId: context.personId,
    policyVersion: context.policyVersion,
    ontologyVersion: context.ontologyVersion,
    ontologyFingerprint: context.ontologyFingerprint,
    profileVersion: context.profileVersion,
    evaluationState: reasonCode,
    reasonCode,
    missingFields
  };
}
