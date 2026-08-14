/**
 * OpportunityBriefComposer.ts
 *
 * P2-G: Opportunity Detail Experience
 *
 * Brings all intelligence together into a cohesive executive brief.
 * For a meaningful opportunity, presents:
 *
 * PURSUE:
 * - Why this opportunity? (career/mandate interpretation)
 * - Why you? (strategic advantage)
 * - Principal risk (evidence-grounded concern)
 * - Your strongest evidence (specific candidate evidence)
 * - What is missing? (material gaps/uncertainty)
 * - Career value (why this changes trajectory)
 * - Shortlisting potential (why profile survives scrutiny)
 * - Pursuit effort (what must be done)
 * - Recommended action (specific next step)
 *
 * Do not expose engine terminology unless useful to the executive.
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import { synthesizeStrategicAdvantage } from "./StrategicAdvantageSynthesizer";
import { synthesizePrincipalRisk } from "./PrincipalRiskSynthesizer";
import { synthesizeCareerValue } from "./CareerValueSynthesizer";
import { synthesizeShortlistingPotential } from "./ShortlistingPotentialSynthesizer";
import { synthesizeEffort } from "./EffortSynthesizer";
import { synthesizeAction } from "./ActionSynthesizer";
import { synthesizeEngagementQuality } from "./EngagementTypeSynthesizer";
import { synthesizeCompensation } from "./CompensationSynthesizer";
import { synthesizeConfidence } from "./ConfidenceSynthesizer";

export interface ExecutiveBrief {
  /** Recommendation verb */
  recommendation: "PURSUE" | "CONSIDER" | "PASS" | "NOT_EVALUABLE" | "SPARSE_SPEC";

  /** Why this opportunity? - Career/mandate interpretation */
  whyThis: string;

  /** Why you? - Strategic advantage */
  whyYou: string;

  /** Principal risk - Evidence-grounded concern */
  principalRisk: string;

  /** Your strongest evidence - Specific candidate proof */
  strongestEvidence: string[];

  /** What is missing? - Material gaps/uncertainty */
  whatIsMissing: string[];

  /** Career value - Why this changes trajectory */
  careerValue: string;

  /** Shortlisting potential - Why profile survives scrutiny */
  shortlistingPotential: string;

  /** Pursuit effort - What must be done */
  pursuitEffort: string;

  /** Recommended action - Specific next step */
  recommendedAction: string;

  /** Engagement quality - Type and relevance */
  engagementQuality: string;

  /** Compensation interpretation */
  compensation: string;

  /** Confidence assessment */
  confidence: string;

  /** Key questions to validate */
  validationQuestions: string[];

  /** Overall confidence score */
  confidenceScore: number;
}

/**
 * Compose a complete executive brief
 */
export function composeExecutiveBrief(
  record: RecommendationRecord,
  source: OpportunitySource
): ExecutiveBrief {
  // Synthesize all intelligence components
  const strategicAdvantage = synthesizeStrategicAdvantage(record, source);
  const principalRisk = synthesizePrincipalRisk(record, source);
  const careerValue = synthesizeCareerValue(record, source);
  const shortlisting = synthesizeShortlistingPotential(record, source);
  const effort = synthesizeEffort(record, source);
  const action = synthesizeAction(record, source, strategicAdvantage, principalRisk, careerValue, effort);
  const engagement = synthesizeEngagementQuality(record, source);
  const compensation = synthesizeCompensation(record, source);
  const confidence = synthesizeConfidence(record, source);

  // Build validation questions from gaps and unknowns
  const validationQuestions: string[] = [];

  // Add from capability gaps
  if (record.claimPermissions?.explicitUnknowns?.length) {
    record.claimPermissions.explicitUnknowns
      .slice(0, 3)
      .forEach((gap) => {
        const cleanGap = gap.replace(/\[.*?\]/g, "").trim();
        validationQuestions.push(`Verify: ${cleanGap}`);
      });
  }

  // Add from confidence unknowns
  confidence.unknowns.slice(0, 2).forEach((unknown) => {
    if (!validationQuestions.some((q) => q.includes(unknown))) {
      validationQuestions.push(`Clarify: ${unknown}`);
    }
  });

  // Build strongest evidence
  const strongestEvidence: string[] = [];
  if (strategicAdvantage.evidence.length > 0) {
    strongestEvidence.push(...strategicAdvantage.evidence.slice(0, 2));
  }
  if (record.decisionDrivers?.length) {
    strongestEvidence.push(...record.decisionDrivers.slice(0, 2).map((d) => d.factor));
  }

  // Build what is missing
  const whatIsMissing: string[] = [];
  if (record.claimPermissions?.explicitUnknowns?.length) {
    whatIsMissing.push(
      ...record.claimPermissions.explicitUnknowns
        .slice(0, 3)
        .map((u) => u.replace(/\[.*?\]/g, "").trim())
    );
  }
  if (record.explanation?.missingEvidence?.length) {
    whatIsMissing.push(...record.explanation.missingEvidence.slice(0, 2));
  }

  // Determine recommendation
  const recommendation = record.verb;

  return {
    recommendation,
    whyThis: careerValue.statement,
    whyYou: strategicAdvantage.statement,
    principalRisk: principalRisk.statement,
    strongestEvidence,
    whatIsMissing,
    careerValue: careerValue.statement,
    shortlistingPotential: shortlisting.statement,
    pursuitEffort: effort.statement,
    recommendedAction: action.statement,
    engagementQuality: `${engagement.statement} ${engagement.relevanceRationale}`,
    compensation: `${compensation.statement} ${compensation.relevanceRationale}`,
    confidence: `${confidence.statement} ${confidence.validationNeeded || ""}`,
    validationQuestions,
    confidenceScore: confidence.score
  };
}

/**
 * Format brief for display
 */
export function formatBrief(brief: ExecutiveBrief): string {
  const sections = [
    `=== ${brief.recommendation} ===`,
    "",
    "WHY THIS OPPORTUNITY?",
    brief.whyThis,
    "",
    "WHY YOU?",
    brief.whyYou,
    "",
    "PRINCIPAL RISK",
    brief.principalRisk,
    "",
    "STRONGEST EVIDENCE",
    ...brief.strongestEvidence.map((e) => `• ${e}`),
    "",
    "WHAT IS MISSING?",
    ...brief.whatIsMissing.map((m) => `• ${m}`),
    "",
    "CAREER VALUE",
    brief.careerValue,
    "",
    "SHORTLISTING POTENTIAL",
    brief.shortlistingPotential,
    "",
    "PURSUIT EFFORT",
    brief.pursuitEffort,
    "",
    "RECOMMENDED ACTION",
    brief.recommendedAction,
    "",
    "ENGAGEMENT TYPE",
    brief.engagementQuality,
    "",
    "COMPENSATION",
    brief.compensation,
    "",
    `CONFIDENCE: ${(brief.confidenceScore * 100).toFixed(0)}%`,
    brief.confidence,
    "",
    "VALIDATION QUESTIONS",
    ...brief.validationQuestions.map((q) => `? ${q}`)
  ];

  return sections.join("\n");
}
