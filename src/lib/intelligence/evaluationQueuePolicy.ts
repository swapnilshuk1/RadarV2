/** Queue family is separate from the evaluator versions this deployment can execute. */
export function isStagedPolicy(policyVersion: string): boolean {
  return /^staged-v[1-9]\d*$/.test(policyVersion);
}

/** SQL equivalent used by durable release/reconciliation inserts. */
export const stagedContextPredicate = "(ec.policy_version GLOB 'staged-v[1-9]*' AND substr(ec.policy_version, 9) NOT GLOB '*[^0-9]*')";
