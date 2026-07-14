// Layer 1 — Market Intelligence. Async and optional. Its absence reduces
// confidence (metadata) but never changes priority (behaviour).

export type MarketSignalStatus = "pending" | "ready" | "unavailable";

export type MarketIntelligence = {
  status: MarketSignalStatus;
  orgScaleTier?: "startup" | "mid" | "enterprise";
  hiringVelocity?: "cold" | "steady" | "hot";
  fundingStage?: "seed" | "growth" | "late" | "public";
  reportingComplexity?: "flat" | "matrixed" | "deep";
};

export const UNAVAILABLE_MARKET: MarketIntelligence = { status: "unavailable" };

/** Stub. Swap for a real HTTP call to a market data provider. */
export async function fetchMarket(
  _oiJobHash: string,
): Promise<MarketIntelligence> {
  return UNAVAILABLE_MARKET;
}