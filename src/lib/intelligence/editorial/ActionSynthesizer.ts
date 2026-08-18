/**
 * ActionSynthesizer.ts
 *
 * P2-A.5: Recommended Action Intelligence
 *
 * Synthesizes actionable next steps based on:
 * - decision (PURSUE / CONSIDER / PASS)
 * - strategic advantage (Why Me?)
 * - principal risk (What should worry me?)
 * - career value (Why this opportunity?)
 * - effort level (What will it take?)
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { StrategicAdvantage } from "./StrategicAdvantageSynthesizer";
import type { PrincipalRisk } from "./PrincipalRiskSynthesizer";
import type { CareerValueInterpretation } from "./CareerValueSynthesizer";
import type { EffortInterpretation } from "./EffortSynthesizer";

export interface RecommendedAction {
  /** The synthesized action statement */
  statement: string;

  /** Action category */
  category: "pursue" | "consider" | "pass" | "not_evaluable";

  /** Primary action verb */
  primaryAction: string;

  /** Expected time to execute */
  timeEstimate: string;

  /** Prerequisites before action */
  prerequisites?: string;

  /** Expected outcome */
  expectedOutcome: string;

  /** Risk of taking this action */
  actionRisk?: string;

  /** Alternative if this action fails */
  alternativeAction?: string;

  /** Confidence in recommendation */
  confidence: number;
}

/**
 * Synthesize recommended action from all intelligence components
 */
export function synthesizeAction(
  record: RecommendationRecord,
  source: OpportunitySource,
  strategicAdvantage?: StrategicAdvantage,
  principalRisk?: PrincipalRisk,
  careerValue?: CareerValueInterpretation,
  effort?: EffortInterpretation
): RecommendedAction {
  const decision = record.verb;

  switch (decision) {
    case "PURSUE":
      return synthesizePursueAction(record, source, strategicAdvantage, principalRisk, careerValue, effort);
    case "CONSIDER":
      return synthesizeConsiderAction(record, source, strategicAdvantage, principalRisk, careerValue, effort);
    case "PASS":
      return synthesizePassAction(record, source, principalRisk, careerValue);
    case "SPARSE_SPEC":
    case "NOT_EVALUABLE":
      return synthesizeNotEvaluableAction(record, source);
    default:
      return synthesizeDefaultAction(record, source);
  }
}

/**
 * Synthesize PURSUE action
 */
function synthesizePursueAction(
  record: RecommendationRecord,
  source: OpportunitySource,
  strategicAdvantage?: StrategicAdvantage,
  principalRisk?: PrincipalRisk,
  careerValue?: CareerValueInterpretation,
  effort?: EffortInterpretation
): RecommendedAction {
  let statement: string;
  let timeEstimate: string;
  let prerequisites: string | undefined;
  let expectedOutcome: string;

  const roleTitle = source.role || "Executive Role";
  const companyName = source.company || "Target Company";
  const hasMaterialRisk = principalRisk?.severity === "high";
  const hasHighEffort = effort?.effortLevel === "high";
  const hasForwardTrajectory = careerValue?.trajectoryCategory === "forward_progression";

  const confidence = strategicAdvantage?.confidence ?? 0.85;

  if (hasMaterialRisk && hasHighEffort) {
    statement = `Proceed with high priority for ${roleTitle} at ${companyName}. Validate reporting structure during the initial call while leveraging your core transformation precedent.`;
    timeEstimate = effort?.timeEstimate || "8-12 hours";
    prerequisites = `Confirm key mandate boundaries before deep deck preparation`;
    expectedOutcome = "Screening conversation scheduled with search partner";
  } else if (hasForwardTrajectory && !hasHighEffort) {
    statement = `Proceed immediately for ${roleTitle} at ${companyName}. This mandate expands your commercial trajectory with low repositioning friction. Initiate contact this week.`;
    timeEstimate = effort?.timeEstimate || "2-4 hours";
    expectedOutcome = "Screening call within 3-5 days";
  } else if (hasHighEffort) {
    statement = `Proceed after targeted preparation for ${companyName}. Tailor your executive brief to emphasize transformation and P&L scale precedents.`;
    timeEstimate = effort?.timeEstimate || "6-10 hours";
    prerequisites = effort?.validationNeeded;
    expectedOutcome = "Positioned application submitted with validated domain alignment";
  } else {
    statement = `Proceed with outreach for ${roleTitle} at ${companyName}. Request an initial screening call to confirm operational scope and timeline.`;
    timeEstimate = effort?.timeEstimate || "3-5 hours";
    expectedOutcome = "Initial conversation scheduled within 1 week";
  }

  return {
    statement,
    category: "pursue",
    primaryAction: "Proceed with screening",
    timeEstimate,
    prerequisites,
    expectedOutcome,
    confidence,
    actionRisk: principalRisk?.statement ? `Risk: ${principalRisk.statement}` : undefined,
    alternativeAction: hasMaterialRisk ? "Pivot to lower-risk alternatives if scope validation fails" : undefined
  };
}

/**
 * Synthesize CONSIDER action
 */
function synthesizeConsiderAction(
  record: RecommendationRecord,
  source: OpportunitySource,
  strategicAdvantage?: StrategicAdvantage,
  principalRisk?: PrincipalRisk,
  careerValue?: CareerValueInterpretation,
  effort?: EffortInterpretation
): RecommendedAction {
  let statement: string;

  const roleTitle = source.role || "Executive Role";
  const companyName = source.company || "Target Company";
  const hasUncertainty = principalRisk?.category === "job_spec_uncertainty" || principalRisk?.category === "missing_evidence";
  const hasCareerConcerns = careerValue?.trajectoryCategory === "backward_regression";

  const confidence = 0.75;

  if (hasUncertainty) {
    statement = `Request scope clarification before investing deep effort in ${roleTitle} at ${companyName}. Conduct a single screening call to resolve missing mandate context.`;
  } else if (hasCareerConcerns) {
    statement = `Selective consideration for ${roleTitle} at ${companyName}. Conduct an exploratory conversation to verify whether actual commercial P&L scope compensates for title alignment.`;
  } else {
    statement = `Consider with targeted validation. Conduct an initial conversation with ${companyName} to test scope flexibility before deeper time investment.`;
  }

  return {
    statement,
    category: "consider",
    primaryAction: "Validate before committing",
    timeEstimate: effort?.timeEstimate || "2-3 hours",
    expectedOutcome: "Sufficient information to upgrade to PURSUE or decline to PASS",
    confidence
  };
}

/**
 * Synthesize PASS action
 */
function synthesizePassAction(
  record: RecommendationRecord,
  source: OpportunitySource,
  principalRisk?: PrincipalRisk,
  careerValue?: CareerValueInterpretation
): RecommendedAction {
  let statement: string;
  const roleTitle = source.role || "Executive Role";
  const companyName = source.company || "Target Company";

  const hasCareerRegression = careerValue?.trajectoryCategory === "backward_regression";
  const hasIdentityMismatch = principalRisk?.category === "identity_domain_concern";

  if (hasCareerRegression) {
    statement = `Decline ${roleTitle} at ${companyName}. The mandate represents career regression. Preserve search bandwidth for roles that advance your executive trajectory.`;
  } else if (hasIdentityMismatch) {
    statement = `Pass on ${roleTitle} at ${companyName}. The role operates in an adjacent functional domain outside your core executive focus. Rejecting this preserves positioning focus.`;
  } else {
    statement = `Pass on ${roleTitle} at ${companyName}. The mandate scope sits below your target commercial altitude. Preserve search bandwidth for full-scope executive seats.`;
  }

  return {
    statement,
    category: "pass",
    primaryAction: "Decline and preserve bandwidth",
    timeEstimate: "No time investment required",
    expectedOutcome: "Preserved executive search focus for higher-alignment opportunities",
    confidence: 0.85
  };
}

/**
 * Synthesize NOT_EVALUABLE / SPARSE_SPEC action
 */
function synthesizeNotEvaluableAction(
  record: RecommendationRecord,
  source: OpportunitySource
): RecommendedAction {
  const companyName = source.company || "Target Company";
  return {
    statement: `Defer evaluation for ${companyName}. Insufficient information in specification to provide a reliable recommendation. Request full JD if strategically relevant.`,
    category: "not_evaluable",
    primaryAction: "Request more information",
    timeEstimate: "No action required",
    expectedOutcome: "Sufficient specification to enable evaluation",
    confidence: 0.5
  };
}

/**
 * Default action for edge cases
 */
function synthesizeDefaultAction(
  record: RecommendationRecord,
  source: OpportunitySource
): RecommendedAction {
  return {
    statement: `Review opportunity details for ${source.role} at ${source.company} and evaluate against your current priority track.`,
    category: "consider",
    primaryAction: "Review and evaluate",
    timeEstimate: "1-2 hours",
    expectedOutcome: "Initial assessment of fit and priority",
    confidence: 0.6
  };
}

export function formatAction(action: RecommendedAction): string {
  return action.statement;
}

export function getActionIndicator(action: RecommendedAction): {
  label: string;
  color: "green" | "amber" | "red" | "neutral";
} {
  switch (action.category) {
    case "pursue":
      return { label: "Pursue", color: "green" };
    case "consider":
      return { label: "Consider", color: "amber" };
    case "pass":
      return { label: "Pass", color: "red" };
    case "not_evaluable":
      return { label: "Needs More Info", color: "neutral" };
    default:
      return { label: "Evaluate", color: "neutral" };
  }
}
