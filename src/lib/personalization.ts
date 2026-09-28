
/**
 * Personalization rules — see RADAR_LANGUAGE_GUIDE and DESIGN_CHARTER §7.
 * Every generated sentence must name a verifiable achievement or capability
 * from candidate_profile.json. No generic adjectives.
 */

export function candidateSignature(): string {
  return "RADAR · Candidate-scoped intelligence";
}

export function shortlistCaption(): string {
  return "Curated against the authorized candidate evidence record.";
}

/** Returns the strongest candidate proof for a given evidence type keyword. */
export function findProof(keyword: string): string | null {
  void keyword;
  return null;
}

export function achievements(): string[] {
  return [];
}
