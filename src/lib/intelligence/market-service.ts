// Layer 1 — Market service facade. Sync accessor for the pipeline (pipeline
// itself is synchronous). Real async fetching would live behind this.

import { UNAVAILABLE_MARKET, type MarketIntelligence } from "./market";

const cache = new Map<string, MarketIntelligence>();

export function marketFor(jobHash: string): MarketIntelligence {
  return cache.get(jobHash) ?? UNAVAILABLE_MARKET;
}

/** Test / future-integration hook: pre-populate the cache. */
export function primeMarket(jobHash: string, signal: MarketIntelligence): void {
  cache.set(jobHash, signal);
}