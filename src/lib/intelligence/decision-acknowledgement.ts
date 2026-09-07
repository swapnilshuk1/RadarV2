/** Applies a local decision mutation only after its canonical write succeeds. */
export async function requireDecisionAcknowledgement(
  operation: () => Promise<{ success?: boolean }>,
  failureMessage: string,
): Promise<void> {
  const result = await operation();
  if (!result?.success) throw new Error(failureMessage);
}
