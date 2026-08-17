import type { EditorialContext } from "./EditorialContext";
import type { ExecutiveDecisionExplanation } from "./ExecutiveDecisionExplanation";
import type {
  PursuitStrategy,
  EffortLevel,
  PursuitMode,
  TailoringDepth,
  StrategyRuleId,
  PursuitAction,
  PursuitStrategyProvenance,
} from "./PursuitStrategy";

export class PursuitStrategyResolver {
  /**
   * Pure deterministic resolver of PursuitStrategy.
   *
   * CONSTITUTIONAL INVARIANTS:
   * 1. Consumes ONLY ExecutiveDecisionExplanation and explicitly declared EditorialContext.
   * 2. Zero raw score threshold calculations (qualityScore >= 75 forbidden).
   * 3. Cannot mutate or override engineVerdict.
   * 4. User decisions (e.g. userDecision === PURSUE) must NEVER alter pursuit strategy.
   * 5. Follows strict Precedence Matrix P0 -> P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7 -> P8.
   */
  public static resolve(
    explanation: ExecutiveDecisionExplanation,
    context: EditorialContext
  ): PursuitStrategy {
    const verdict = explanation.verdict;
    const ruleIds = explanation.ruleIds || [];
    const contextRuleIds = context.careerValue?.triggeredRuleIds || [];
    const headline = explanation.headline;
    const bottomLine = explanation.bottomLine;

    // -------------------------------------------------------------
    // P0 — Invalid / Unevaluated
    // -------------------------------------------------------------
    if (!verdict) {
      const actions: PursuitAction[] = [
        {
          type: "INVESTIGATE_ROLE",
          priority: "PRIMARY",
          label: "Await full mandate evaluation",
          rationale: "Structured signals are pending or incomplete.",
        },
      ];
      return {
        engineVerdict: null,
        effortLevel: "INVESTIGATE_FIRST",
        pursuitMode: "INVESTIGATE_THEN_DECIDE",
        tailoringDepth: "NONE",
        ruleId: "EVALUATION_INCOMPLETE",
        executiveLabel: "Investigate before investing",
        headline,
        bottomLine,
        whyThisEffortLevel: "RADAR does not yet have enough structured evaluation to justify application effort.",
        immediateNextAction: "Complete automated evaluation before allocating candidate preparation bandwidth.",
        actions,
        keyDependency: "Decision Policy Engine evaluation completion.",
        stopCondition: "Do not proceed with application preparation until full mandate evaluation is complete.",
        provenance: [
          {
            source: "DECISION_EXPLANATION",
            ruleId: "EVALUATION_INCOMPLETE",
            signal: "VERDICT_NULL",
          },
        ],
      };
    }

    // -------------------------------------------------------------
    // P1 — PASS (Zero application investment permitted)
    // -------------------------------------------------------------
    if (verdict === "PASS") {
      const actions: PursuitAction[] = [
        {
          type: "PASS",
          priority: "PRIMARY",
          label: "Pass on opportunity",
          rationale: "Structural mismatch from executive criteria.",
        },
      ];
      return {
        engineVerdict: "PASS",
        effortLevel: "DO_NOT_INVEST",
        pursuitMode: "PASS",
        tailoringDepth: "NONE",
        ruleId: "PASS_NO_INVESTMENT",
        executiveLabel: "Move on",
        headline,
        bottomLine,
        whyThisEffortLevel: "Strategic pass: Operating altitude or role scoping represents a structural mismatch from your executive baseline.",
        immediateNextAction: "Do not invest application or networking effort in this opportunity.",
        actions,
        stopCondition: "Do not invest application or networking effort in this opportunity.",
        provenance: [
          {
            source: "DECISION_EXPLANATION",
            ruleId: "PASS_NO_INVESTMENT",
            signal: "STRATEGIC_PASS",
          },
        ],
      };
    }

    // -------------------------------------------------------------
    // P2 — Material Career Regression / Protection
    // (Outranks capability strength, evidence strength, and ordinary PURSUE/CONSIDER)
    // -------------------------------------------------------------
    const isCareerRegression =
      explanation.careerValueSignal === "CAREER REGRESSION / PROTECTION" ||
      explanation.careerValueSignal === "SUB-TIER MANDATE" ||
      context.careerValue?.careerValueProtection === "DOWNSCALED" ||
      context.careerValue?.trajectoryUpside === "REGRESSION" ||
      context.careerValue?.trajectoryUpside === "Career Regression" ||
      ruleIds.includes("G-SUB-TIER-MANDATE-VETO") ||
      contextRuleIds.includes("G-SUB-TIER-MANDATE-VETO");

    if (isCareerRegression) {
      const actions: PursuitAction[] = [
        {
          type: "CLARIFY_SCOPE",
          priority: "PRIMARY",
          label: "Clarify operating scope and decision rights",
          rationale: "Prevent downscaling into sub-tier or execution-heavy remit.",
        },
        {
          type: "VERIFY_REPORTING_LINE",
          priority: "SECONDARY",
          label: "Verify reporting line and governance altitude",
          rationale: "Confirm board or CXO proximity.",
        },
      ];
      return {
        engineVerdict: verdict,
        effortLevel: "LIGHT",
        pursuitMode: "CLARIFY_SCOPE",
        tailoringDepth: "NONE",
        ruleId: "CAREER_REGRESSION_SCOPE_CHECK",
        executiveLabel: "Worth limited effort",
        headline,
        bottomLine,
        whyThisEffortLevel: "Accessible role, but with material career regression: Operating scope appears below your current executive trajectory.",
        immediateNextAction: "Verify actual operating altitude, mandate, decision rights and trajectory before investing application effort.",
        actions,
        keyDependency: "Clarification of executive decision rights and direct reporting line.",
        stopCondition: "Do not proceed to application tailoring unless confirmed role scope proves materially broader than current specification.",
        provenance: [
          {
            source: "CAREER_POLICY",
            ruleId: "CAREER_REGRESSION_SCOPE_CHECK",
            signal: "CAREER_REGRESSION_DETECTED",
          },
        ],
      };
    }

    // -------------------------------------------------------------
    // P3 — Material Uncertainty / Sparse Specification
    // (Outranks ordinary PURSUE/CONSIDER tailoring recommendations)
    // -------------------------------------------------------------
    const isSparseSpec =
      explanation.evidenceStrength === "INSUFFICIENT" ||
      explanation.primaryReason.includes("Sparse specification") ||
      ruleIds.includes("SPARSE_SPECIFICATION");

    if (isSparseSpec) {
      const actions: PursuitAction[] = [
        {
          type: "INVESTIGATE_ROLE",
          priority: "PRIMARY",
          label: "Verify core mandate specification",
          rationale: "JD provides limited explicit evidence regarding reporting line and P&L governance.",
        },
      ];
      return {
        engineVerdict: verdict,
        effortLevel: "INVESTIGATE_FIRST",
        pursuitMode: "INVESTIGATE_THEN_DECIDE",
        tailoringDepth: "NONE",
        ruleId: "SPARSE_SPECIFICATION_INVESTIGATION",
        executiveLabel: "Investigate before investing",
        headline,
        bottomLine,
        whyThisEffortLevel: "Opportunity specification lacks detailed mandate data for conclusive evaluation.",
        immediateNextAction: "Gather core role facts and verify reporting line before resume tailoring.",
        actions,
        keyDependency: "Receipt of authoritative job description or recruiter confirmation of core mandate.",
        stopCondition: "Stop investing application effort if the confirmed mandate is materially below target executive operating altitude.",
        provenance: [
          {
            source: "EVIDENCE_GATE",
            ruleId: "SPARSE_SPECIFICATION_INVESTIGATION",
            signal: "SPARSE_SPECIFICATION",
          },
        ],
      };
    }

    if (explanation.keyUncertainty != null) {
      const actions: PursuitAction[] = [
        {
          type: "INVESTIGATE_ROLE",
          priority: "PRIMARY",
          label: "Investigate key unknown",
          rationale: explanation.keyUncertainty,
        },
      ];
      return {
        engineVerdict: verdict,
        effortLevel: "INVESTIGATE_FIRST",
        pursuitMode: "INVESTIGATE_THEN_DECIDE",
        tailoringDepth: "NONE",
        ruleId: "MATERIAL_UNCERTAINTY_INVESTIGATION",
        executiveLabel: "Investigate before investing",
        headline,
        bottomLine,
        whyThisEffortLevel: explanation.keyUncertainty,
        immediateNextAction: `Investigate: ${explanation.keyUncertainty}`,
        actions,
        keyDependency: `Resolution of key uncertainty: ${explanation.keyUncertainty}`,
        stopCondition: "Stop investing application effort if the confirmed mandate is materially below target executive operating altitude.",
        provenance: [
          {
            source: "UNCERTAINTY_SIGNAL",
            ruleId: "MATERIAL_UNCERTAINTY_INVESTIGATION",
            signal: explanation.keyUncertainty,
          },
        ],
      };
    }

    // -------------------------------------------------------------
    // P4 — PURSUE + Strong Evidence + Strong Career Case
    // -------------------------------------------------------------
    if (verdict === "PURSUE" && explanation.evidenceStrength === "STRONG") {
      const actions: PursuitAction[] = [
        {
          type: "TAILOR_RESUME",
          priority: "PRIMARY",
          label: "Deeply tailor executive resume",
          rationale: "Focus on verified commercial transformation and P&L scale.",
          estimatedEffort: "45-60 mins",
        },
        {
          type: "TAILOR_LINKEDIN",
          priority: "SECONDARY",
          label: "Align LinkedIn executive headline",
          rationale: "Emphasize authoritative enterprise leadership.",
          estimatedEffort: "15 mins",
        },
        {
          type: "PREPARE_INTERVIEW",
          priority: "SECONDARY",
          label: "Prepare 90-day executive operating plan",
          rationale: "Align on initial commercial priorities and board deliverables.",
          estimatedEffort: "60 mins",
        },
        {
          type: "DIRECT_APPLICATION",
          priority: "SECONDARY",
          label: "Submit direct application",
          rationale: "High fit clears all RADAR qualification thresholds.",
          estimatedEffort: "10 mins",
        },
      ];
      return {
        engineVerdict: "PURSUE",
        effortLevel: "DEEP",
        pursuitMode: "TAILOR_THEN_APPLY",
        tailoringDepth: "DEEP",
        ruleId: "PURSUE_DEEP_STRONG_EVIDENCE",
        executiveLabel: "Worth serious pursuit",
        headline,
        bottomLine,
        whyThisEffortLevel: "High-conviction alignment: Strong commercial transformation mandate with substantial career upside and verified evidence.",
        immediateNextAction: "Tailor executive resume and LinkedIn positioning around verified transformation accomplishments, then apply direct.",
        actions,
        stopCondition: "Stop tailoring once all material role requirements are addressed using verified candidate evidence.",
        provenance: [
          {
            source: "DECISION_EXPLANATION",
            ruleId: "PURSUE_DEEP_STRONG_EVIDENCE",
            signal: "HIGH_CONVICTION_STRONG_EVIDENCE",
          },
        ],
      };
    }

    // -------------------------------------------------------------
    // P5 — PURSUE + Moderate Evidence
    // -------------------------------------------------------------
    if (verdict === "PURSUE" && explanation.evidenceStrength === "MODERATE") {
      const actions: PursuitAction[] = [
        {
          type: "TAILOR_RESUME",
          priority: "PRIMARY",
          label: "Targeted resume tailoring",
          rationale: "Highlight verified domain competencies without over-tailoring.",
          estimatedEffort: "25-30 mins",
        },
        {
          type: "DIRECT_APPLICATION",
          priority: "SECONDARY",
          label: "Submit application",
          rationale: "Strong executive fit warrants application.",
          estimatedEffort: "10 mins",
        },
      ];
      return {
        engineVerdict: "PURSUE",
        effortLevel: "TARGETED",
        pursuitMode: "TAILOR_THEN_APPLY",
        tailoringDepth: "TARGETED",
        ruleId: "PURSUE_TARGETED_MODERATE_EVIDENCE",
        executiveLabel: "Worth a focused application",
        headline,
        bottomLine,
        whyThisEffortLevel: "Opportunity warrants pursuit, but effort should remain concentrated strictly on verified core strengths.",
        immediateNextAction: "Targeted resume tailoring focusing strictly on verified strengths without manufacturing ungrounded claims.",
        actions,
        stopCondition: "Do not manufacture evidence for requirements not supported by the candidate evidence graph.",
        provenance: [
          {
            source: "DECISION_EXPLANATION",
            ruleId: "PURSUE_TARGETED_MODERATE_EVIDENCE",
            signal: "MODERATE_EVIDENCE_TARGETED",
          },
        ],
      };
    }

    // -------------------------------------------------------------
    // P6 — PURSUE + Limited Evidence
    // -------------------------------------------------------------
    if (verdict === "PURSUE") {
      if (
        explanation.recommendedAction === "TAILOR_AND_APPLY" ||
        explanation.recommendedAction === "APPLY"
      ) {
        const actions: PursuitAction[] = [
          {
            type: "TAILOR_RESUME",
            priority: "PRIMARY",
            label: "Targeted resume alignment",
            rationale: "Focus strictly on candidate's verified evidence.",
          },
          {
            type: "DIRECT_APPLICATION",
            priority: "SECONDARY",
            label: "Apply direct",
            rationale: "Submit application on verified merits.",
          },
        ];
        return {
          engineVerdict: "PURSUE",
          effortLevel: "TARGETED",
          pursuitMode: "TAILOR_THEN_APPLY",
          tailoringDepth: "TARGETED",
          ruleId: "PURSUE_TARGETED_LIMITED_EVIDENCE",
          executiveLabel: "Worth a focused application",
          headline,
          bottomLine,
          whyThisEffortLevel: "PURSUE recommendation with limited explicit evidence: Target core verified capabilities.",
          immediateNextAction: "Focus tailoring on verified capabilities and apply.",
          actions,
          stopCondition: "Do not manufacture evidence for requirements not supported by the candidate evidence graph.",
          provenance: [
            {
              source: "DECISION_EXPLANATION",
              ruleId: "PURSUE_TARGETED_LIMITED_EVIDENCE",
              signal: "LIMITED_EVIDENCE_UPSTREAM_PURSUIT",
            },
          ],
        };
      } else {
        const actions: PursuitAction[] = [
          {
            type: "INVESTIGATE_ROLE",
            priority: "PRIMARY",
            label: "Investigate role mandate",
            rationale: "Verify core role parameters before full preparation.",
          },
        ];
        return {
          engineVerdict: "PURSUE",
          effortLevel: "INVESTIGATE_FIRST",
          pursuitMode: "INVESTIGATE_THEN_DECIDE",
          tailoringDepth: "NONE",
          ruleId: "PURSUE_INVESTIGATE_LIMITED_EVIDENCE",
          executiveLabel: "Investigate before investing",
          headline,
          bottomLine,
          whyThisEffortLevel: "Limited role evidence requires verification before deep preparation.",
          immediateNextAction: "Verify role mandate depth on introductory call.",
          actions,
          keyDependency: "Recruiter screening to confirm role depth and evidence requirements.",
          stopCondition: "Stop investing application effort if the confirmed mandate is materially below target executive operating altitude.",
          provenance: [
            {
              source: "EVIDENCE_GATE",
              ruleId: "PURSUE_INVESTIGATE_LIMITED_EVIDENCE",
              signal: "LIMITED_EVIDENCE_INVESTIGATE",
            },
          ],
        };
      }
    }

    // -------------------------------------------------------------
    // P7 — CONSIDER + Limited Career Upside
    // -------------------------------------------------------------
    const isLimitedCareerUpside =
      explanation.careerValueSignal === "LIMITED CAREER UPSIDE" ||
      context.careerValue?.trajectoryUpside === "LIMITED" ||
      context.careerValue?.trajectoryUpside === "Limited Career Upside" ||
      ruleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION") ||
      contextRuleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION");

    if (verdict === "CONSIDER" && isLimitedCareerUpside) {
      const actions: PursuitAction[] = [
        {
          type: "INVESTIGATE_ROLE",
          priority: "PRIMARY",
          label: "Validate strategic scope upside",
          rationale: "Confirm if role offers meaningful step-up.",
        },
        {
          type: "VERIFY_COMPENSATION",
          priority: "SECONDARY",
          label: "Verify compensation package",
          rationale: "Ensure compensation offsets lateral scope.",
        },
      ];
      return {
        engineVerdict: "CONSIDER",
        effortLevel: "LIGHT",
        pursuitMode: "INVESTIGATE_THEN_DECIDE",
        tailoringDepth: "LIGHT",
        ruleId: "CONSIDER_LIMITED_CAREER_UPSIDE",
        executiveLabel: "Worth limited effort",
        headline,
        bottomLine,
        whyThisEffortLevel: "The opportunity is accessible, but offers limited incremental career upside relative to current remit.",
        immediateNextAction: "Validate incremental strategic scope and compensation upside before deep preparation.",
        actions,
        keyDependency: "Validation of scope altitude on exploratory conversation.",
        stopCondition: "Do not proceed to deep tailoring unless role scope proves stronger than the current specification suggests.",
        provenance: [
          {
            source: "CAREER_POLICY",
            ruleId: "CONSIDER_LIMITED_CAREER_UPSIDE",
            signal: "LIMITED_CAREER_UPSIDE",
          },
        ],
      };
    }

    // -------------------------------------------------------------
    // P8 — CONSIDER + Ordinary Plausibility
    // -------------------------------------------------------------
    const actions: PursuitAction[] = [
      {
        type: "INVESTIGATE_ROLE",
        priority: "PRIMARY",
        label: "Explore mandate scope",
        rationale: "Clarify operating latitude on recruiter screening.",
      },
    ];
    return {
      engineVerdict: "CONSIDER",
      effortLevel: "LIGHT",
      pursuitMode: "INVESTIGATE_THEN_DECIDE",
      tailoringDepth: "LIGHT",
      ruleId: "CONSIDER_ORDINARY_PLAUSIBILITY",
      executiveLabel: "Worth limited effort",
      headline,
      bottomLine,
      whyThisEffortLevel: "Conditional consideration: Validate mandate scope and governance before investing full interview bandwidth.",
      immediateNextAction: "Conduct preliminary exploration of role scope and reporting line.",
      actions,
      keyDependency: "Exploratory call with executive recruiter.",
      stopCondition: "Do not proceed to deep tailoring unless role scope proves stronger than the current specification suggests.",
      provenance: [
        {
          source: "DECISION_EXPLANATION",
          ruleId: "CONSIDER_ORDINARY_PLAUSIBILITY",
          signal: "ORDINARY_CONSIDERATION",
        },
      ],
    };
  }
}
