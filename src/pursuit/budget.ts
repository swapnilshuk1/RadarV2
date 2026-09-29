/**
 * src/pursuit/budget.ts
 *
 * Token accounting for one pursuit derivation.
 *
 * Exact dollar cost is not knowable inside the module: pricing differs per
 * provider, per model and per contract, and pursuit may run against Mantle or
 * Gemini. What is knowable and enforceable is token volume, so the budget is
 * expressed in tokens for one complete package (thesis + resume + outreach set
 * + interview brief). The budget is a ceiling, not a target: crossing it stops
 * further provider calls for that package and lets the remaining artifacts fall
 * back to deterministic derivation, so a pathological role or an unusually large
 * evidence ledger can never run an unbounded bill.
 *
 * Deliberately free of Node imports: this module is reachable from the cockpit
 * bundle, so it must stay portable to any runtime.
 */

import type { ModelInvocationSink, ModelUsage } from "../lib/model/model-invocation";

export interface PursuitTokenBudget {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Sized from observed derivations: the consolidated package is four calls, the
 * largest of which carries the mandate, up to 30 verified claims and six message
 * briefs. Roughly 20k in / 5k out leaves headroom for one retry without leaving
 * room for a runaway loop.
 */
export const PURSUIT_TOKEN_BUDGET: PursuitTokenBudget = {
  inputTokens: 20_000,
  outputTokens: 5_000,
};

export interface PursuitTokenSnapshot {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  budget: PursuitTokenBudget;
  exhausted: boolean;
}

/** Accumulates provider-reported usage across one package derivation. */
export class PursuitTokenLedger {
  private inputTokens = 0;
  private outputTokens = 0;
  private calls = 0;

  constructor(private readonly budget: PursuitTokenBudget = PURSUIT_TOKEN_BUDGET) {}

  record(usage: ModelUsage | undefined): void {
    this.calls += 1;
    if (!usage) return;
    this.inputTokens += usage.inputTokens ?? 0;
    this.outputTokens += usage.outputTokens ?? usage.totalTokens ?? 0;
  }

  /** True once the package has spent its allowance; further calls are refused. */
  exhausted(): boolean {
    return (
      this.inputTokens >= this.budget.inputTokens || this.outputTokens >= this.budget.outputTokens
    );
  }

  snapshot(): PursuitTokenSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      calls: this.calls,
      budget: this.budget,
      exhausted: this.exhausted(),
    };
  }
}

/**
 * Passed explicitly through the generators rather than held in ambient state:
 * async-local storage would drag a Node-only module into the cockpit bundle, and
 * two pursuits may derive concurrently in the same worker process.
 */
export interface PursuitModelContext {
  /** Records each provider call for cost and latency observability. */
  invocationSink?: ModelInvocationSink;
  /** Enforces the per-package token ceiling. */
  ledger?: PursuitTokenLedger;
}
