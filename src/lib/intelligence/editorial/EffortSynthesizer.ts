/**
 * EffortSynthesizer.ts
 *
 * P2-A.4: Pursuit Friction / Effort Interpretation
 *
 * Translates tailoringEffort (LOW/MODERATE/HIGH) and pursuitFriction into
 * executive-facing meaning about what it will take to pursue an opportunity.
 *
 * RADAR should explain:
 * - What kind of preparation is required
 * - How much time/headspace investment
 * - What gaps need bridging
 * - What validation is needed
 * - Whether the effort is justified by the potential outcome
 *
 * Do NOT merely say:
 * - "Tailoring effort: HIGH"
 * - "Pursuit friction: 15"
 *
 * Instead translate into executive action meaning:
 * - "Requires significant repositioning of your transformation narrative"
 * - "Validate P&L scope before investing time"
 * - "Prepare specific examples of commercial ownership"
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

export interface EffortInterpretation {
  /** The synthesized effort statement */
  statement: string;

  /** Effort level category */
  effortLevel: "low" | "moderate" | "high";

  /** Estimated time investment (executive-facing description) */
  timeEstimate: string;

  /** Specific preparation required */
  preparationRequired: string[];

  /** Validation needed before investment */
  validationNeeded?: string;

  /** Whether effort is justified by outcome */
  effortJustified: "yes" | "marginal" | "no" | "depends";

  /** Key friction points */
  frictionPoints: string[];

  /** Evidence grounding */
  evidence: string[];

  /** Confidence in interpretation */
  confidence: number;
}

/**
 * Synthesize effort interpretation from assessment outputs
 */
export function synthesizeEffort(
  record: RecommendationRecord,
  source: OpportunitySource
): EffortInterpretation {
  const evidence: string[] = [];
  const preparationRequired: string[] = [];
  const frictionPoints: string[] = [];

  // Extract pursuit friction from record
  const pursuitFriction = record.decisionSummary?.pursuitFriction ?? 0;
  const missingCapabilities = record.claimPermissions?.explicitUnknowns || [];

  // Categorize gaps by tier for specific guidance
  const coreGaps = missingCapabilities.filter(c => c.includes("[CORE_MANDATE]"));
  const executionGaps = missingCapabilities.filter(c => c.includes("[EXECUTION_CAPABILITY]"));
  const techGaps = missingCapabilities.filter(c => c.includes("[TECHNOLOGY_STACK]"));
  const domainGaps = missingCapabilities.filter(c => c.includes("[DOMAIN_FAMILIARITY]"));

  // Build friction points from gaps
  if (coreGaps.length > 0) {
    frictionPoints.push(`Core mandate gaps: ${coreGaps.length}`);
    evidence.push(`Missing core capabilities: ${coreGaps.map(g => g.replace(/\[.*?\]/g, "").trim()).join(", ")}`);
  }
  if (executionGaps.length > 0) {
    frictionPoints.push(`Execution capability gaps: ${executionGaps.length}`);
  }
  if (techGaps.length > 0) {
    frictionPoints.push(`Technology/tool gaps: ${techGaps.length}`);
  }
  if (domainGaps.length > 0) {
    frictionPoints.push(`Domain familiarity gaps: ${domainGaps.length}`);
  }

  // Determine effort level and build interpretation
  let effortLevel: EffortInterpretation["effortLevel"];
  let statement: string;
  let timeEstimate: string;
  let effortJustified: EffortInterpretation["effortJustified"];
  let validationNeeded: string | undefined;
  let confidence: number;

  if (pursuitFriction > 20) {
    // High effort scenario
    effortLevel = "high";
    confidence = 0.75;

    // Build specific guidance based on gap types
    if (coreGaps.length > 0) {
      preparationRequired.push("Reposition your narrative around transferable capabilities");
      preparationRequired.push("Prepare concrete examples of adjacent experience");
      preparationRequired.push("Develop a 90-day learning plan for core mandate requirements");
      statement = `Requires significant repositioning of your executive narrative and substantial preparation to bridge core mandate gaps. The effort is considerable but may be justified if the career trajectory value is compelling.`;
      effortJustified = "marginal";
      validationNeeded = "Confirm that scope flexibility and learning runway are genuinely available before investing significant preparation time";
    } else if (domainGaps.length > 0) {
      preparationRequired.push("Research industry-specific challenges and terminology");
      preparationRequired.push("Identify transferable patterns from your current domain");
      preparationRequired.push("Prepare domain adaptation narrative");
      statement = `Moderate-to-high effort required for domain repositioning. Focus preparation on demonstrating transferable strategic patterns rather than learning new tactics.`;
      effortJustified = "depends";
      validationNeeded = "Verify whether domain expertise is a hard requirement or if strategic transferability is valued";
    } else {
      preparationRequired.push("Tailor resume to emphasize relevant capabilities");
      preparationRequired.push("Prepare specific achievement examples");
      preparationRequired.push("Research company context and challenges");
      statement = `Standard high-investment preparation expected for executive-level opportunities. The effort aligns with typical pursuit requirements for this seniority.`;
      effortJustified = "yes";
    }

    timeEstimate = "8-12 hours over 1-2 weeks";

  } else if (pursuitFriction > 10) {
    // Moderate effort scenario
    effortLevel = "moderate";
    confidence = 0.8;

    if (executionGaps.length > 0 || techGaps.length > 0) {
      preparationRequired.push("Highlight adjacent tool/platform experience");
      preparationRequired.push("Prepare examples of tool-agnostic problem solving");
      statement = `Moderate preparation required to bridge execution-level gaps. Focus on demonstrating capability adaptability rather than specific tool expertise.`;
      effortJustified = "yes";
    } else {
      preparationRequired.push("Tailor application to highlight relevant achievements");
      preparationRequired.push("Prepare 2-3 specific examples for interview");
      statement = `Standard moderate preparation. Focus on positioning your existing capabilities within the specific context of this mandate.`;
      effortJustified = "yes";
    }

    timeEstimate = "4-6 hours over 3-5 days";

  } else {
    // Low effort scenario
    effortLevel = "low";
    confidence = 0.85;

    preparationRequired.push("Verify basic fit in initial conversation");
    preparationRequired.push("Prepare brief context-specific talking points");
    statement = `Low preparation burden. Your existing narrative aligns well with the stated requirements. Focus on validation rather than repositioning.`;
    effortJustified = "yes";

    timeEstimate = "2-3 hours over 1-2 days";
  }

  // Adjust based on decision verb
  if (record.verb === "PASS") {
    effortJustified = "no";
    statement += ` Given the PASS recommendation, preparation effort may not be warranted unless there are specific strategic reasons to pursue.`;
  } else if (record.verb === "CONSIDER") {
    validationNeeded = validationNeeded || "Validate key assumptions before significant investment";
  }

  // Add friction evidence
  if (pursuitFriction > 0) {
    evidence.push(`Pursuit friction score: ${pursuitFriction}`);
  }
  if (missingCapabilities.length > 0) {
    evidence.push(`${missingCapabilities.length} capability gaps identified`);
  }

  return {
    statement,
    effortLevel,
    timeEstimate,
    preparationRequired: preparationRequired.slice(0, 4),
    validationNeeded,
    effortJustified,
    frictionPoints: frictionPoints.slice(0, 3),
    evidence: evidence.slice(0, 4),
    confidence
  };
}

/**
 * Format effort for presentation
 */
export function formatEffort(effort: EffortInterpretation): string {
  return effort.statement;
}

/**
 * Format effort as actionable guidance
 */
export function formatEffortAction(effort: EffortInterpretation): string {
  const parts: string[] = [effort.statement];

  if (effort.timeEstimate) {
    parts.push(`Time estimate: ${effort.timeEstimate}.`);
  }

  if (effort.preparationRequired.length > 0) {
    parts.push("Preparation: " + effort.preparationRequired.join("; ") + ".");
  }

  if (effort.validationNeeded) {
    parts.push(`Validate: ${effort.validationNeeded}.`);
  }

  return parts.join(" ");
}

/**
 * Get effort indicator for UI
 */
export function getEffortIndicator(effort: EffortInterpretation): {
  label: string;
  color: "green" | "amber" | "red";
} {
  if (effort.effortLevel === "high") {
    return { label: "High Effort", color: "red" };
  } else if (effort.effortLevel === "moderate") {
    return { label: "Moderate Effort", color: "amber" };
  }
  return { label: "Low Effort", color: "green" };
}
