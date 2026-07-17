// Layer 2 — Understand. Four distinct concepts, deliberately split.

import profile from "@/data/candidate-profile.json";

export type CandidateIdentity = {
  name: string;
  currentTitle: string;
  yearsExperience: number;
  archetype: string;
};

export type CareerPreferences = {
  locations: string[];
  workModel: "remote" | "hybrid" | "onsite" | "flexible";
  targetMinSalary: string;
  industries: string[];
  industriesExcluded: string[];
};

export type SearchStrategy = {
  targetTitles: string[];
  ambition: "steady" | "step-up" | "leap";
  ceoPathway: boolean;
  boardReadiness: boolean;
  trajectory: "lateral" | "up" | "cxo";
};

export type HeadspaceState = {
  capacityPerMonth: number;
  activePursuits: number;
  saturated: boolean;
};

/** Build the four candidate views from the JSON profile. Pure — no I/O. */
export function loadIdentity(): CandidateIdentity {
  return {
    name: (profile.identity as { name?: string }).name ?? "Candidate",
    currentTitle:
      (profile.identity as { currentTitle?: string }).currentTitle ?? "",
    yearsExperience: profile.experience?.yearsExperience ?? 0,
    archetype: profile.executiveIdentity?.archetype ?? "",
  };
}

export function loadPreferences(): CareerPreferences {
  return {
    locations: profile.preferences?.locations ?? [],
    workModel: "hybrid",
    targetMinSalary: profile.preferences?.targetMinSalary ?? "",
    industries: profile.preferences?.industries ?? [],
    industriesExcluded: [],
  };
}

export function loadStrategy(): SearchStrategy {
  return {
    targetTitles: profile.strategy?.targetTitles ?? [],
    ambition: "leap",
    ceoPathway: profile.strategy?.ceoPathway ?? false,
    boardReadiness: profile.strategy?.boardReadiness ?? false,
    trajectory: "cxo",
  };
}

/** headspaceCapacityPerMonth is additive; default to 5 if unset. */
export function buildHeadspace(activePursuits: number): HeadspaceState {
  const capacity =
    (profile as { headspaceCapacityPerMonth?: number })
      .headspaceCapacityPerMonth ?? 5;
  return {
    capacityPerMonth: capacity,
    activePursuits,
    saturated: activePursuits >= capacity,
  };
}