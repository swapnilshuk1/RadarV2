export const PROFILE_PIPELINE_STAGES = [
  "DOCUMENT_REGISTERED",
  "TEXT_EXTRACTED",
  "EVIDENCE_EXTRACTED",
  "NORMALIZED",
  "ONTOLOGY_RESOLVED",
  "PROJECTION_BUILT",
  "INFERENCE_COMPLETE",
  "PROFILE_READY",
  "EVALUATED",
  "COMPLETED",
] as const;

export type ProfilePipelineStage = typeof PROFILE_PIPELINE_STAGES[number];
export type ProfilePipelineStepState = "complete" | "current" | "pending";

/**
 * Generic document completion does not imply that each semantic pipeline step
 * completed. The terminal stage itself is the sole presentation authority.
 */
export function resolveProfilePipelineStepState(
  terminalStage: string | null,
  step: ProfilePipelineStage,
): ProfilePipelineStepState {
  const terminalIndex = terminalStage ? PROFILE_PIPELINE_STAGES.indexOf(terminalStage as ProfilePipelineStage) : -1;
  const stepIndex = PROFILE_PIPELINE_STAGES.indexOf(step);
  if (terminalIndex > stepIndex) return "complete";
  if (terminalIndex === stepIndex) return "current";
  return "pending";
}

export function isIntentRequiredProfileState(stage: string | null): boolean {
  return stage === "PROFILE_READY";
}
