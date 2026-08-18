/**
 * CareerValueSynthesizer.ts
 *
 * P2-A.3: Career Value Interpretation
 *
 * Translates career trajectory assessment (FORWARD/LATERAL/BACKWARD) and
 * CareerValueBreakdown dimensions into executive-facing career meaning.
 *
 * RADAR should explain whether an opportunity represents:
 * - meaningful forward progression
 * - broader mandate
 * - greater strategic scope
 * - greater commercial ownership
 * - greater enterprise influence
 * - lateral movement
 * - narrower functional scope
 * - career regression
 *
 * Do NOT merely expose: FORWARD / LATERAL / BACKWARD
 * Translate the assessment into executive meaning grounded in evidence.
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

export interface CareerValueInterpretation {
  /** The synthesized career value statement */
  statement: string;

  /** The career trajectory category */
  trajectoryCategory: "forward_progression" | "lateral_consolidation" | "backward_regression" | "unclear";

  /** Specific dimensions of value */
  dimensions: {
    title: { interpretation: string; direction: "up" | "lateral" | "down" | "unclear" };
    scope: { interpretation: string; direction: "broader" | "similar" | "narrower" | "unclear" };
    commercial: { interpretation: string; direction: "greater" | "similar" | "lesser" | "unclear" };
    brand: { interpretation: string; signal: "strong" | "moderate" | "weak" | "unknown" };
    optionality: { interpretation: string; outlook: "enhanced" | "maintained" | "reduced" | "unclear" };
  };

  /** Evidence grounding */
  evidence: string[];

  /** Confidence in interpretation */
  confidence: number;

  /** Overall career value score (0-100) */
  valueScore: number;
}

/**
 * Synthesize career value interpretation from assessment outputs
 */
export function synthesizeCareerValue(
  record: RecommendationRecord,
  source: OpportunitySource
): CareerValueInterpretation {
  const evidence: string[] = [];
  const breakdown = record.trace?.careerValueBreakdown;
  const careerAssessment = record.trace?.factors?.careerValue ?? 0;

  // Default structure if breakdown is missing
  const titleProgression = breakdown?.titleProgression ?? { value: 0.5, reason: "Unknown", status: "UNKNOWN" };
  const scopeExpansion = breakdown?.scopeExpansion ?? { value: 0.5, reason: "Unknown", status: "UNKNOWN" };
  const commercialScale = breakdown?.commercialScale ?? { value: 0.5, reason: "Unknown", status: "UNKNOWN" };
  const brandSignal = breakdown?.brandSignal ?? { value: 0.5, reason: "Unknown", status: "UNKNOWN" };
  const futureOptionality = breakdown?.futureOptionality ?? { value: 0.5, reason: "Unknown", status: "UNKNOWN" };

  // Get trajectory from record
  const trajectory = record.trace?.factors?.careerValue
    ? (record.trace.factors.careerValue > 70 ? "FORWARD" : record.trace.factors.careerValue > 50 ? "LATERAL" : "BACKWARD")
    : "LATERAL";

  // Build dimension interpretations
  const titleInterpretation = interpretTitleProgression(titleProgression, source.role);
  const scopeInterpretation = interpretScopeExpansion(scopeExpansion);
  const commercialInterpretation = interpretCommercialScale(commercialScale);
  const brandInterpretation = interpretBrandSignal(brandSignal, source.company);
  const optionalityInterpretation = interpretFutureOptionality(futureOptionality);

  // Collect evidence
  if (titleProgression.reason !== "Unknown") {
    evidence.push(`Title: ${titleProgression.reason}`);
  }
  if (scopeExpansion.reason !== "Unknown") {
    evidence.push(`Scope: ${scopeExpansion.reason}`);
  }
  if (commercialScale.reason !== "Unknown") {
    evidence.push(`Commercial: ${commercialScale.reason}`);
  }
  if (brandSignal.reason !== "Unknown") {
    evidence.push(`Brand: ${brandSignal.reason}`);
  }

  // Determine overall trajectory category
  let trajectoryCategory: CareerValueInterpretation["trajectoryCategory"];
  let statement: string;
  let confidence: number;
  let valueScore: number;

  // Calculate composite value score
  const avgDimensionValue = (
    titleProgression.value +
    scopeExpansion.value +
    commercialScale.value +
    brandSignal.value +
    futureOptionality.value
  ) / 5;
  valueScore = Math.round(avgDimensionValue * 100);

  // Prioritize meaningful signals
  const hasTitleRegression = titleProgression.value < 0.5;
  const hasScopeReduction = scopeExpansion.value < 0.5;
  const hasWeakCommercial = commercialScale.value < 0.5;
  const hasStrongForward = titleProgression.value >= 0.7 && scopeExpansion.value >= 0.7;
  const hasBroadScope = scopeExpansion.value >= 0.8 && commercialScale.value >= 0.8;

  // Build executive statement based on pattern
  if (hasTitleRegression && (hasScopeReduction || hasWeakCommercial)) {
    // Backward trajectory
    trajectoryCategory = "backward_regression";
    confidence = 0.75;

    const regressionElements: string[] = [];
    if (hasTitleRegression) regressionElements.push("operating level");
    if (hasScopeReduction) regressionElements.push("scope");
    if (hasWeakCommercial) regressionElements.push("commercial ownership");

    statement = `This role represents a step back in ${regressionElements.join(" and ")} compared to your current trajectory. The primary career concern is trajectory deceleration rather than capability mismatch.`;

  } else if (hasStrongForward && hasBroadScope) {
    // Strong forward progression
    trajectoryCategory = "forward_progression";
    confidence = 0.85;

    const forwardElements: string[] = [];
    if (titleProgression.value >= 0.9) forwardElements.push("clear title elevation");
    if (scopeExpansion.value >= 0.85) forwardElements.push("expanded executive scope");
    if (commercialScale.value >= 0.85) forwardElements.push("greater commercial accountability");
    if (brandSignal.value >= 0.75) forwardElements.push("stronger brand signal");

    statement = `This opportunity advances your trajectory through ${forwardElements.join(", ")}. It represents meaningful forward progression that should enhance your long-term optionality.`;

  } else if (trajectory === "FORWARD" || valueScore >= 70) {
    // Moderate forward progression
    trajectoryCategory = "forward_progression";
    confidence = 0.75;

    const progressionElements: string[] = [];
    if (titleProgression.value >= 0.7) progressionElements.push("title progression");
    if (scopeExpansion.value >= 0.7) progressionElements.push("scope expansion");
    if (commercialScale.value >= 0.75) progressionElements.push("greater commercial scale");
    if (futureOptionality.value >= 0.8) progressionElements.push("enhanced future optionality");

    if (progressionElements.length > 0) {
      statement = `This role offers ${progressionElements.join(", ")}. While not transformational, it consolidates your current altitude and may open paths to broader executive scope.`;
    } else {
      statement = `This opportunity maintains your current trajectory with potential for incremental scope growth. The career value lies in mandate consolidation rather than elevation.`;
    }

  } else if (trajectory === "BACKWARD" || valueScore < 50) {
    // Regression
    trajectoryCategory = "backward_regression";
    confidence = 0.7;

    statement = `The operating level and mandate scope sit below your established trajectory. This represents career regression that would narrow rather than expand your future optionality.`;

  } else {
    // Lateral / consolidation
    trajectoryCategory = "lateral_consolidation";
    confidence = 0.65;

    if (scopeExpansion.value >= 0.7 && commercialScale.value >= 0.7) {
      statement = `This appears largely lateral in title progression, but the underlying mandate may offer ${scopeInterpretation.interpretation.toLowerCase()} and ${commercialInterpretation.interpretation.toLowerCase()}. The career value depends on whether broader scope compensates for the lateral title.`;
    } else {
      statement = `This role represents lateral movement within your current operating level. The career value lies in mandate consolidation and ${scopeInterpretation.interpretation.toLowerCase()}, rather than trajectory elevation.`;
    }
  }

  return {
    statement,
    trajectoryCategory,
    dimensions: {
      title: titleInterpretation,
      scope: scopeInterpretation,
      commercial: commercialInterpretation,
      brand: brandInterpretation,
      optionality: optionalityInterpretation
    },
    evidence: evidence.slice(0, 5),
    confidence,
    valueScore
  };
}

/**
 * Interpret title progression dimension
 */
function interpretTitleProgression(
  title: { value: number; reason: string },
  role: string
): CareerValueInterpretation["dimensions"]["title"] {
  if (title.value >= 0.9) {
    return {
      interpretation: `Elevation to ${role} represents clear title progression toward executive leadership`,
      direction: "up"
    };
  } else if (title.value >= 0.7) {
    return {
      interpretation: `Lateral move at comparable executive level`,
      direction: "lateral"
    };
  } else if (title.value >= 0.3) {
    return {
      interpretation: `Title remains similar but mandate may offer scope variation`,
      direction: "lateral"
    };
  } else {
    return {
      interpretation: `Title regression from current executive standing`,
      direction: "down"
    };
  }
}

/**
 * Interpret scope expansion dimension
 */
function interpretScopeExpansion(
  scope: { value: number; reason: string }
): CareerValueInterpretation["dimensions"]["scope"] {
  if (scope.value >= 0.85) {
    return {
      interpretation: "Expanded executive scope with enterprise-wide responsibility",
      direction: "broader"
    };
  } else if (scope.value >= 0.7) {
    return {
      interpretation: "Broadened strategic scope with increased accountability",
      direction: "broader"
    };
  } else if (scope.value >= 0.5) {
    return {
      interpretation: "Comparable scope to current mandate",
      direction: "similar"
    };
  } else {
    return {
      interpretation: "Narrower scope focused on execution rather than strategy",
      direction: "narrower"
    };
  }
}

/**
 * Interpret commercial scale dimension
 */
function interpretCommercialScale(
  commercial: { value: number; reason: string }
): CareerValueInterpretation["dimensions"]["commercial"] {
  if (commercial.value >= 0.9) {
    return {
      interpretation: "Direct P&L ownership with full commercial accountability",
      direction: "greater"
    };
  } else if (commercial.value >= 0.75) {
    return {
      interpretation: "Budget ownership and portfolio-level commercial responsibility",
      direction: "greater"
    };
  } else if (commercial.value >= 0.5) {
    return {
      interpretation: "Commercial exposure within existing scope",
      direction: "similar"
    };
  } else {
    return {
      interpretation: "Limited commercial scope - cost center rather than P&L",
      direction: "lesser"
    };
  }
}

/**
 * Interpret brand signal dimension
 */
function interpretBrandSignal(
  brand: { value: number; reason: string },
  company: string
): CareerValueInterpretation["dimensions"]["brand"] {
  if (brand.value >= 0.9) {
    return {
      interpretation: `${company} represents a Tier-1 brand signal that significantly enhances career capital`,
      signal: "strong"
    };
  } else if (brand.value >= 0.75) {
    return {
      interpretation: `${company} offers strong employer reputation and market presence`,
      signal: "strong"
    };
  } else if (brand.value >= 0.5) {
    return {
      interpretation: `${company} provides moderate brand recognition`,
      signal: "moderate"
    };
  } else {
    return {
      interpretation: `Limited brand signal from ${company}`,
      signal: "weak"
    };
  }
}

/**
 * Interpret future optionality dimension
 */
function interpretFutureOptionality(
  optionality: { value: number; reason: string }
): CareerValueInterpretation["dimensions"]["optionality"] {
  if (optionality.value >= 0.9) {
    return {
      interpretation: "Clear path to broader executive roles including CEO/board consideration",
      outlook: "enhanced"
    };
  } else if (optionality.value >= 0.75) {
    return {
      interpretation: "Enhanced optionality through capability portability and seniority progression",
      outlook: "enhanced"
    };
  } else if (optionality.value >= 0.5) {
    return {
      interpretation: "Maintains current career optionality without significant expansion",
      outlook: "maintained"
    };
  } else {
    return {
      interpretation: "May limit immediate external optionality due to scope constraints",
      outlook: "reduced"
    };
  }
}

/**
 * Format career value for presentation
 */
export function formatCareerValue(careerValue: CareerValueInterpretation): string {
  return careerValue.statement;
}

/**
 * Get trajectory indicator for UI
 */
export function getTrajectoryIndicator(careerValue: CareerValueInterpretation): {
  label: string;
  color: "green" | "amber" | "red" | "neutral";
} {
  switch (careerValue.trajectoryCategory) {
    case "forward_progression":
      return { label: "Forward Progression", color: "green" };
    case "lateral_consolidation":
      return { label: "Lateral Consolidation", color: "amber" };
    case "backward_regression":
      return { label: "Career Regression", color: "red" };
    default:
      return { label: "Unclear Trajectory", color: "neutral" };
  }
}
