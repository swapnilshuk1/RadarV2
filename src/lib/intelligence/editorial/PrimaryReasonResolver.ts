import type { Opportunity } from "../../../data/opportunity-fixtures";
import type { EditorialContext } from "./EditorialContext";
import type {
  ExecutiveDecisionExplanation,
  EvidenceStrength,
  RecommendedAction,
  ExplanationProvenance,
} from "./ExecutiveDecisionExplanation";

export class PrimaryReasonResolver {
  /**
   * Pure deterministic generator of ExecutiveDecisionExplanation.
   * Consumes ONLY authoritative EditorialContext and Opportunity metadata.
   *
   * STRICT INVARIANTS:
   * 1. explanation.verdict === ctx.engineVerdict (when non-null).
   * 2. Zero raw score threshold calculations (qualityScore >= 75 forbidden).
   * 3. recommendedAction is strictly downstream of verdict + explanation context.
   * 4. Candidate claims are grounded in evidence provenance.
   */
  public static resolve(
    ctx: EditorialContext,
    opportunity?: Opportunity
  ): ExecutiveDecisionExplanation {
    const verdict = ctx.engineVerdict;
    const ruleIds = ctx.careerValue.triggeredRuleIds || [];
    const roleStr = opportunity?.role || "Executive Mandate";
    const companyStr = opportunity?.company || "Target Enterprise";

    // 1. Career Value Signal Mapping
    let careerValueSignal: string | null = null;

    if (ruleIds.includes("G-SUB-TIER-MANDATE-VETO")) {
      careerValueSignal = "SUB-TIER MANDATE";
    } else if (
      ctx.careerValue.careerValueProtection === "DOWNSCALED" ||
      ctx.careerValue.trajectoryUpside === "REGRESSION" ||
      ctx.careerValue.trajectoryUpside === "Career Regression"
    ) {
      careerValueSignal = "CAREER REGRESSION / PROTECTION";
    } else if (
      ctx.careerValue.trajectoryUpside === "HIGH" ||
      ctx.careerValue.trajectoryUpside === "High Career Upside"
    ) {
      careerValueSignal = "HIGH CAREER UPSIDE";
    } else if (
      ctx.careerValue.trajectoryUpside === "LIMITED" ||
      ctx.careerValue.trajectoryUpside === "Limited Career Upside" ||
      ruleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION")
    ) {
      careerValueSignal = "LIMITED CAREER UPSIDE";
    } else if (ctx.careerValue.trajectoryUpside) {
      careerValueSignal = String(ctx.careerValue.trajectoryUpside).toUpperCase();
    }

    // 2. Headline Construction
    const headline = verdict
      ? `${verdict}: ${roleStr} at ${companyStr}`
      : `RECOMMENDATION UNAVAILABLE: ${roleStr} at ${companyStr}`;

    // 3. Evidence Strength Assessment (distinct from capability fit)
    const explicitCount = ctx.evidence?.explicitCount ?? 0;
    let evidenceStrength: EvidenceStrength = "MODERATE";
    if (explicitCount >= 3) {
      evidenceStrength = "STRONG";
    } else if (explicitCount === 0 && (ctx.capability?.missingCapabilities.length ?? 0) > 2) {
      evidenceStrength = "INSUFFICIENT";
    } else if (explicitCount === 0) {
      evidenceStrength = "LIMITED";
    }

    // 4. Primary Reason & Provenance Hierarchy Selection
    const provenanceList: ExplanationProvenance[] = [];
    let primaryReason = "";
    const supportingReasons: string[] = [];
    let keyUncertainty: string | null = null;

    if (verdict === "PURSUE") {
      primaryReason = `High-conviction alignment: Strong commercial transformation mandate at ${companyStr} with substantial career upside and strategic operating scale.`;
      provenanceList.push({
        source: "DECISION_POLICY",
        ruleIds,
        signal: "HIGH_CONVICTION_PURSUE",
      });

      if (ctx.capability?.matchedCapabilities && ctx.capability.matchedCapabilities.length > 0) {
        supportingReasons.push(
          `Verified core capability alignment in ${ctx.capability.matchedCapabilities.slice(0, 3).join(", ")}.`
        );
        provenanceList.push({
          source: "CAPABILITY_ASSESSMENT",
          signal: `Matched: ${ctx.capability.matchedCapabilities.slice(0, 3).join(", ")}`,
        });
      }

      if (ctx.careerValue.relativeDifferentiator) {
        supportingReasons.push(`Strategic Differentiator: ${ctx.careerValue.relativeDifferentiator}`);
        provenanceList.push({
          source: "CAREER_ASSESSMENT",
          signal: ctx.careerValue.relativeDifferentiator,
        });
      }
    } else if (verdict === "CONSIDER") {
      if (ruleIds.includes("G-SUB-TIER-MANDATE-VETO")) {
        primaryReason = `Sub-tier mandate warning: The role at ${companyStr} appears below your current executive operating scope.`;
        provenanceList.push({
          source: "DECISION_POLICY",
          ruleIds: ["G-SUB-TIER-MANDATE-VETO"],
          signal: "SUB-TIER MANDATE",
        });
      } else if (
        careerValueSignal === "CAREER REGRESSION / PROTECTION" ||
        ctx.careerValue.careerValueProtection === "DOWNSCALED"
      ) {
        primaryReason = `Accessible role, but with material career regression: Operating scope at ${companyStr} is below your current trajectory.`;
        provenanceList.push({
          source: "CAREER_ASSESSMENT",
          ruleIds,
          signal: "CAREER REGRESSION / PROTECTION",
        });
      } else if (ruleIds.includes("POL-D-CONSIDER-REACH-ROLE")) {
        primaryReason = `Reach role opportunity: High strategic upside at ${companyStr}, but requires bridging adjacent capability or scale dimensions.`;
        provenanceList.push({
          source: "DECISION_POLICY",
          ruleIds: ["POL-D-CONSIDER-REACH-ROLE"],
          signal: "POL-D-CONSIDER-REACH-ROLE",
        });
      } else if (ruleIds.includes("POL-D-CONSIDER-HIGH-FRICTION")) {
        primaryReason = `High location or logistical friction: Strong mandate fit at ${companyStr}, but requires managing material location or commute constraints.`;
        provenanceList.push({
          source: "DECISION_POLICY",
          ruleIds: ["POL-D-CONSIDER-HIGH-FRICTION"],
          signal: "POL-D-CONSIDER-HIGH-FRICTION",
        });
      } else if (careerValueSignal === "LIMITED CAREER UPSIDE") {
        primaryReason = `Accessible capability fit, but limited incremental career upside: The role adds limited strategic scope relative to your current remit.`;
        provenanceList.push({
          source: "CAREER_ASSESSMENT",
          ruleIds,
          signal: "LIMITED CAREER UPSIDE",
        });
      } else if (evidenceStrength === "INSUFFICIENT" || evidenceStrength === "LIMITED") {
        primaryReason = `Sparse specification: Opportunity at ${companyStr} lacks detailed mandate specification for conclusive evaluation.`;
        keyUncertainty = `JD provides limited explicit evidence regarding reporting line and P&L governance.`;
        provenanceList.push({
          source: "JOB_REQUIREMENT",
          signal: "SPARSE_SPECIFICATION",
        });
      } else {
        primaryReason = `Conditional consideration: Verify mandate scope, reporting line, and budget authority at ${companyStr} before investing interview bandwidth.`;
        provenanceList.push({
          source: "DECISION_POLICY",
          ruleIds,
          signal: "CONDITIONAL_CONSIDERATION",
        });
      }

      if (ctx.capability?.matchedCapabilities && ctx.capability.matchedCapabilities.length > 0) {
        supportingReasons.push(
          `Strong capability match in ${ctx.capability.matchedCapabilities.slice(0, 2).join(", ")}.`
        );
      }
      if (ctx.capability?.missingCapabilities && ctx.capability.missingCapabilities.length > 0) {
        keyUncertainty = `Requires verification: Confirm coverage for ${ctx.capability.missingCapabilities.slice(0, 2).join(", ")}.`;
      }
    } else if (verdict === "PASS") {
      if (ruleIds.includes("G-SUB-TIER-MANDATE-VETO")) {
        primaryReason = `Sub-tier mandate veto: Role scoping at ${companyStr} is below executive baseline expectations (execution-focused or sub-tier title).`;
      } else if (ruleIds.includes("G-EXECUTIVE-IDENTITY-MISMATCH") || ruleIds.includes("G-IDENTITY-VETO")) {
        primaryReason = `Domain identity mismatch: Functional mandate at ${companyStr} diverges from your executive identity baseline.`;
      } else if (ruleIds.includes("G-COMPATIBILITY-REGRESSION-VETO")) {
        primaryReason = `Career trajectory regression: Pursuing this role at ${companyStr} represents material career regression relative to your current executive trajectory.`;
      } else if (ruleIds.includes("POL-D-PASS-PROHIBITIVE-FRICTION")) {
        primaryReason = `Prohibitive pursuit friction: This is not a quality or capability rejection; the opportunity at ${companyStr} is being passed because the practical pursuit constraints are prohibitive.`;
      } else if (ruleIds.includes("G-EVIDENCE-INTEGRITY-FAILED") || ruleIds.includes("G-EVIDENCE-GATE-SPARSE-SPEC")) {
        primaryReason = `Insufficient evidence specification: Opportunity text for ${roleStr} at ${companyStr} lacks verified structural evidence for executive evaluation.`;
      } else if (ruleIds.includes("G-EXECUTION-VETO")) {
        primaryReason = `Execution scope mismatch: Role at ${companyStr} is heavily tactical execution without strategic P&L or organizational authority.`;
      } else if (ruleIds.includes("R-PASS-LOW-PRIORITY")) {
        primaryReason = `Low strategic priority: Overall fit score at ${companyStr} sits below your active pursuit threshold.`;
      } else {
        primaryReason = `Strategic pass: Operating altitude or role scoping at ${companyStr} represents a structural mismatch from your executive baseline.`;
      }
      provenanceList.push({
        source: "DECISION_POLICY",
        ruleIds,
        signal: ruleIds[0] || "STRATEGIC_PASS",
      });

      if (ctx.capability?.missingCapabilities && ctx.capability.missingCapabilities.length > 0) {
        supportingReasons.push(
          `Material requirement mismatch in ${ctx.capability.missingCapabilities.slice(0, 2).join(", ")}.`
        );
        provenanceList.push({
          source: "CAPABILITY_ASSESSMENT",
          signal: `Missing: ${ctx.capability.missingCapabilities.slice(0, 2).join(", ")}`,
        });
      }
    } else {
      primaryReason = `RECOMMENDATION UNAVAILABLE: Engine evaluation pending or insufficient structured signal for ${roleStr} at ${companyStr}.`;
      keyUncertainty = `No authoritative recommendation received from Decision Policy Engine.`;
    }

    // 5. Tradeoff Construction
    const tradeoff = ctx.careerValue.relativeDifferentiator || null;

    // 6. Bottom Line Construction
    let bottomLine = primaryReason;
    if (verdict === "PURSUE") {
      bottomLine = `Strong opportunity to expand career scope at ${companyStr}.`;
    } else if (verdict === "CONSIDER") {
      if (careerValueSignal === "CAREER REGRESSION / PROTECTION") {
        bottomLine = `Accessible role, but with material career regression.`;
      } else if (careerValueSignal === "LIMITED CAREER UPSIDE") {
        bottomLine = `Strong capability fit, but limited incremental career upside.`;
      } else {
        bottomLine = `Conditional fit requiring verification of mandate depth at ${companyStr}.`;
      }
    } else if (verdict === "PASS") {
      bottomLine = `The opportunity does not clear RADAR's strategic fit threshold.`;
    } else {
      bottomLine = `Recommendation unavailable pending engine evaluation.`;
    }

    // 7. Recommended Action Determination (STRICTLY DOWNSTREAM OF VERDICT + EXPLANATION)
    let recommendedAction: RecommendedAction = "INVESTIGATE";
    if (verdict === "PURSUE") {
      recommendedAction = evidenceStrength === "STRONG" ? "APPLY" : "TAILOR_AND_APPLY";
    } else if (verdict === "CONSIDER") {
      if (
        careerValueSignal === "CAREER REGRESSION / PROTECTION" ||
        ctx.careerValue.careerValueProtection === "DOWNSCALED"
      ) {
        recommendedAction = "REASSESS_SCOPE";
      } else if (evidenceStrength === "INSUFFICIENT" || evidenceStrength === "LIMITED") {
        recommendedAction = "INVESTIGATE";
      } else {
        recommendedAction = "TAILOR_AND_APPLY";
      }
    } else if (verdict === "PASS") {
      recommendedAction = "PASS";
    } else {
      recommendedAction = "INVESTIGATE";
    }

    return {
      verdict,
      headline,
      bottomLine,
      primaryReason,
      supportingReasons,
      careerValueSignal,
      tradeoff,
      evidenceStrength,
      keyUncertainty,
      recommendedAction,
      ruleIds,
      provenance: provenanceList,
    };
  }
}
