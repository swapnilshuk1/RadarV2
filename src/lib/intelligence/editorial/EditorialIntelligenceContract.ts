export type EditorialProvenanceKind =
  | "EMPLOYER_FACT"
  | "CANDIDATE_FACT"
  | "RADAR_INFERENCE";

export interface EditorialEvidenceRef {
  kind: EditorialProvenanceKind;
  text: string;
  sourceId?: string;
  confidence?: number;
}

export interface CandidatePrecedent {
  capability: string;
  statement: string;
  evidenceIds: string[];
  confidence: number;
}

export interface PublishedRoleOutcome {
  statement: string;
  dimensionKey?: string;
}

export interface DecisionHinge {
  topic: string;
  question: string;
  reason: string;
}

/**
 * Presentation intelligence derived at evaluation time. It is deliberately
 * separate from the engine's scoring, verdict, and evaluation fingerprint.
 */
export interface EditorialIntelligenceContract {
  version: "editorial-intelligence-v1";
  verdict: "PURSUE" | "CONSIDER" | "PASS" | null;
  qualityScore: number | null;
  careerCase: string | null;
  principalRisk: string | null;
  careerTradeoff: string | null;
  whyNow: string | null;
  capabilityMatches: string[];
  candidatePrecedents: CandidatePrecedent[];
  publishedRoleOutcomes: PublishedRoleOutcome[];
  decisionHinges: DecisionHinge[];
  positioningAngles: string[];
  recommendedAction: string | null;
  provenance: EditorialEvidenceRef[];
}
