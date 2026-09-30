export const STAGED_POLICY_VERSION = 'staged-v8';
export const STAGED_CONTRACT_VERSION = 'staged-decision-v8';

export function supportsStagedPolicy(policy: string): boolean {
  return policy === STAGED_POLICY_VERSION;
}

export function stagedContractForPolicy(policy: string): string {
  if (policy !== STAGED_POLICY_VERSION) throw new Error('UNSUPPORTED_STAGED_POLICY');
  return STAGED_CONTRACT_VERSION;
}
