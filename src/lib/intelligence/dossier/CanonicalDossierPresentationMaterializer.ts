import type { CandidateProjection } from "@/lib/domain/candidate_projection";
import type { CanonicalDossierPresentationV2 } from "@/lib/domain/dossier_presentation";
import { isCanonicalDossierPresentationV2 } from "@/lib/domain/dossier_presentation";
import type { UnavailableReasonCode } from "@/lib/domain/evaluation_payloads";
import type { EvaluationArtifact } from "@/lib/intelligence/engine";
import {
  buildEditorialIntelligenceContract,
  type EditorialIntelligenceContractOptions,
} from "../editorial/EditorialIntelligenceContractBuilder";
import { composeEditorialIntelligenceV2 } from "../editorial/EditorialPropositionComposer";
import { resolveArtifactEvaluationState } from "../evaluation/PayloadMapper";

export interface PresentationIdentityInput {
  readonly tenantId: string;
  readonly personId: string;
  readonly canonicalJobId: string;
  readonly opportunityVersion: string;
  readonly evaluationContextFingerprint: string;
}

export interface BuildEvaluatedPresentationV2Params {
  readonly identity: PresentationIdentityInput;
  readonly artifact: EvaluationArtifact;
  readonly candidateProjection: CandidateProjection;
  readonly presentationEvidence?: EditorialIntelligenceContractOptions;
  readonly evaluationFingerprint: string;
  readonly generatedAt?: string;
}

export interface BuildUnavailablePresentationV2Params {
  readonly identity: PresentationIdentityInput;
  readonly reasonCode: UnavailableReasonCode;
  readonly presentationEvidence?: EditorialIntelligenceContractOptions;
  readonly generatedAt?: string;
}

function buildCanonicalDossierPresentationV2(params: {
  readonly identity: CanonicalDossierPresentationV2["identity"];
  readonly evaluation: CanonicalDossierPresentationV2["evaluation"];
  readonly editorialIntelligence: ReturnType<typeof buildEditorialIntelligenceContract>;
  readonly generatedAt?: string;
}): CanonicalDossierPresentationV2 {
  return {
    schemaVersion: "dossier-v2",
    editorialVersion: "editorial-composition-v2",
    identity: params.identity,
    evaluation: params.evaluation,
    composition: composeEditorialIntelligenceV2(params.editorialIntelligence),
    generatedAt: params.generatedAt ?? new Date().toISOString(),
  };
}

export function buildEvaluatedPresentationV2(
  params: BuildEvaluatedPresentationV2Params,
): CanonicalDossierPresentationV2 {
  const editorialIntelligence = buildEditorialIntelligenceContract({
    state: "EVALUATED",
    artifact: params.artifact,
    candidateProjection: params.candidateProjection,
    presentationEvidence: params.presentationEvidence,
  });

  const resolvedState = resolveArtifactEvaluationState(params.artifact);
  const rawArtifact = params.artifact as any;
  const rawOpportunity = rawArtifact?.opportunity as any;
  const rawVerdict =
    rawArtifact?.decision ??
    rawOpportunity?.decision ??
    params.artifact.record?.verb ??
    null;
  const rawScore =
    typeof rawArtifact?.score === "number"
      ? rawArtifact.score
      : typeof rawOpportunity?.score === "number"
      ? rawOpportunity.score
      : typeof params.artifact.record?.qualityScore === "number"
      ? params.artifact.record.qualityScore
      : null;

  const evaluation = resolvedState === "EVALUATED"
    ? {
        state: "EVALUATED" as const,
        verdict: rawVerdict as "PURSUE" | "CONSIDER" | "PASS",
        score: rawScore,
        fingerprint: params.evaluationFingerprint,
      }
    : {
        state: resolvedState,
        verdict: null,
        score: null,
        fingerprint: null,
      };

  const presentation = buildCanonicalDossierPresentationV2({
    identity: params.identity,
    evaluation,
    editorialIntelligence,
    generatedAt: params.generatedAt,
  });

  if (!isCanonicalDossierPresentationV2(presentation)) {
    throw new Error(`Failed to construct valid CanonicalDossierPresentationV2 for job ${params.identity.canonicalJobId}`);
  }

  return presentation;
}

export function buildUnavailablePresentationV2(
  params: BuildUnavailablePresentationV2Params,
): CanonicalDossierPresentationV2 {
  const editorialIntelligence = buildEditorialIntelligenceContract({
    state: "UNAVAILABLE",
    reasonCode: params.reasonCode,
    presentationEvidence: params.presentationEvidence,
  });

  const evaluationState: "SPARSE_SPEC" | "NOT_EVALUABLE" =
    params.reasonCode === "SPARSE_SPEC" ? "SPARSE_SPEC" : "NOT_EVALUABLE";

  const presentation = buildCanonicalDossierPresentationV2({
    identity: params.identity,
    evaluation: {
      state: evaluationState,
      verdict: null,
      score: null,
      fingerprint: null,
    },
    editorialIntelligence,
    generatedAt: params.generatedAt,
  });

  if (!isCanonicalDossierPresentationV2(presentation)) {
    throw new Error(`Failed to construct valid unavailable CanonicalDossierPresentationV2 for job ${params.identity.canonicalJobId}`);
  }

  return presentation;
}
