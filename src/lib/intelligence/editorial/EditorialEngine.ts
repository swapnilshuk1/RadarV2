// src/lib/intelligence/editorial/EditorialEngine.ts

import type { Opportunity } from "../../../data/opportunity-fixtures";

export type PrimaryFocus =
  | "CAREER_ACCELERATION"
  | "EXECUTION_READINESS"
  | "COMMERCIAL_SCOPE"
  | "LEADERSHIP_SCOPE"
  | "TRANSFORMATION"
  | "PRIMARY_RISK"
  | "UPSIDE"
  | "CRITICAL_UNKNOWN";

export type NarrativeBlueprint =
  | "CAREER_ASCENT"
  | "EXECUTION_HEAVY"
  | "HIGH_UNCERTAINTY"
  | "COMMERCIAL_LEAP";

export interface InformationBudget {
  maxHeadline: number;
  maxEvidence: number;
  maxUnknowns: number;
  maxRisks: number;
  maxActions: number;
}

export interface RankedUnknown {
  rank: "CRITICAL" | "IMPORTANT" | "SECONDARY";
  label: string;
  question: string;
}

export interface EditorialOutput {
  primaryFocus: PrimaryFocus;
  focusTitle: string;
  blueprint: NarrativeBlueprint;
  headline: string;
  memorableTakeaway: string; // The single memorable sentence that stays in executive memory
  frictionPreview?: string;
  topUnknownPreview?: string;
  first12MonthsWork: string[];
  expectedBusinessOutcomes: string[];
  whyWellSuited: string[];
  rankedUnknowns: RankedUnknown[];
  certaintyLevel: "HIGH" | "MEDIUM" | "LOW";
  certaintyGuidance: string;
}

export class EditorialEngine {
  private static readonly BUDGET: InformationBudget = {
    maxHeadline: 1,
    maxEvidence: 3,
    maxUnknowns: 3,
    maxRisks: 2,
    maxActions: 2,
  };

  /** Stage 1 & 2: Evaluate Decision & Select Primary Focus Deterministically */
  public static selectPrimaryFocus(
    opportunity: Opportunity,
    envelope?: any
  ): PrimaryFocus {
    const score = opportunity.recommendationResult?.score ?? 50;
    const role = (opportunity.role || "").toLowerCase();
    const positioning = (opportunity.positioning || []).join(" ").toLowerCase();

    if (positioning.includes("travel 50%") || positioning.includes("travel 60%") || positioning.includes("relocation")) {
      return "PRIMARY_RISK";
    }

    if (role.includes("transform") || role.includes("moderniz") || positioning.includes("transformation")) {
      return "TRANSFORMATION";
    }

    if (role.includes("commercial") || role.includes("growth") || role.includes("revenue") || role.includes("p&l")) {
      return "COMMERCIAL_SCOPE";
    }

    if (role.includes("director") || role.includes("vp") || role.includes("head") || role.includes("lead")) {
      return "LEADERSHIP_SCOPE";
    }

    if (score >= 75) {
      return "CAREER_ACCELERATION";
    }

    return "EXECUTION_READINESS";
  }

  /** Stage 3: Select Dynamic Narrative Blueprint for Section Re-orchestration */
  public static selectBlueprint(focus: PrimaryFocus, score: number): NarrativeBlueprint {
    if (focus === "PRIMARY_RISK" || focus === "CRITICAL_UNKNOWN" || score < 50) {
      return "HIGH_UNCERTAINTY";
    }
    if (focus === "COMMERCIAL_SCOPE" || focus === "LEADERSHIP_SCOPE") {
      return "COMMERCIAL_LEAP";
    }
    if (focus === "CAREER_ACCELERATION") {
      return "CAREER_ASCENT";
    }
    return "EXECUTION_HEAVY";
  }

  /** Stages 4, 5, 6: Apply Information Budget, Select Content & Format Presentation */
  public static process(
    opportunity: Opportunity,
    envelope?: any
  ): EditorialOutput {
    const focus = this.selectPrimaryFocus(opportunity, envelope);
    const score = opportunity.recommendationResult?.score ?? 50;
    const blueprint = this.selectBlueprint(focus, score);

    // 1. Headline & Memorable Takeaway Generation
    let headline = "";
    let focusTitle = "";
    let memorableTakeaway = "";

    switch (focus) {
      case "CAREER_ACCELERATION":
        focusTitle = "Career Acceleration";
        headline = `Strong career fit: Extends your strategic scope and team leadership at ${opportunity.company}.`;
        memorableTakeaway = "Essentially a CCO stepping-stone role with strong regional growth leverage.";
        break;
      case "COMMERCIAL_SCOPE":
        focusTitle = "Commercial Scale";
        headline = `Commercial alignment: Direct ownership over growth strategies and revenue execution.`;
        memorableTakeaway = "High-impact commercial scale role with direct P&L and revenue expansion accountability.";
        break;
      case "TRANSFORMATION":
        focusTitle = "Operating Transformation";
        headline = `Transformation focus: High-leverage opportunity to modernize operations and scale capability.`;
        memorableTakeaway = "Key operating transformation role — excellent leverage if you want to modernize core infrastructure.";
        break;
      case "LEADERSHIP_SCOPE":
        focusTitle = "Executive Leadership";
        headline = `Leadership alignment: Directly leverages your proven track record in multi-team management.`;
        memorableTakeaway = "Solid executive leadership mandate with established team oversight and clear organizational authority.";
        break;
      case "PRIMARY_RISK":
        focusTitle = "Key Operating Constraint";
        headline = `Substantial match with an explicit constraint: Significant travel or location requirement to evaluate.`;
        memorableTakeaway = "High-upside functional fit with one primary constraint: Travel requirement to verify.";
        break;
      case "CRITICAL_UNKNOWN":
        focusTitle = "Screening Priority";
        headline = `Strategic alignment with key unknown: Verify compensation and reporting hierarchy during initial screening.`;
        memorableTakeaway = "Strong capability fit with unstated compensation and reporting scope — verify during initial screening.";
        break;
      default:
        focusTitle = "Execution Capability";
        headline = `Solid execution fit: Direct application of your core functional competencies.`;
        memorableTakeaway = "Tactical execution fit with low tailoring overhead and high shortlisting probability.";
        break;
    }

    // 2. Friction Preview (Max 1)
    let frictionPreview: string | undefined = undefined;
    const reqs = opportunity.positioning || [];
    const travelReq = reqs.find((r: string) => r.toLowerCase().includes("travel"));
    if (travelReq) {
      frictionPreview = `Minor concern: ${travelReq}`;
    } else if (reqs.find((r: string) => r.toLowerCase().includes("on-site") || r.toLowerCase().includes("onsite"))) {
      frictionPreview = "Friction: On-site office requirement";
    }

    // 3. Top Unknown Preview & Ranked Unknowns
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
    ].slice(0, this.BUDGET.maxUnknowns);

    if (opportunity.dimensions.some((d) => d.key === "reportingLine" && d.bucket === "Missing")) {
      topUnknownPreview = "Unknown: Reporting line hierarchy";
    }

    // 4. Content Selection under Information Budget
    const first12MonthsWork = [
      `Establish functional operating model for ${opportunity.role} at ${opportunity.company}.`,
      `Modernize core processes across target regional markets.`,
      `Build and mentor high-performing execution teams.`,
    ].slice(0, this.BUDGET.maxEvidence);

    const expectedBusinessOutcomes = [
      `Accelerate revenue growth and strategic positioning.`,
      `Optimize operational expenditure and delivery velocity.`,
      `Expand organizational scalability and platform maturity.`,
    ].slice(0, this.BUDGET.maxEvidence);

    const whyWellSuited = [
      `✓ Proven track record in ${opportunity.role.toLowerCase().includes("marketing") ? "Growth Marketing & CRM Strategy" : "Digital Transformation & Technology Leadership"}.`,
      `✓ Demonstrated capability managing multi-million budgets and multi-disciplinary teams.`,
      `✓ Prior experience scaling enterprise operations across global or regional hubs.`,
    ].slice(0, this.BUDGET.maxEvidence);

    // 5. Actionable Certainty Level
    let certaintyLevel: "HIGH" | "MEDIUM" | "LOW" = "HIGH";
    let certaintyGuidance = "Strong evidence across candidate memory and job description.";
    if (score < 50) {
      certaintyLevel = "LOW";
      certaintyGuidance = "Several critical requirements were not explicitly described. Verify during screening.";
    } else if (topUnknownPreview || frictionPreview) {
      certaintyLevel = "MEDIUM";
      certaintyGuidance = "Solid functional alignment. Verify reporting line and travel requirements during screening.";
    }

    return {
      primaryFocus: focus,
      focusTitle,
      blueprint,
      headline,
      memorableTakeaway,
      frictionPreview,
      topUnknownPreview,
      first12MonthsWork,
      expectedBusinessOutcomes,
      whyWellSuited,
      rankedUnknowns,
      certaintyLevel,
      certaintyGuidance,
    };
  }
}
