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
 *
 * Actions should be:
 * - concise
 * - executive-facing
 * - decision appropriate
 * - evidence grounded
 * - useful immediately
 *
 * PURSUE: concrete forward action
 * CONSIDER: validation / selective preparation
 * PASS: explain why time should NOT be invested
 * NOT_EVALUABLE: no fabricated action
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
  const evidence: string[] = [];

  // Collect evidence from components
  if (strategicAdvantage?.category) {
    evidence.push(`Strategic advantage: ${strategicAdvantage.category}`);
  }
  if (principalRisk?.category) {
    evidence.push(`Principal risk: ${principalRisk.category}`);
  }
  if (careerValue?.trajectoryCategory) {
    evidence.push(`Career trajectory: ${careerValue.trajectoryCategory}`);
  }
  if (effort?.effortLevel) {
    evidence.push(`Effort level: ${effort.effortLevel}`);
  }

  // Build action based on decision
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
  // Build action based on risk and effort
  let statement: string;
  let timeEstimate: string;
  let prerequisites: string | undefined;
  let expectedOutcome: string;
  let confidence: number;

  const hasMaterialRisk = principalRisk?.severity === "high";
  const hasHighEffort = effort?.effortLevel === "high";
  const hasForwardTrajectory = careerValue?.trajectoryCategory === "forward_progression";

  confidence = strategicAdvantage?.confidence ?? 0.75;

  if (hasMaterialRisk && hasHighEffort) {
    // High reward but high friction - proceed with caution
    statement = `Proceed with priority but validate ${principalRisk?.mitigation?.toLowerCase() || "key assumptions"} before full investment. Your ${strategicAdvantage?.category === "transformation_experience" ? "transformation credentials" : "capability alignment"} is strong, but the ${principalRisk?.statement.toLowerCase().slice(0, 60)}... requires upfront clarification.`;
    timeEstimate = effort?.timeEstimate || "8-12 hours";
    prerequisites = `Confirm ${principalRisk?.evidence[0]?.toLowerCase() || "key requirements"} before significant preparation`;
    expectedOutcome = "Priority interview within 1-2 weeks with validated positioning";
  } else if (hasForwardTrajectory && !hasHighEffort) {
    // Strong forward trajectory with low effort - move quickly
    statement = `Proceed immediately. This ${careerValue?.dimensions.title.direction === "up" ? "elevated role" : "strategic opportunity"} aligns with your trajectory and requires minimal repositioning. Initiate contact this week while the opportunity is fresh.`;
    timeEstimate = effort?.timeEstimate || "2-4 hours";
    expectedOutcome = "Screening call within 3-5 days, strong conversion probability";
  } else if (hasHighEffort) {
    // High effort but worth it
    statement = `Proceed after targeted preparation. ${effort?.preparationRequired[0] || "Tailor your positioning"} to emphasize ${strategicAdvantage?.category === "core_mandate_match" ? "core mandate alignment" : "strategic advantages"}. The effort is justified by the ${hasForwardTrajectory ? "career progression potential" : "mandate scope"}.`;
    timeEstimate = effort?.timeEstimate || "6-10 hours";
    prerequisites = effort?.validationNeeded;
    expectedOutcome = "Well-positioned application with validated fit";
  } else {
    // Standard pursue
    statement = `Proceed. ${strategicAdvantage?.statement.slice(0, 80) || "Strong capability alignment"}... Request a screening call to confirm scope and timeline.`;
    timeEstimate = effort?.timeEstimate || "3-5 hours";
    expectedOutcome = "Initial conversation within 1 week";
  }

  return {
    statement,
    category: "pursue",
    primaryAction: "Proceed with screening",
    timeEstimate,
    prerequisites,
    expectedOutcome,
    confidence,
    actionRisk: principalRisk?.statement ? `Risk: ${principalRisk.statement.slice(0, 60)}...` : undefined,
    alternativeAction: hasMaterialRisk ? "Pivot to lower-risk alternatives if validation fails" : undefined
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
  let timeEstimate: string;
  let prerequisites: string | undefined;
  let expectedOutcome: string;
  let confidence: number;

  const hasUncertainty = principalRisk?.category === "job_spec_uncertainty" || principalRisk?.category === "missing_evidence";
  const hasModerateRisk = principalRisk?.severity === "medium";
  const hasCareerConcerns = careerValue?.trajectoryCategory === "backward_regression";

  confidence = 0.7;

  if (hasUncertainty) {
    // Need more information before proceeding
    statement = `Request clarification before investing. The ${principalRisk?.statement.toLowerCase().slice(0, 70) || "key details"}... must be resolved to evaluate fit. A single screening call should surface the missing context.`;
    timeEstimate = "1-2 hours for initial outreach";
    prerequisites = `Obtain ${principalRisk?.mitigation?.toLowerCase() || "missing information"}`;
    expectedOutcome = "Sufficient information to upgrade to PURSUE or downgrade to PASS";
  } else if (hasCareerConcerns && strategicAdvantage) {
    // Career concerns but some advantage - selective pursuit
    statement = `Selective consideration. While ${careerValue?.statement.toLowerCase().slice(0, 60)}..., your ${strategicAdvantage.evidence[0]?.toLowerCase() || "relevant experience"} may justify a single exploratory conversation.`;
    timeEstimate = effort?.timeEstimate || "2-3 hours";
    prerequisites = "Verify actual scope exceeds current role before any preparation";
    expectedOutcome = "Clarity on whether scope compensates for trajectory concerns";
  } else if (hasModerateRisk) {
    // Moderate risk - validate first
    statement = `Validate ${principalRisk?.mitigation?.toLowerCase() || "key assumptions"} before proceeding. Your ${strategicAdvantage?.category === "capability_combination" ? "capability profile" : "experience"} is relevant, but ${principalRisk?.statement.toLowerCase().slice(0, 50)}... warrants clarification.`;
    timeEstimate = effort?.timeEstimate || "3-5 hours";
    expectedOutcome = "Validated decision to pursue or pass based on risk clarification";
  } else {
    // Standard consider
    statement = `Consider with selective preparation. Conduct one screening conversation to verify scope and expectations before significant time investment.`;
    timeEstimate = effort?.timeEstimate || "3-4 hours";
    expectedOutcome = "Sufficient information to proceed or decline";
  }

  return {
    statement,
    category: "consider",
    primaryAction: "Validate before committing",
    timeEstimate,
    prerequisites,
    expectedOutcome,
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
  let expectedOutcome: string;
  let confidence: number;

  const hasCareerRegression = careerValue?.trajectoryCategory === "backward_regression";
  const hasIdentityMismatch = principalRisk?.category === "identity_domain_concern";
  const hasMaterialGap = principalRisk?.category === "material_capability_gap";

  confidence = 0.8;

  if (hasCareerRegression) {
    statement = `Decline. ${careerValue?.statement.slice(0, 80) || "This represents career regression"}... Preserve bandwidth for roles that advance rather than constrain your trajectory.`;
    expectedOutcome = "Preserved headspace for better-aligned opportunities";
  } else if (hasIdentityMismatch) {
    statement = `Pass. ${principalRisk?.statement.slice(0, 80) || "Significant domain/identity mismatch"}... Rejecting this preserves focus for roles within your core executive identity.`;
    expectedOutcome = "Clear focus on native-domain opportunities";
  } else if (hasMaterialGap) {
    statement = `Pass. ${principalRisk?.statement.slice(0, 80) || "Material capability gaps"}... The effort to bridge these gaps outweighs the likely return.`;
    expectedOutcome = "Time redirected toward better-fit opportunities";
  } else {
    statement = `Pass. The mandate scope and requirements sit below your target commercial altitude. Preserve search bandwidth for full-scope executive mandates.`;
    expectedOutcome = "Preserved executive search focus";
  }

  return {
    statement,
    category: "pass",
    primaryAction: "Decline and preserve bandwidth",
    timeEstimate: "No time investment required",
    expectedOutcome,
    confidence
  };
}

/**
 * Synthesize NOT_EVALUABLE / SPARSE_SPEC action
 */
function synthesizeNotEvaluableAction(
  record: RecommendationRecord,
  source: OpportunitySource
): RecommendedAction {
  return {
    statement: `Defer evaluation. Insufficient information to provide a meaningful recommendation. Request additional job specification details if this opportunity appears strategically relevant.`,
    category: "not_evaluable",
    primaryAction: "Request more information",
    timeEstimate: "No action until more information available",
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
    statement: `Review opportunity details and evaluate against your current priorities and trajectory goals.`,
    category: "consider",
    primaryAction: "Review and evaluate",
    timeEstimate: "1-2 hours for initial review",
    expectedOutcome: "Initial assessment of fit and priority",
    confidence: 0.6
  };
}

/**
 * Format action for presentation
 */
export function formatAction(action: RecommendedAction): string {
  return action.statement;
}

/**
 * Get action category indicator for UI
 */
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
