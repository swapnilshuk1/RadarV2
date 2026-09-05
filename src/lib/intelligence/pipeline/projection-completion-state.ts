/** Profile processing only becomes recommendation evaluation with saved intent. */
export function resolveProjectionCompletionStage(hasSavedIntent: boolean): "PROFILE_READY" | "EVALUATED" {
  return hasSavedIntent ? "EVALUATED" : "PROFILE_READY";
}
