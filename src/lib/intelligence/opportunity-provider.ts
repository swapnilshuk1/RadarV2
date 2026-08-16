// Layer 4 — Opportunity Provider. Orchestrates the flow:
// raw fixtures -> runEngine() -> Narrative Formatter -> Presenter -> Opportunity DTO.
// Exposes a repository pattern for UI consumers.

import { runEngine, runEngineSingle, addExtraOpportunities, injectFreshRecords } from "./engine";
import { candidateProfile } from "../../data/candidate-profile";
import { activePursuits } from "../decisions-store";
import type { Opportunity } from "@/data/opportunity-fixtures";
import { CandidateProjectionBuilderImpl } from "./builders/CandidateProjectionBuilder";

export type ProviderOptions = {
  activePursuits?: number;
};

const builder = new CandidateProjectionBuilderImpl();

/**
 * @deprecated Use OpportunityService instead. This adapter is kept for backward compatibility during migration.
 */
export const OpportunityProvider = {
  /** List all dynamically computed opportunity DTOs, sorted by Pursuit Potential. */
  list(options?: ProviderOptions): Opportunity[] {
    const active = options?.activePursuits ?? activePursuits();
    // Pre-build the projection to satisfy Phase 5a.5
    const projection = builder.fromProfile(candidateProfile);
    
    // Pass projection directly into the V4 Engine
    const { presented } = runEngine(projection, active);
    const decisionRank: Record<string, number> = { PURSUE: 0, CONSIDER: 1, PASS: 2 };
    return presented
      .map((p) => p.opportunity)
      .filter((o) => o.decision !== "PASS")
      .sort((a, b) => {
        // P1-E: Deterministic tie-breaking for ranking
        // Primary: Decision tier (PURSUE < CONSIDER < PASS)
        const tierDiff = (decisionRank[a.decision] ?? 3) - (decisionRank[b.decision] ?? 3);
        if (tierDiff !== 0) return tierDiff;

        // Secondary: Higher recommendation score first (null score never coerced to 0)
        const scoreA = a.recommendationResult?.score ?? null;
        const scoreB = b.recommendationResult?.score ?? null;
        if (scoreA !== null && scoreB !== null) {
          const scoreDiff = scoreB - scoreA;
          if (scoreDiff !== 0) return scoreDiff;
        } else if (scoreA !== null && scoreB === null) {
          return -1;
        } else if (scoreA === null && scoreB !== null) {
          return 1;
        }

        // Tertiary: Deterministic jobHash order (confidence strictly excluded from fit ranking)
        return a.jobHash.localeCompare(b.jobHash);
      });
  },

  /** Get a single computed opportunity DTO by hash. */
  get(jobHash: string, options?: ProviderOptions): Opportunity | undefined {
    const opportunities = this.list(options);
    const found = opportunities.find((o) => o.jobHash === jobHash);
    if (found) return found;

    // Lazy, super-fast single-record fallback!
    const active = options?.activePursuits ?? activePursuits();
    const projection = builder.fromProfile(candidateProfile);
    const presentedSingle = runEngineSingle(jobHash, projection, active);
    return presentedSingle?.opportunity;
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
    injectFreshRecords(records);
  }
};
