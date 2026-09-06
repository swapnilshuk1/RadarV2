import type { CandidateProjection } from "@/lib/domain/candidate_projection";
import { asDossierJsonArray, asDossierJsonObject, type CanonicalDossierPresentationV1 } from "@/lib/domain/dossier_presentation";
import type { EvaluationArtifact } from "@/lib/intelligence/engine";
import { BriefCompositionEngine } from "@/lib/intelligence/editorial/BriefCompositionEngine";
import { AdvisoryConstitution } from "@/lib/intelligence/editorial/AdvisoryConstitution";
import { ExecutionEngine } from "@/lib/intelligence/engines/ExecutionEngine";

function focusTopic(artifact: EvaluationArtifact): string | null {
  const functions = artifact.jobProjection?.executiveFunction?.filter((value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0,
  ) ?? [];
  if (functions.length > 0) return functions.slice(0, 2).join(" / ");
  const capability = artifact.jobProjection?.capabilities?.find((value: { source?: string; name?: string }) =>
    value.source === "explicit" && typeof value.name === "string" && value.name.trim().length > 0,
  );
  return capability?.name ?? null;
}

/** Rich dossier construction is evaluation-time only and uses the pinned projection. */
export function buildCanonicalDossierPresentation(
  artifact: EvaluationArtifact,
  candidateProjection: CandidateProjection,
  evaluationInputHash: string,
  generatedAt: string,
): CanonicalDossierPresentationV1 {
  if (!artifact.opportunity || !artifact.jobProjection) {
    throw new Error("Cannot build dossier without evaluated opportunity and job projection");
  }
  const topic = focusTopic(artifact);
  return {
    schemaVersion: "dossier-v1",
    generatedAt,
    evaluationInputHash,
    brief: asDossierJsonObject(BriefCompositionEngine.compose(artifact.opportunity, { bypassHistory: true })),
    jobProjection: asDossierJsonObject(artifact.jobProjection),
    executionPackage: asDossierJsonObject(ExecutionEngine.validateDecision(candidateProjection, artifact.jobProjection)),
    rawDimensions: asDossierJsonArray(Array.isArray(artifact.opportunity.dimensions) ? artifact.opportunity.dimensions : []),
    focusTopic: topic,
    whyRoleExists: topic
      ? AdvisoryConstitution.getWhyThisRoleExistsParagraph(artifact.opportunity, artifact.jobProjection, topic)
      : null,
  };
}
