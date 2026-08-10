export interface CardData {
  title: string;
  location: string;
  company: string;
}

const JUNIOR_PATTERNS = [
  /\bintern(?:ship)?\b/i,
  /\bgraduate(?: program)?\b/i,
  /\bfresher\b/i,
  /\btrainee\b/i,
  /\bentry[- ]level\b/i,
  /\bstudent\b/i,
];

// If location explicitly mentions a country that isn't India, it might be a false positive search result.
// Note: Some might say "Remote - US" or similar.
const NON_INDIA_LOCATIONS = [
  /\bunited states\b/i,
  /\busa?\b/i,
  /\buk\b/i,
  /\bunited kingdom\b/i,
  /\beurope\b/i,
];

/**
 * Returns true if the card PASSES the hard filter (i.e. should be processed).
 * Returns false if it should be immediately skipped.
 */
export function passesHardFilter(card: CardData): { pass: boolean; reason?: string } {
  if (!card.title && !card.company) return { pass: false, reason: "Missing title and company name" };
  if (!card.title) return { pass: false, reason: "Missing title" };
  if (!card.company) return { pass: false, reason: "Missing company name" };

  for (const p of JUNIOR_PATTERNS) {
    if (p.test(card.title)) return { pass: false, reason: "Junior title detected" };
  }

  if (card.location) {
    for (const p of NON_INDIA_LOCATIONS) {
      if (p.test(card.location)) {
        // If it explicitly says "India" AND a foreign country (e.g. "India, UK"), let it pass (soft filter handles it)
        if (!/\bindia\b/i.test(card.location)) {
          return { pass: false, reason: "Non-India location detected" };
        }
      }
    }
  }

  return { pass: true };
}
