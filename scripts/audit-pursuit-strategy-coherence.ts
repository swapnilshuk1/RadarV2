import * as fs from "fs";
import * as path from "path";
import type { PursuitStrategy } from "../src/lib/intelligence/editorial/PursuitStrategy";
import type { ExecutiveDecisionExplanation } from "../src/lib/intelligence/editorial/ExecutiveDecisionExplanation";
import type { EditorialContext } from "../src/lib/intelligence/editorial/EditorialContext";
import { PursuitStrategyResolver } from "../src/lib/intelligence/editorial/PursuitStrategyResolver";

export interface CoherenceViolation {
  opportunityId: string;
  type: string;
  description: string;
  details: any;
}

export class PursuitStrategyCoherenceAuditor {
  public static audit(
    opportunityId: string,
    strategy: PursuitStrategy,
    explanation: ExecutiveDecisionExplanation,
    context: EditorialContext
  ): CoherenceViolation[] {
    const violations: CoherenceViolation[] = [];

    // 1. Invariant: engineVerdict match
    if (strategy.engineVerdict !== explanation.verdict) {
      violations.push({
        opportunityId,
        type: "ENGINE_VERDICT_MISMATCH",
        description: `Strategy engineVerdict (${strategy.engineVerdict}) does not match explanation verdict (${explanation.verdict})`,
        details: { strategyVerdict: strategy.engineVerdict, explanationVerdict: explanation.verdict },
      });
    }

    // 2. Invariant: PASS verdict must have effort DO_NOT_INVEST and mode PASS and no TAILOR_* actions
    if (explanation.verdict === "PASS") {
      if (strategy.effortLevel !== "DO_NOT_INVEST") {
        violations.push({
          opportunityId,
          type: "PASS_EFFORT_CONTRADICTION",
          description: `PASS verdict has effortLevel ${strategy.effortLevel} instead of DO_NOT_INVEST`,
          details: { effortLevel: strategy.effortLevel },
        });
      }
      if (strategy.pursuitMode !== "PASS") {
        violations.push({
          opportunityId,
          type: "PASS_MODE_CONTRADICTION",
          description: `PASS verdict has pursuitMode ${strategy.pursuitMode} instead of PASS`,
          details: { pursuitMode: strategy.pursuitMode },
        });
      }
      if (strategy.tailoringDepth !== "NONE") {
        violations.push({
          opportunityId,
          type: "PASS_TAILORING_CONTRADICTION",
          description: `PASS verdict has tailoringDepth ${strategy.tailoringDepth} instead of NONE`,
          details: { tailoringDepth: strategy.tailoringDepth },
        });
      }
      if (strategy.actions.some((a) => a.type.startsWith("TAILOR_") || a.type === "DIRECT_APPLICATION")) {
        violations.push({
          opportunityId,
          type: "PASS_ACTION_CONTRADICTION",
          description: `PASS verdict has active application actions`,
          details: { actions: strategy.actions },
        });
      }
    }

    // 3. Invariant: Career Regression must have effort LIGHT / CLARIFY_SCOPE / NONE tailoring
    const isCareerRegression =
      explanation.careerValueSignal === "CAREER REGRESSION / PROTECTION" ||
      explanation.careerValueSignal === "SUB-TIER MANDATE" ||
      context.careerValue?.careerValueProtection === "DOWNSCALED" ||
      context.careerValue?.trajectoryUpside === "REGRESSION" ||
      context.careerValue?.trajectoryUpside === "Career Regression";

    if (isCareerRegression) {
      if (strategy.effortLevel === "DEEP") {
        violations.push({
          opportunityId,
          type: "CAREER_REGRESSION_EFFORT_CONTRADICTION",
          description: `Career regression role assigned DEEP effort`,
          details: { effortLevel: strategy.effortLevel, careerValueSignal: explanation.careerValueSignal },
        });
      }
      if (strategy.tailoringDepth === "DEEP") {
        violations.push({
          opportunityId,
          type: "CAREER_REGRESSION_TAILORING_CONTRADICTION",
          description: `Career regression role assigned DEEP tailoring depth`,
          details: { tailoringDepth: strategy.tailoringDepth },
        });
      }
    }

    // 4. Invariant: Sparse specification / insufficient evidence must have INVESTIGATE_FIRST and NONE tailoring
    const isSparseSpec =
      explanation.evidenceStrength === "INSUFFICIENT" ||
      explanation.primaryReason.includes("Sparse specification") ||
      explanation.ruleIds?.includes("SPARSE_SPECIFICATION");

    if (isSparseSpec) {
      if (strategy.effortLevel === "DEEP") {
        violations.push({
          opportunityId,
          type: "SPARSE_SPEC_EFFORT_CONTRADICTION",
          description: `Sparse specification opportunity assigned DEEP effort`,
          details: { effortLevel: strategy.effortLevel },
        });
      }
      if (strategy.tailoringDepth === "DEEP") {
        violations.push({
          opportunityId,
          type: "SPARSE_SPEC_TAILORING_CONTRADICTION",
          description: `Sparse specification opportunity assigned DEEP tailoring depth`,
          details: { tailoringDepth: strategy.tailoringDepth },
        });
      }
    }

    // 5. Invariant: Material uncertainty must not have DEEP effort
    if (explanation.keyUncertainty != null) {
      if (strategy.effortLevel === "DEEP") {
        violations.push({
          opportunityId,
          type: "UNCERTAINTY_EFFORT_CONTRADICTION",
          description: `Opportunity with unresolved keyUncertainty assigned DEEP effort`,
          details: { keyUncertainty: explanation.keyUncertainty, effortLevel: strategy.effortLevel },
        });
      }
    }

    // 6. Invariant: DO_NOT_INVEST must never have TAILOR_* actions
    if (strategy.effortLevel === "DO_NOT_INVEST" && strategy.actions.some((a) => a.type.startsWith("TAILOR_"))) {
      violations.push({
        opportunityId,
        type: "DO_NOT_INVEST_TAILOR_ACTION",
        description: `DO_NOT_INVEST effort level contains TAILOR action`,
        details: { actions: strategy.actions },
      });
    }

    // 7. Invariant: NONE tailoring depth must never have TAILOR_RESUME action
    if (strategy.tailoringDepth === "NONE" && strategy.actions.some((a) => a.type === "TAILOR_RESUME")) {
      violations.push({
        opportunityId,
        type: "NONE_TAILORING_RESUME_ACTION",
        description: `NONE tailoring depth contains TAILOR_RESUME action`,
        details: { actions: strategy.actions },
      });
    }

    // 8. Invariant: Actions must contain at least one PRIMARY action
    if (!strategy.actions.some((a) => a.priority === "PRIMARY")) {
      violations.push({
        opportunityId,
        type: "MISSING_PRIMARY_ACTION",
        description: `Strategy does not specify a PRIMARY action`,
        details: { actions: strategy.actions },
      });
    }

    // 9. Invariant: Stop condition must be present and non-empty
    if (!strategy.stopCondition || strategy.stopCondition.trim().length === 0) {
      violations.push({
        opportunityId,
        type: "MISSING_STOP_CONDITION",
        description: `Strategy lacks a stop condition`,
        details: { stopCondition: strategy.stopCondition },
      });
    }

    // 10. Invariant: Determinism
    const repeat = PursuitStrategyResolver.resolve(explanation, context);
    if (JSON.stringify(repeat) !== JSON.stringify(strategy)) {
      violations.push({
        opportunityId,
        type: "NON_DETERMINISTIC_STRATEGY",
        description: `Strategy resolution is non-deterministic`,
        details: { first: strategy, second: repeat },
      });
    }

    return violations;
  }
}
