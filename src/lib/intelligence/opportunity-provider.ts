// Layer 4 — Opportunity Provider. Orchestrates the flow:
// raw fixtures -> runEngine() -> Narrative Formatter -> Presenter -> Opportunity DTO.
// Exposes a repository pattern for UI consumers.

import { runEngine, addExtraOpportunities } from "./engine";
import { activePursuits } from "../decisions-store";
import type { Opportunity } from "@/data/opportunity-fixtures";

export type ProviderOptions = {
  activePursuits?: number;
};

export const OpportunityProvider = {
  /** List all dynamically computed opportunity DTOs. */
  list(options?: ProviderOptions): Opportunity[] {
    const active = options?.activePursuits ?? activePursuits();
    const { presented } = runEngine(active);
    return presented.map((p) => p.opportunity);
  },

  /** Get a single computed opportunity DTO by hash. */
  get(jobHash: string, options?: ProviderOptions): Opportunity | undefined {
    const opportunities = this.list(options);
    return opportunities.find((o) => o.jobHash === jobHash);
  },

  /** Get neighbors (prev/next DTOs) of an opportunity. */
  neighbours(
    jobHash: string,
    options?: ProviderOptions,
  ): { prev: Opportunity | undefined; next: Opportunity | undefined } {
    const opportunities = this.list(options);
    const i = opportunities.findIndex((o) => o.jobHash === jobHash);
    if (i === -1) return { prev: undefined, next: undefined };
    return {
      prev: i > 0 ? opportunities[i - 1] : undefined,
      next: i < opportunities.length - 1 ? opportunities[i + 1] : undefined,
    };
  },

  /** Add newly extracted opportunities (mock data fallback). */
  addExtra(): void {
    addExtraOpportunities();
  },

  /** Inject fresh scraped records from the server into the UI. */
  injectFresh(records: any[]): void {
    const { injectFreshRecords } = require("./engine");
    injectFreshRecords(records);
  }
};
