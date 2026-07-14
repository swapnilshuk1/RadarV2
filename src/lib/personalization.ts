import { candidateProfile } from "../data/candidate-profile";

/**
 * Personalization rules — see RADAR_LANGUAGE_GUIDE and DESIGN_CHARTER §7.
 * Every generated sentence must name a verifiable achievement or capability
 * from candidate_profile.json. No generic adjectives.
 */

export function candidateSignature(): string {
  const id = candidateProfile.identity;
  const exec = candidateProfile.executiveIdentity;
  return `${id.name} · ${id.currentTitle} · ${exec.archetype}`;
}

export function shortlistCaption(): string {
  const yrs = candidateProfile.experience.yearsExperience;
  const team = candidateProfile.experience.teamSizeManaged;
  const book = candidateProfile.experience.feeBookScale;
  return `Curated against ${yrs} years, a ${team}-person org, and a ${book} commercial track record.`;
}

/** Returns the strongest candidate proof for a given evidence type keyword. */
export function findProof(keyword: string): string | null {
  const kw = keyword.toLowerCase();
  const match = candidateProfile.evidence.find(
    (e) => e.type.toLowerCase().includes(kw) || e.proof.toLowerCase().includes(kw),
  );
  return match?.proof ?? null;
}

export function achievements(): string[] {
  return candidateProfile.experience.achievements;
}
