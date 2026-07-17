import type { EntityBase, TimelineEvent } from "./entities";

export interface ConfidenceProvenance {
  value: number;
  source: string;
  calculation: string;
  version: string;
}

export type PreferenceState = "Unknown" | "Emerging" | "Stable" | "Decaying" | "Retired";

export interface DerivedPreference extends EntityBase {
  personId: string;
  attribute: string; // e.g. "Travel"
  state: PreferenceState;
  weight: number; // e.g. -0.84
  confidence: ConfidenceProvenance;
  volatility: number; // e.g. 0.18
  evidenceCount: number;
  supersedesId?: string; // Preferences are immutable
}

export interface Finding extends EntityBase {
  personId: string;
  statement: string; // Objective e.g. "Travel avoided in 7 of last 9 decisions."
  hypothesisIds: string[]; // Fk -> Hypothesis.id
}

export interface Hypothesis extends EntityBase {
  personId: string;
  statement: string; // Subjective e.g. "Likely dislikes travel"
  confidence: number;
  evidenceCount: number;
  observationIds: string[]; // Fk -> Observation.id
  expiresAt: string; // ISO-8601
}

export interface Observation extends EntityBase {
  personId: string;
  timelineEventId: string; // Fk -> TimelineEvent.id
  type: "Behavior" | "Company" | "Market" | "Recruiter" | "System";
  statement: string;
}
