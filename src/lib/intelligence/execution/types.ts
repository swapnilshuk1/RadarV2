/**
 * src/lib/intelligence/execution/types.ts
 *
 * RADAR V4 — Phase 8.2B Six-State Candidate Truth Taxonomy & Provenance Contracts
 *
 * THE CONSTITUTIONAL LAW:
 * THE JD TELLS RADAR WHAT THE EMPLOYER WANTS.
 * ONLY VERIFIED CANDIDATE EVIDENCE MAY TELL RADAR WHAT THE CANDIDATE HAS DONE.
 * ANY CANDIDATE ASSERTION THAT CANNOT BE GROUNDED MUST BECOME EVIDENCE-GAP COACHING OR BE REMOVED.
 */

export type SixStateCandidateTruthClassification =
  | "EVIDENCE_BACKED_REFRAMING"
  | "EVIDENCE_BACKED_EMPHASIS"
  | "SAFE_GENERIC_POSITIONING"
  | "EVIDENCE_GAP_COACHING"
  | "UNSUPPORTED_INFERENCE"
  | "FABRICATED_ASSERTION";

export const RENDERABLE_CLASSIFICATIONS: readonly SixStateCandidateTruthClassification[] = [
  "EVIDENCE_BACKED_REFRAMING",
  "EVIDENCE_BACKED_EMPHASIS",
  "SAFE_GENERIC_POSITIONING",
  "EVIDENCE_GAP_COACHING"
] as const;

export const BLOCKED_CLASSIFICATIONS: readonly SixStateCandidateTruthClassification[] = [
  "UNSUPPORTED_INFERENCE",
  "FABRICATED_ASSERTION"
] as const;

export function isRenderableClassification(classification: SixStateCandidateTruthClassification): boolean {
  return RENDERABLE_CLASSIFICATIONS.includes(classification);
}

export function isBlockedClassification(classification: SixStateCandidateTruthClassification): boolean {
  return BLOCKED_CLASSIFICATIONS.includes(classification);
}

export interface CandidateEvidenceClaim {
  id: string;
  employer: string;
  role: string;
  period: string;
  verbatimQuote: string;
  verifiedMetrics: string[];
  verifiedCapabilities: string[];
  scope: string;
  evidenceType: "CRM_TRANSFORMATION" | "COMMERCIAL_LEADERSHIP" | "CENTER_OF_EXCELLENCE" | "ANALYTICS_EXPERIMENTATION" | "GENERAL_LEADERSHIP";
  isVerified: true;
}

export interface CandidateMetricProvenance {
  rawToken: string;
  normalizedValue: string;
  unit: string;
  context: string;
  sourceClaimId: string;
}

export interface CandidateEmployerProvenance {
  companyName: string;
  aliases: string[];
  roleTitle: string;
  tenure: string;
  isVerified: true;
}

export interface ScreeningQuestionItem {
  question: string;
  whyItMatters: string;
}

export type TruthPreservingRewrite = {
  category: string;
  currentNarrative: string;
  targetRoleRequirement: string;
  suggestionType: "TRUTH_PRESERVING_REWRITE";
  suggestedRevision: string;
  coachingGuidance?: never;
  candidateEvidenceIds: [string, ...string[]];
  candidateEvidenceQuotes: [string, ...string[]];
  jdRequirementIds: string[];
  targetEmployerLeak: false;
  unverifiedMetrics: string[];
  fabricationRisk: "ZERO";
};

export type EvidenceGapCoaching = {
  category: string;
  currentNarrative: string;
  targetRoleRequirement: string;
  suggestionType: "EVIDENCE_GAP_COACHING";
  suggestedRevision?: never;
  coachingGuidance: string;
  candidateEvidenceIds: string[];
  candidateEvidenceQuotes: string[];
  jdRequirementIds: string[];
  targetEmployerLeak: false;
  unverifiedMetrics: string[];
  fabricationRisk: "ZERO";
};

export type ResumeSuggestion = TruthPreservingRewrite | EvidenceGapCoaching;

export interface SafeLinkedInStrategy {
  recommendedHeadline: string;
  executiveAboutFraming: string;
  provenance: {
    groundedInCandidateAchievements: true;
    verifiedEmployerList: string[];
    verifiedMetricsUsed: string[];
    authoritativeTitleUsed: string;
  };
}

export interface SafeInterviewStrategy {
  openingHook: string;
  keyThemeToEmphasize: string;
  panelQuestion: string;
  prepDistinction: {
    candidateProofPoint: string;
    targetRoleBoundaryToClarify: string;
  };
}

export interface ExecutionPackage {
  recommendationConditions: string[];
  screeningQuestions: ScreeningQuestionItem[];
  resumeGaps: ResumeSuggestion[];
  linkedInStrategy: SafeLinkedInStrategy;
  interviewPrep: SafeInterviewStrategy;
  integrityValidation: {
    isTruthPreserving: boolean;
    targetEmployerLeakageCount: 0;
    fabricatedMetricCount: 0;
    fabricatedEmployerAssociationCount: 0;
    jdAsPastExperienceCount: 0;
    jdAsCandidateOwnershipCount: 0;
    unsupportedHighRiskVerbsCount: 0;
    unsupportedInferenceRendered: 0;
    ungroundedCandidateAssertionsRendered: 0;
    interceptedAndCoachedCount: number;
    fabricationRisk: "ZERO";
  };
}

export interface RejectedExecutionArtifact {
  timestamp: string;
  jobHash: string;
  targetCompany: string;
  surface: "RESUME" | "LINKEDIN" | "INTERVIEW";
  originalText: string;
  violationType: string;
  offendingToken?: string;
  diagnostic: string;
  replacementCoaching: string;
}
