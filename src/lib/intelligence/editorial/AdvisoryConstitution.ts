/**
 * AdvisoryConstitution.ts
 * Executable Code Representation of RADAR v2 Executive Advisory Philosophy.
 */

export interface AdvisoryRuleCheck {
  ruleId: string;
  passed: boolean;
  reason: string;
}

export type EditorialEvidenceState = "EVALUATED" | "SPARSE_SPEC" | "UNEVALUATED" | "UNAVAILABLE";

export interface EditorialSufficiency {
  readonly state: EditorialEvidenceState;
  readonly isSufficient: boolean;
  readonly message?: string;
}

type EditorialInput = {
  role?: unknown;
  canonicalTitle?: unknown;
  company?: unknown;
  companyName?: unknown;
  description?: unknown;
  normalizedText?: unknown;
  rawText?: unknown;
  rawDescription?: unknown;
  dimensions?: unknown;
  engineRecommendation?: unknown;
  recommendationResult?: unknown;
  evaluationState?: unknown;
  decision?: unknown;
};

import {
  isMeaningfulEvidenceQuote,
  MANDATE_BEARING_DIMENSION_KEYS,
  isMandateBearingDimensionKey,
} from "@/domain/evidence";

export {
  isMeaningfulEvidenceQuote,
  MANDATE_BEARING_DIMENSION_KEYS,
  isMandateBearingDimensionKey,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export class AdvisoryConstitution {
  
  public static readonly PRINCIPLES = {
    NEVER_EXPOSE_INTERNAL_REASONING: "The UI consumes conclusions, strategic context, and trusted advisory guidance—never raw scores, deltas, or proof graphs.",
    NEVER_FABRICATE_CERTAINTY: "Executive advisors optimize for credibility over completeness. RADAR never fabricates certainty on unproven grounds.",
    PROHIBIT_SYNTHESIS_ON_LOW_EVIDENCE: "Editorial synthesis is prohibited when minimum evidence quality is not achieved (INV-DATA-SUFFICIENCY).",
    REQUIRE_SUPPORTING_EVIDENCE_FOR_CLAIMS: "Every editorial claim must be grounded in verified candidate or job description evidence.",
    RECOMMENDATION_MUST_END_WITH_ACTION: "Recommendations must end with a clear, actionable next step for the executive.",
    LOW_INFO_PRODUCES_HUMBLE_OUTPUTS: "When job data is sparse or truncated, outputs must state data limitations cleanly rather than guessing.",
    OPTIMIZE_DECISION_QUALITY_OVER_ENGAGEMENT: "Measure product success by decision quality (Viewed ➔ Pursued ➔ Interviewed ➔ Offered), not Daily Active Users."
  };

  /**
   * Enforces INV-DATA-SUFFICIENCY: Prohibits high-confidence editorial synthesis on low-evidence inputs.
   */
  public static validateDataSufficiency(opportunity: unknown): EditorialSufficiency {
    const input = asRecord(opportunity) as EditorialInput | null;
    if (!input || !(asText(input.role) || asText(input.canonicalTitle)) || !(asText(input.company) || asText(input.companyName))) {
      return {
        state: "UNAVAILABLE",
        isSufficient: false,
        message: "The opportunity record is incomplete and cannot support an executive brief."
      };
    }

    const declaredState = asText(input.evaluationState);
    if (declaredState === "SPARSE_SPEC" || input.decision === "SPARSE_SPEC") {
      return {
        state: "SPARSE_SPEC",
        isSufficient: false,
        message: "The published role specification is sparse. Confirm the mandate, reporting line, and decision rights during the initial recruiter conversation."
      };
    }

    const text = asText(input.description) || asText(input.normalizedText) || asText(input.rawText) || asText(input.rawDescription);
    const dimensions = Array.isArray(input.dimensions) ? input.dimensions : [];

    const hasExplicitMeaningfulEvidence = (record: Record<string, unknown> | null): boolean => {
      if (!record) return false;
      const evidence = asRecord(record.jdEvidence);
      if (evidence?.status !== "Explicit") return false;
      const quotes = Array.isArray(evidence.evidence)
        ? (evidence.evidence as unknown[]).map((e) => asRecord(e)?.quote).filter(isMeaningfulEvidenceQuote)
        : [];
      const singleQuote = typeof evidence.quote === "string" && isMeaningfulEvidenceQuote(evidence.quote);
      return quotes.length > 0 || singleQuote;
    };

    const explicitEvidenceCount = dimensions.filter((dimension) => {
      const record = asRecord(dimension);
      return hasExplicitMeaningfulEvidence(record);
    }).length;

    const hasMandateBearingEvidence = dimensions.some((dimension) => {
      const record = asRecord(dimension);
      const key = asText(record?.key);
      return isMandateBearingDimensionKey(key) && hasExplicitMeaningfulEvidence(record);
    });

    const hasEvaluation = Boolean(input.engineRecommendation || input.recommendationResult);

    if (text.length >= 200 || (hasEvaluation && hasMandateBearingEvidence)) {
      return { state: "EVALUATED", isSufficient: true };
    }

    if (hasEvaluation || explicitEvidenceCount > 0 || text.length > 0) {
      return {
        state: "SPARSE_SPEC",
        isSufficient: false,
        message: "The available job description does not provide enough evidence to determine why the role exists. This is a useful topic to explore during the initial recruiter conversation."
      };
    }

    return {
      state: "UNEVALUATED",
      isSufficient: false,
      message: "No evaluated evidence is available yet. Complete the structured evaluation before drawing conclusions about the role."
    };
  }

  /**
   * Translates organizational intent and job parameters into a highly tailored, non-repetitive corporate-driver paragraph.
   */
  public static getWhyThisRoleExistsParagraph(opportunity: unknown, jobProj: unknown, focusTopic: string): string {
    const input = asRecord(opportunity) as EditorialInput | null;
    const projection = asRecord(jobProj);
    const company = asText(projection?.company) || asText(input?.company) || asText(input?.companyName) || "the company";
    const role = asText(projection?.role) || asText(input?.role) || asText(input?.canonicalTitle) || "this role";
    const topic = focusTopic || "commercial growth & market expansion";

    const sufficiency = this.validateDataSufficiency(opportunity);
    if (!sufficiency.isSufficient) {
      return `Published details for the ${role} seat at ${company} are limited. Confirm the ${topic} mandate, reporting line, team scope, and decision rights during the initial recruiter conversation.`;
    }

    return `The published description identifies a ${topic} focus for the ${role} seat at ${company}. Use the recruiter conversation to validate the operating mandate, reporting line, and resources behind that description.`;
  }
}
