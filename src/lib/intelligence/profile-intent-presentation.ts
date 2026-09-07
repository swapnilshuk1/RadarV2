export interface IntentActivationResponse {
  success?: boolean;
  activationState?: "ACTIVE" | "PENDING_ACTIVATION";
  activationError?: string;
}

export function resolveIntentActivationPresentation(response: IntentActivationResponse): {
  persisted: boolean;
  activationPending: boolean;
  navigateHome: boolean;
  message: string;
} {
  if (response.success && response.activationState === "ACTIVE") {
    return { persisted: true, activationPending: false, navigateHome: true, message: "Career intent saved and canonical recommendation activation is current." };
  }
  if (response.success && response.activationState === "PENDING_ACTIVATION") {
    return {
      persisted: true,
      activationPending: true,
      navigateHome: false,
      message: `Career intent saved, but canonical recommendation activation is pending${response.activationError ? `: ${response.activationError}` : "."}`,
    };
  }
  return { persisted: false, activationPending: false, navigateHome: false, message: "Career intent was not acknowledged by the server." };
}
