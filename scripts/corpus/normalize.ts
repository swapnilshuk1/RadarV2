import type { DetailedCard } from "../scraper/types";

export interface NormalizedOpportunity {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  scrapedFrom: string;
  applyUrl: string;
  postedRelative: string;
  normalizedText: string;
  rawSnippet: string;
  rawDetailText: string;
}

/**
 * Normalize Stage: Standardizes raw scraped fields and extracts clean text representation.
 * IDEMPOTENT: Returns a clean data structure for any snapshot.
 */
export function normalizeCard(card: DetailedCard): NormalizedOpportunity {
  const role = (card.title || "Unknown Title").trim();
  const company = (card.company || "Unknown Company").trim();
  const location = (card.location || "").trim();
  const scrapedFrom = card.portal || "Direct";
  const applyUrl = card.detail?.applyUrl || card.detailUrl || "";
  const postedRelative = card.postedRelative || "Posted recently";

  const rawSnippet = card.rawText || "";
  const rawDetailText = card.detail?.rawText || "";

  // The hero text of the opportunity. Prefer detailed description over simple listing snippet.
  let normalizedText = rawDetailText.trim();
  if (!normalizedText || normalizedText.length < 50) {
    normalizedText = rawSnippet.trim();
  }

  // Generate a standard jobHash deterministically if not already provided
  const jobHash = card.cardHash;

  return {
    jobHash,
    role,
    company,
    location,
    scrapedFrom,
    applyUrl,
    postedRelative,
    normalizedText,
    rawSnippet,
    rawDetailText
  };
}

export function normalizeCorpus(cards: DetailedCard[]): NormalizedOpportunity[] {
  console.log(`[Normalize] Normalizing ${cards.length} snapshots...`);
  const normalized = cards.map(normalizeCard);
  const withValidText = normalized.filter(n => n.normalizedText.length > 50).length;
  console.log(`[Normalize] Normalized ${normalized.length} records. Clean text (>50 chars) available for ${withValidText}/${normalized.length} (${(withValidText / normalized.length * 100).toFixed(1)}%).`);
  return normalized;
}
