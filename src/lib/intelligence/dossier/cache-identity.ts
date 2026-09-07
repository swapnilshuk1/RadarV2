/** A detail response may only be rendered beside the exact evaluation it represents. */
export function hasMatchingEvaluationFingerprint(
  requestedFingerprint: string | null | undefined,
  responseFingerprint: string | null | undefined,
): boolean {
  return Boolean(requestedFingerprint && responseFingerprint && requestedFingerprint === responseFingerprint);
}
