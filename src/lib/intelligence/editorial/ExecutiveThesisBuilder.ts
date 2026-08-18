import type { Opportunity } from "../../../data/opportunity-fixtures";
import type { EditorialContext, EngineVerdict } from "./EditorialContext";
import { PrimaryReasonResolver } from "./PrimaryReasonResolver";
import type { ExecutiveDecisionExplanation } from "./ExecutiveDecisionExplanation";

export interface ExecutiveThesis {
  readonly verdict: EngineVerdict | null;
  readonly headline: string;
  readonly careerValueSignal: string | null;
  readonly primaryReason: string;
  readonly tradeoff: string | null;
  readonly relativeDifferentiator: string | null;
  readonly ruleIds: readonly string[];
  readonly explanation?: ExecutiveDecisionExplanation;
}

export class ExecutiveThesisBuilder {
  /**
   * Pure deterministic generator of the canonical ExecutiveThesis.
   * Delegates to PrimaryReasonResolver to ensure 100% single-source-of-truth convergence.
   */
  public static build(ctx: EditorialContext, opportunity?: Opportunity): ExecutiveThesis {
    const explanation = PrimaryReasonResolver.resolve(ctx, opportunity);

    return {
      verdict: explanation.verdict,
      headline: explanation.headline,
      careerValueSignal: explanation.careerValueSignal,
      primaryReason: explanation.primaryReason,
      tradeoff: explanation.tradeoff,
      relativeDifferentiator: ctx.careerValue.relativeDifferentiator,
      ruleIds: explanation.ruleIds,
      explanation,
    };
  }
}
