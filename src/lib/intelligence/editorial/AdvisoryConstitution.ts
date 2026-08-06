/**
 * AdvisoryConstitution.ts
 * Executable Code Representation of RADAR v2 Executive Advisory Philosophy.
 */

export interface AdvisoryRuleCheck {
  ruleId: string;
  passed: boolean;
  reason: string;
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
  public static validateDataSufficiency(opportunity: any): { isSufficient: boolean; message?: string } {
    const text = (opportunity.description || opportunity.normalizedText || "").trim();
    
    // Prohibit synthesis on JDs with fewer than 200 characters or missing description
    if (!text || text.length < 200) {
      return {
        isSufficient: false,
        message: "The available job description does not provide enough evidence to determine why the role exists. This is a useful topic to explore during the initial recruiter conversation."
      };
    }

    return { isSufficient: true };
  }
}
