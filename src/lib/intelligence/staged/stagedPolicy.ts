/** Semantic input changes require a new context; persisted v6 remains readable. */
export const STAGED_POLICY_VERSION = 'staged-v7';
export const STAGED_CONTRACT_VERSION = 'staged-decision-v7';
export function supportsStagedPolicy(policy: string): boolean {
  return policy === 'staged-v6' || policy === STAGED_POLICY_VERSION;
}
export function stagedContractForPolicy(policy: string): string {
  if (policy === 'staged-v6') return 'staged-decision-v6';
  if (policy === STAGED_POLICY_VERSION) return STAGED_CONTRACT_VERSION;
  throw new Error('UNSUPPORTED_STAGED_POLICY');
}
