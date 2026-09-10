export type EditorialProvenanceKind =
  | "EMPLOYER_FACT"
  | "CANDIDATE_FACT"
  | "RADAR_INFERENCE"
  | "CANONICAL_SIGNAL";

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
  provenance: "CANDIDATE_FACT";
}

export type PublishedRoleWorkKind = "RESPONSIBILITY" | "OUTCOME";

/** Exact bounded employer work, retained from presentation-only role evidence. */
export interface PublishedRoleWork {
  kind: PublishedRoleWorkKind;
  statement: string;
  sourceEvidenceId: string;
  capabilityKeys: string[];
}

/** Structural employer context, deliberately not publishable work. */
export interface PublishedRoleContext {
  kind: "ROLE_CONTEXT";
  statement: string;
  sourceEvidenceId: string;
  capabilityKeys: string[];
}

/** Explicit candidate qualification, deliberately distinct from employer work. */
export interface PublishedQualificationRequirement {
  capability: string;
  statement: string;
  materiality: "CORE" | "SUPPORTING";
  sourceEvidenceIds: string[];
}

export interface CanonicalEditorialSignal {
  id: string;
  kind:
    | "VERDICT"
    | "SCORE"
    | "OPERATING_LEVEL"
    | "WORK_NATURE"
    | "DECISION_AUTHORITY"
    | "COMMERCIAL_SCOPE"
    | "CAPABILITY"
    | "DIMENSION"
    | "RISK"
    | "TRADEOFF"
    | "HINGE";
  value: string;
  provenance: "CANONICAL_EVALUATION";
  /** Internal structured identity for deterministic editorial joins; never prose. */
  capabilityKeys?: string[];
}

export type EditorialSynthesisInput =
  | {
      type: "EMPLOYER_FACT";
      sourceEvidenceIds: string[];
    }
  | {
      type: "CANDIDATE_FACT";
      candidateEvidenceIds: string[];
    }
  | {
      type: "RADAR_INFERENCE";
      roleEvidenceIds: string[];
      candidateEvidenceIds?: string[];
      canonicalSignalIds?: string[];
    }
  | {
      type: "EVIDENCE_LIMITATION";
      reason: string;
    };

export interface CandidateCapabilitySignal {
  capability: string;
  /** Bounded source-backed candidate fact when the projection retained one. */
  statement: string | null;
  confidence: number;
  evidenceIds: string[];
  provenance: "CANDIDATE_FACT";
  /** Internal candidate-projection identity; never prose. */
  capabilityKeys: string[];
}

/**
 * A role-specific candidate/evaluation relationship already present in the
 * canonical artifact. It does not run a new matcher or create score evidence.
 */
export interface CandidateFitEvidence {
  /** Stable contract identity for exactly one persisted evaluator relationship. */
  id: string;
  /** Exact evaluator-visible source references; never expanded into a cartesian join. */
  candidateEvidenceIds: string[];
  jobEvidenceIds: string[];
  /** Source-resolved evaluator job evidence, retained separately from role work. */
  jobEvidence: Array<{
    id: string;
    statement: string;
    kind: "ROLE_WORK" | "QUALIFICATION" | "CAPABILITY_EVIDENCE";
  }>;
  candidateCapabilityKey: string;
  jobCapabilityKey: string;
  relationship: "MATCH" | "ADJACENT" | "GAP" | "UNKNOWN";
  /** Optional canonical signal only when it independently resolves. */
  canonicalSignalId?: string;
}

/**
 * A deliberately honest view of persisted decision detail. Empty arrays mean
 * the canonical payload retained only scalar decision data, not that a driver
 * should be invented from generic candidate inventory.
 */
export interface EditorialDecisionDrivers {
  strengths: CanonicalEditorialSignal[];
  constraints: CanonicalEditorialSignal[];
  unknowns: CanonicalEditorialSignal[];
  hinges: CanonicalEditorialSignal[];
  availability: "PERSISTED_DRIVER_DETAIL" | "SCALAR_ONLY";
}

/**
 * Legacy composer compatibility only. New editorial work must use
 * publishedRoleWork, whose sourceEvidenceId retains exact provenance.
 */
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
  version: "editorial-intelligence-v2";
  verdict: "PURSUE" | "CONSIDER" | "PASS" | null;
  qualityScore: number | null;
  careerCase: string | null;
  principalRisk: string | null;
  careerTradeoff: string | null;
  whyNow: string | null;
  capabilityMatches: string[];
  candidateCapabilities: CandidateCapabilitySignal[];
  candidateFitEvidence: CandidateFitEvidence[];
  candidatePrecedents: CandidatePrecedent[];
  publishedRoleWork: PublishedRoleWork[];
  roleContext: PublishedRoleContext[];
  qualificationRequirements: PublishedQualificationRequirement[];
  canonicalSignals: CanonicalEditorialSignal[];
  decisionDrivers: EditorialDecisionDrivers;
  synthesisInputs: EditorialSynthesisInput[];
  /** @deprecated Phase 3 composer compatibility adapter. */
  publishedRoleOutcomes: PublishedRoleOutcome[];
  decisionHinges: DecisionHinge[];
  positioningAngles: string[];
  recommendedAction: string | null;
  provenance: EditorialEvidenceRef[];
}
