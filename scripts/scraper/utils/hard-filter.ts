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
  /\bapprentice\b/i,
  /\bjunior\b/i,
  /\bcall center\b/i,
  /\btelecaller\b/i,
  /\bdata entry operator\b/i,
];

const NON_JOB_PATTERNS = [
  /privacy policy/i,
  /terms of service/i,
  /^job search$/i,
  /^career portal$/i,
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

export interface HardFilterOptions {
  allowMissingCompany?: boolean;
}

/**
 * Returns true if the card PASSES the hard filter (i.e. should be processed).
 * Returns false if it should be immediately skipped.
 */
export function passesHardFilter(
  card: CardData,
  options?: HardFilterOptions
): { pass: boolean; reason?: string } {
  const title = (card.title || "").trim();
  const company = (card.company || "").trim();

  if (!title && !company) return { pass: false, reason: "Missing title and company name" };
  if (!title) return { pass: false, reason: "Missing title" };
  if (!company && !options?.allowMissingCompany) return { pass: false, reason: "Missing company name" };

  for (const p of NON_JOB_PATTERNS) {
    if (p.test(title)) return { pass: false, reason: `Non-job page title: "${title}"` };
  }

  for (const p of JUNIOR_PATTERNS) {
    if (p.test(title)) return { pass: false, reason: "Junior title detected" };
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
