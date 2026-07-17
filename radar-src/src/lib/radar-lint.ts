// Prohibited-vocabulary linter — RADAR_LANGUAGE_GUIDE §4.
// Any of these banned tokens appearing in rendered UI copy must fail loudly
// unless the string is user evidence (candidate proof or verbatim JD quote).

export const BANNED_PHRASES = [
  "perfect fit",
  "ideal candidate",
  "guaranteed",
  "excellent match",
  "high confidence",
  "ats optimized",
  "screening algorithm",
  "world-class",
  "best-in-class",
  "high velocity",
] as const;

export type LintFinding = { phrase: string; where: string };

export function lintCopy(scope: string, text: string): LintFinding[] {
  const lower = text.toLowerCase();
  const findings: LintFinding[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) findings.push({ phrase, where: scope });
  }
  return findings;
}

/** Dev-time helper: assert none of the passed strings contain banned language. */
export function assertClean(scope: string, ...texts: string[]): void {
  if (import.meta.env.PROD) return;
  const findings = texts.flatMap((t) => lintCopy(scope, t));
  if (findings.length) {
    // eslint-disable-next-line no-console
    console.warn(`[radar-lint] Prohibited vocabulary in ${scope}:`, findings);
  }
}
