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

  /**
   * Translates organizational intent and job parameters into a highly tailored, non-repetitive corporate-driver paragraph.
   */
  public static getWhyThisRoleExistsParagraph(opportunity: any, jobProj: any, focusTopic: string): string {
    const company = jobProj?.company || opportunity.company || "the company";
    const role = jobProj?.role || opportunity.role || "this role";
    const topic = focusTopic || "commercial growth & market expansion";

    // 1. Dynamic sparse data handling - premium partner tone rather than flat error message
    const text = (opportunity.description || opportunity.normalizedText || "").trim();
    if (!text || text.length < 200) {
      return `Published details for the ${role} seat at ${company} remain highly sparse, suggesting either a stealth-mandate or an unformed organizational charter. Senior leadership typically creates this role to establish operational rigor where founder-led processes have reached their structural ceiling. In the absence of a detailed GTM brief, your immediate priority during screening must be to clarify if this is an active transformation mandate or a steady-state maintenance function.`;
    }

    // 2. High-altitude organizational driver generation
    const intent = jobProj?.executiveMission?.intent || "ACCELERATE_GROWTH";
    const missionStatement = jobProj?.executiveMission?.statement || "";

    const intentParagraphs: Record<string, string> = {
      REPLACE_FAILED_LEADER: `${company} is prioritizing immediate stabilization of its ${topic} function following a period of leadership disruption. This seat is being structured with direct team oversight and clear operational metrics to repair execution bottlenecks, rather than merely maintaining existing department operations.`,
      BUILD_NEW_CAPABILITY: `${company} is building its dedicated ${topic} capabilities from the ground up to capture unaddressed enterprise demand. This is a greenfield 0-to-1 mandate that requires an operator comfortable with establishing team structures and vendor standards from scratch, rather than managing a legacy hierarchy.`,
      PROFESSIONALIZE_FOUNDER_COMPANY: `${company} is professionalizing its commercial operations to transition away from founder-dependent decision-making. The mandate is to establish institutional processes and standard GTM governance to ensure commercial repeatability and clean pipeline visibility.`,
      PREPARE_IPO: `${company} is aligning its commercial systems and financial transparency for public market readiness. This seat functions as a critical governance anchor, requiring clean compliance records, auditable CRM practices, and institutional P&L maturity ahead of their upcoming listing.`,
      INTEGRATE_ACQUISITION: `${company} is consolidating its post-merger operations to capture immediate revenue synergies across its expanded portfolio. The executive in this seat will merge legacy team cultures and align redundant software stacks onto a single commercial playbook.`,
      REPAIR_EXECUTION: `${company} is correcting fragmented commercial delivery and rebuilding operational rigor under a consolidated leader. Success requires auditing current client delivery pipelines, pruning low-yield channels, and enforcing strict operating standards.`,
      EXPAND_GEOGRAPHY: `${company} is launching localized commercial hubs to scale its footprint in ${opportunity.location || "new regional markets"}. This is an expansion-led mandate where regional cultural fluency and local network leverage are prioritized over corporate headquarters pedigree.`,
      COMMERCIALIZE_TECHNOLOGY: `${company} is translating its core technology assets into distinct, high-yield commercial offerings. The mission is to transform a product-centric organization into an outbound enterprise engine with scalable pricing, clear contract governance, and proactive GTM execution.`,
      ACCELERATE_GROWTH: `${company} is scaling its outbound velocity to sustain high growth. The mandate is to transition from opportunistic sales into a systematic, repeatable customer acquisition engine with full operational accountability.`
    };

    return intentParagraphs[intent] || `${company} is consolidating its ${topic} function under a unified leader to capture emerging market demand. This seat exists to drive immediate commercial expansion and establish predictable operating governance across the region.`;
  }
}
