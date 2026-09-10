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
  const resolvedState = resolveArtifactEvaluationState(params.artifact);
  if (resolvedState !== "EVALUATED") {
    throw new Error(`Evaluated dossier presentation requires an EVALUATED artifact for job ${params.identity.canonicalJobId}`);
  }
  const verdict = params.artifact.record?.verb;
  const score = params.artifact.record?.qualityScore;
  if ((verdict !== "PURSUE" && verdict !== "CONSIDER" && verdict !== "PASS")
    || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`Evaluated dossier presentation requires canonical verdict and finite 0–100 score for job ${params.identity.canonicalJobId}`);
  }
  const editorialIntelligence = buildEditorialIntelligenceContract({
    state: "EVALUATED",
    artifact: params.artifact,
    candidateProjection: params.candidateProjection,
    presentationEvidence: params.presentationEvidence,
  });

  const evaluation = {
    state: "EVALUATED" as const,
    verdict,
    score,
    fingerprint: params.evaluationFingerprint,
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
  if (params.reasonCode !== "SPARSE_SPEC" && params.reasonCode !== "NOT_EVALUABLE") {
    throw new Error(`Unavailable dossier presentation only supports SPARSE_SPEC or NOT_EVALUABLE for job ${params.identity.canonicalJobId}`);
  }
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
