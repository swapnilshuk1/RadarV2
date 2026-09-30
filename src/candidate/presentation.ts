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

export interface IntentActivationResponse {
  success?: boolean;
  activationState?: "ACTIVE" | "PENDING_ACTIVATION";
  unchanged?: boolean;
  activationError?: string;
  message?: string;
}

export function resolveIntentActivationPresentation(response: IntentActivationResponse): {
  persisted: boolean;
  activationPending: boolean;
  navigateHome: boolean;
  message: string;
} {
  if (response.success && response.activationState === "ACTIVE") {
    return {
      persisted: true,
      activationPending: false,
      navigateHome: !response.unchanged,
      message: response.message || "Career intent saved and canonical recommendation activation is current.",
    };
  }
  if (response.success && response.activationState === "PENDING_ACTIVATION") {
    return {
      persisted: true,
      activationPending: true,
      navigateHome: false,
      message: `Career intent saved, but canonical recommendation activation is pending${response.activationError ? `: ${response.activationError}` : "."}`,
    };
  }
  return {
    persisted: false,
    activationPending: false,
    navigateHome: false,
    message: "Career intent was not acknowledged by the server.",
  };
}

export function profilePollDelay(ticks: number): number {
  return Math.min(1200 * Math.pow(1.5, Math.floor(Math.max(0, ticks) / 3)), 30_000);
}

export function shouldPollProfile(status: string | null, visible: boolean): boolean {
  return visible && status !== "COMPLETED" && status !== "FAILED";
}
