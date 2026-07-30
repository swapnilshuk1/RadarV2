// src/lib/intelligence/editorial/BriefCompositionEngine.ts

import type { Opportunity } from "../../../data/opportunity-fixtures";
import type { CompositionPolicy } from "./CompositionPolicy";
import { DEFAULT_COMPOSITION_POLICY } from "./CompositionPolicy";
import type {
  BriefModel,
  FocusWeights,
  FocusArea,
  BriefStrategy,
  BriefMemory,
  RankedUnknown,
} from "./BriefModel";

export class BriefCompositionEngine {
  /**
   * Calculates continuous focus weights from opportunity metrics and positioning signals.
   */
  public static calculateWeights(opportunity: Opportunity): FocusWeights {
    const score = opportunity.recommendationResult?.score ?? 50;
    const role = (opportunity.role || "").toLowerCase();
    const positioning = (opportunity.positioning || []).join(" ").toLowerCase();

    let career = score >= 75 ? 0.85 : 0.45;
    let execution = 0.5;
    let commercial = 0.4;
    let risk = 0.2;
    let unknown = 0.3;

    if (positioning.includes("travel 50%") || positioning.includes("travel 60%") || positioning.includes("relocation")) {
      risk = 0.88;
    }

    if (role.includes("commercial") || role.includes("growth") || role.includes("revenue") || role.includes("p&l")) {
      commercial = 0.92;
    }

    if (role.includes("transform") || role.includes("moderniz") || positioning.includes("transformation")) {
      career = 0.88;
      execution = 0.75;
    }

    if (opportunity.dimensions.some((d) => d.key === "reportingLine" && d.bucket === "Missing")) {
      unknown = 0.82;
    }

    const confidence = Math.min(0.95, 0.7 + (score / 100) * 0.25);

    return { career, execution, commercial, risk, unknown, confidence };
  }

  /**
   * Selects the BriefStrategy based on continuous FocusWeights.
   */
  public static deriveStrategy(
    weights: FocusWeights,
    opportunity: Opportunity
  ): BriefStrategy {
    const score = opportunity.recommendationResult?.score ?? 50;

    const sorted = Object.entries(weights)
      .filter(([k]) => k !== "confidence")
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .map(([key]) => key.toUpperCase() as FocusArea);

    const primaryFocus = sorted[0] || "CAREER";
    const secondaryFocus = sorted[1] || "EXECUTION";
    const tertiaryFocus = sorted[2] || "COMMERCIAL";

    let focusTitle = "Career Acceleration";
    let heroAnchor = `Essentially a CCO stepping-stone role with regional growth ownership at ${opportunity.company}.`;

    if (primaryFocus === "COMMERCIAL") {
      focusTitle = "Commercial Scale";
      heroAnchor = `High-impact commercial scale role with direct P&L and revenue expansion accountability at ${opportunity.company}.`;
    } else if (primaryFocus === "RISK" || primaryFocus === "UNKNOWN") {
      focusTitle = "Key Operating Constraint";
      heroAnchor = `Strong capability fit with unstated compensation or reporting scope — verify during initial screening.`;
    } else if (primaryFocus === "EXECUTION") {
      focusTitle = "Execution Capability";
      heroAnchor = `Tactical execution fit with low tailoring overhead and high shortlisting probability at ${opportunity.company}.`;
    }

    // Semantic intent for capability narrative
    let intent: BriefStrategy["narrative"]["intent"] = "CAPABILITY_FIT";
    if (score >= 85) {
      intent = "COMPETITIVE_ADVANTAGE";
    } else if (primaryFocus === "CAREER" || primaryFocus === "COMMERCIAL") {
      intent = "LEVERAGE_POINT";
    }

    return {
      primaryFocus,
      secondaryFocus,
      tertiaryFocus,
      focusTitle,
      heroAnchor,
      narrative: {
        intent,
        strengthCount: 3,
      },
    };
  }

  /**
   * Pure Composition Function: Emits a semantic UI-agnostic BriefModel.
   */
  public static compose(
    opportunity: Opportunity,
    policy: CompositionPolicy = DEFAULT_COMPOSITION_POLICY
  ): BriefModel {
    const score = opportunity.recommendationResult?.score ?? 50;
    const certaintyPct = Math.min(95, Math.max(60, score + 5));
    const weights = this.calculateWeights(opportunity);
    const strategy = this.deriveStrategy(weights, opportunity);

    const decision: BriefMemory["decision"] =
      opportunity.decision === "PURSUE" || score >= 75
        ? "PURSUE"
        : opportunity.decision === "CONSIDER" || score >= 50
        ? "CONSIDER"
        : "PASS";

    const retentionSentence =
      strategy.primaryFocus === "COMMERCIAL"
        ? `High-impact commercial scale role with direct P&L accountability.`
        : strategy.primaryFocus === "RISK"
        ? `Solid functional alignment with unstated travel or location requirements.`
        : `Essentially a CCO stepping-stone role with strong regional growth leverage.`;

    const primaryOpportunity =
      strategy.primaryFocus === "COMMERCIAL"
        ? "Direct P&L and revenue scale expansion"
        : strategy.primaryFocus === "CAREER"
        ? "Scope elevation to VP/CXO altitude"
        : "Proven functional alignment with low application overhead";

    const primaryRisk =
      weights.unknown > 0.6
        ? "Reporting line hierarchy unstated"
        : weights.risk > 0.6
        ? "Travel commitment or location constraints"
        : "Minor team size regression";

    const recommendedAction =
      decision === "PURSUE"
        ? "PURSUE — Submit direct application (20 mins)"
        : decision === "CONSIDER"
        ? "CONSIDER — Verify reporting line before applying"
        : "PASS — Maintain focus on top-tier mandates";

    const tradeoff =
      strategy.primaryFocus === "CAREER"
        ? "Smaller team span (-15%) for direct Board & C-suite visibility"
        : strategy.primaryFocus === "COMMERCIAL"
        ? "Higher travel commitment for $50M direct P&L ownership"
        : "Lateral functional scope for immediate regional growth leverage";

    const first90Days =
      strategy.primaryFocus === "COMMERCIAL"
        ? "Restructure performance-marketing agency roster & optimize ROAS before Q2 campaign launch"
        : strategy.primaryFocus === "CAREER"
        ? "Build executive alignment on regional digital-transformation roadmap with BU leaders"
        : "Audit existing MarTech stack & establish lead attribution baseline within first 60 days";

    const whyNow =
      strategy.primaryFocus === "CAREER"
        ? "Company entering $50M regional expansion phase following CEO hire"
        : strategy.primaryFocus === "COMMERCIAL"
        ? "Recent Series B funding round driving aggressive go-to-market scaling"
        : "Post-reorganization transformation mandate approved by Board";

    const memory: BriefMemory = {
      headline: `${decision}: ${opportunity.role} at ${opportunity.company}`,
      retentionSentence,
      primaryOpportunity,
      primaryRisk,
      recommendedAction,
      decision,
      tradeoff,
      first90Days,
      whyNow,
    };

    const headline = `${strategy.focusTitle}: ${strategy.heroAnchor}`;

    let frictionPreview: string | undefined = undefined;
    const reqs = opportunity.positioning || [];
    const travelReq = reqs.find((r: string) => r.toLowerCase().includes("travel"));
    if (travelReq) {
      frictionPreview = `Minor concern: ${travelReq}`;
    }

    let topUnknownPreview: string | undefined = "Critical Unknown: Compensation target not disclosed";
    const rankedUnknowns: RankedUnknown[] = [
      {
        rank: "CRITICAL" as const,
        label: "Compensation Target",
        question: "What is the exact base, variable, and equity structure for this role?",
      },
      {
        rank: "IMPORTANT" as const,
        label: "Reporting Line Hierarchy",
        question: "Does this role report directly to the CEO, C-suite, or Regional VP?",
      },
      {
        rank: "SECONDARY" as const,
        label: "Team Scale & Resources",
        question: "What is the current headcount and approved hiring headcount for the next 12 months?",
      },
    ].slice(0, policy.maxUnknowns);

    if (opportunity.dimensions.some((d) => d.key === "reportingLine" && d.bucket === "Missing")) {
      topUnknownPreview = "Unknown: Reporting line hierarchy";
    }

    const deliverablesWork = [
      `Establish functional operating model for ${opportunity.role} at ${opportunity.company}.`,
      `Modernize core processes across target regional markets.`,
      `Build and mentor high-performing execution teams.`,
    ].slice(0, policy.maxEvidence);

    const deliverablesValue = [
      `Accelerate revenue growth and strategic positioning.`,
      `Optimize operational expenditure and delivery velocity.`,
      `Expand organizational scalability and platform maturity.`,
    ].slice(0, policy.maxEvidence);

    const fitProofs = [
      `Proven track record in ${opportunity.role.toLowerCase().includes("marketing") ? "Growth Marketing & CRM Strategy" : "Digital Transformation & Technology Leadership"}.`,
      `Demonstrated capability managing multi-million budgets and multi-disciplinary teams.`,
      `Prior experience scaling enterprise operations across global or regional hubs.`,
    ].slice(0, policy.maxEvidence);

    let certaintyLevel: BriefModel["certaintyLevel"] = "HIGH";
    let certaintyGuidance = "Strong evidence across candidate memory and job description.";
    if (score < 50) {
      certaintyLevel = "LOW";
      certaintyGuidance = "Several critical requirements were not explicitly described. Verify during screening.";
    } else if (topUnknownPreview || frictionPreview) {
      certaintyLevel = "MEDIUM";
      certaintyGuidance = "Solid functional alignment. Verify reporting line and travel requirements during screening.";
    }

    return {
      opportunityId: opportunity.jobHash,
      score,
      certaintyPct,
      strategy,
      weights,
      memory,
      headline,
      frictionPreview,
      topUnknownPreview,
      deliverablesWork,
      deliverablesValue,
      fitProofs,
      rankedUnknowns,
      certaintyLevel,
      certaintyGuidance,
    };
  }
}
