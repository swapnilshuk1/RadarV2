/**
 * scripts/eval/v4-simulation/types.ts
 *
 * Type definitions for RADAR V4 Phase 8 End-to-End Engine Simulation & Verbatim Quality Audit.
 */

import type { OpportunitySource, DimensionResult } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { Presented } from "@/lib/intelligence/present";
import type { BriefModel } from "@/lib/intelligence/editorial/BriefCompositionEngine";

export type VerbatimClassification =
  | "FACTUAL"
  | "EVIDENCE-GROUNDED INFERENCE"
  | "REASONABLE INTERPRETATION"
  | "SPECULATIVE"
  | "UNSUPPORTED"
  | "CONTRADICTORY"
  | "GENERIC / LOW-VALUE";

export interface VerbatimTrace {
  id: string;
  section: string;
  field: string;
  verbatim: string;
  classification: VerbatimClassification;
  editorialPattern?: string;
  policySignal?: string;
  matchedOntologyKey?: string;
  jdQuote?: string;
  groundedInJD: boolean;
  notes?: string;
}

export interface ObjectiveQualityScores {
  evidenceGroundingScore: number; // 0-5
  contradictionScore: number;     // 0-5
  policyAlignmentScore: number;   // 0-5
  specificityScore: number;       // 0-5
  riskHonestyScore: number;       // 0-5
  calibrationScore: number;       // 0-5
  actionabilityScore: number;     // 0-5
  totalObjectiveScore: number;    // sum out of 35
}

export interface ContradictionFinding {
  jobHash: string;
  type:
    | "POLICY_VS_EDITORIAL_VERDICT"
    | "CAREER_REGRESSION_SUPPRESSION"
    | "DOMAIN_MISMATCH_SUPPRESSION"
    | "MANDATE_GAP_SUPPRESSION"
    | "SPARSE_SPEC_FALSE_CONFIDENCE"
    | "POLICY_AUTHORITY_MUTATION";
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  details: string;
  policyVerdict: string;
  editorialSnippet: string;
}

export interface SimulationRecord {
  jobHash: string;
  fileSource: string;
  rawOpportunity: OpportunitySource;
  extractedDimensions: DimensionResult[];
  fullJDText: string;
  role: string;
  company: string;
  location: string;
  source: string;
  applyUrl: string;
  category: string;
  seniorityTier: string;
  fitSpectrumBucket: string;
  gateResult: {
    passed: boolean;
    evaluationStatus: string;
    reason?: string;
  };
  isolatedAssessments: {
    identity: any;
    capability: any;
    opportunity: any;
    career: any;
    careerValue: any;
    lifestyle: any;
  };
  shortlistingPotential: {
    score: number;
    band: string;
    breakdown: any;
  };
  policyResult: {
    verdict: string;
    rawScore: number;
    priorityScore: number | null;
    vetoed: boolean;
    vetoReason: string | null;
    triggeredRuleIds: string[];
    decisionDrivers: any[];
    decisionRisks: any[];
    relativeDifferentiator?: string;
    trajectoryUpside?: string;
  };
  recommendationRecord: RecommendationRecord;
  presented: Presented;
  briefModel?: BriefModel;
  verbatimAudits: VerbatimTrace[];
  objectiveScores: ObjectiveQualityScores;
  contradictions: ContradictionFinding[];
  failures: string[]; // Silent failure checks
  assessmentVerdict: "PASS" | "REVIEW" | "FAIL";
}

export interface InterplayRow {
  index: number;
  jobHash: string;
  role: string;
  company: string;
  category: string;
  seniority: string;
  policyVerdict: string;
  score: string;
  careerUpside: string;
  keyRisk: string;
  keyDriver: string;
  verbatimScore: string;
  hasContradiction: boolean;
  assessment: "PASS" | "REVIEW" | "FAIL";
}

export interface MutationVariantResult {
  variantType: "PL_REMOVED" | "MANDATE_REMOVED" | "SENIORITY_CHANGED" | "DOMAIN_CHANGED";
  description: string;
  originalVerdict: string;
  mutatedVerdict: string;
  originalScore: number | null;
  mutatedScore: number | null;
  engineRespondedCausally: boolean;
  deltaSummary: string;
}

export interface CaseMutationResult {
  jobHash: string;
  role: string;
  company: string;
  variants: MutationVariantResult[];
  allCausal: boolean;
}

export interface CategoryAggregate {
  category: string;
  count: number;
  avgScore: number;
  pursueCount: number;
  considerCount: number;
  passCount: number;
  sparseCount: number;
  avgGroundingScore: number;
  contradictionCount: number;
  genericPhraseRate: number;
  unsupportedClaimCount: number;
  assessmentPassRate: number;
}

export interface SeniorityAggregate {
  seniorityTier: string;
  count: number;
  avgScore: number;
  pursueCount: number;
  considerCount: number;
  passCount: number;
  sparseCount: number;
  contradictionCount: number;
  unsupportedClaimCount: number;
}

export interface GenericPhraseMatch {
  phrase: string;
  frequency: number;
  percentageOfCorpus: number;
  categories: string[];
  isEvidenceSupported: boolean;
}

export interface HumanReviewCase {
  cohort: string;
  jobHash: string;
  role: string;
  company: string;
  category: string;
  seniority: string;
  fullJDText: string;
  ontologySummary: any;
  engineOutputsSummary: any;
  policyResult: any;
  briefText: string;
  verbatimAuditSummary: {
    total: number;
    grounded: number;
    unsupported: number;
    contradictory: number;
    generic: number;
  };
  contradictions: ContradictionFinding[];
  objectiveScoreTotal: number;
}

export type CertificationStatus =
  | "🟢 CERTIFIED"
  | "🟡 CERTIFIED WITH DEBT"
  | "🟠 REQUIRES REMEDIATION"
  | "🔴 FAIL";

export interface SimulationManifest {
  runId: string;
  timestamp: string;
  engineVersion: string;
  ontologyVersion: string;
  candidateProfileFingerprint: string;
  totalJDs: number;
  categoriesRepresented: number;
  seniorityTiersRepresented: number;
  certificationStatus: CertificationStatus;
  summaryMetrics: {
    policyEditorialAlignmentRate: number;
    unsupportedClaimRate: number;
    directContradictionCount: number;
    evidenceTraceabilityRate: number;
    genericPhraseRate: number;
    mutationCausalityRate: number;
    averageObjectiveQualityScore: number;
    totalFailuresCount: number;
  };
}
