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
  /** Authoritative search-plan role/function terms for discovery admission. */
  targetRoles?: readonly string[];
  targetFunctions?: readonly string[];
}

const ROLE_NOISE_TOKENS = new Set([
  "chief", "officer", "head", "director", "manager", "senior", "junior",
  "associate", "vice", "president", "lead", "role", "and", "of", "the",
]);

function intentTokens(values: readonly string[] | undefined): Set<string> {
  return new Set(
    (values || [])
      .flatMap((value) => value.toLowerCase().match(/[a-z0-9]{3,}/g) || [])
      .filter((token) => !ROLE_NOISE_TOKENS.has(token)),
  );
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

  /*
   * Search queries can contain ambiguous abbreviations (for example CMO).
   * Require an actual role/function signal from the active plan before a
   * result reaches acquisition. This is a plan-level admission check, not a
   * portal or profession-specific title blacklist.
   */
  const expected = intentTokens([
    ...(options?.targetRoles || []),
    ...(options?.targetFunctions || []),
  ]);
  if (expected.size > 0) {
    const titleTokens = new Set(title.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
    const matchesIntent = [...expected].some((token) => titleTokens.has(token));
    if (!matchesIntent) {
      return { pass: false, reason: "Title does not match active search-plan role/function intent" };
    }
  }

  return { pass: true };
}
