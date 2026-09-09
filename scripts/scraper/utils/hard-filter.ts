export interface CardData {
  title: string;
  location?: string;
  company?: string;
  experience?: string;
  query?: string;
}

export type HardFilterExclusionReason =
  | "TITLE_INTENT_MISMATCH"
  | "LOCATION_EXCLUSION"
  | "EXPERIENCE_EXCLUSION"
  | "SENIORITY_EXCLUSION"
  | "OTHER";

export interface HardFilterResult {
  pass: boolean;
  decision: "PASS" | "PROVABLY_DISQUALIFIED" | "DEFER_TO_DETAIL";
  reason?: string;
  reasonCode?: HardFilterExclusionReason;
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

const JUNIOR_EXPERIENCE_PATTERNS = [
  /\b(?:0\s*-\s*[012]|1\s*-\s*2)\s*(?:yrs|years?)\b/i,
];

const NON_JOB_PATTERNS = [
  /privacy policy/i,
  /terms of service/i,
  /^job search$/i,
  /^career portal$/i,
];

// Positive non-India country evidence (used only when location constraints are active)
const NON_INDIA_LOCATIONS = [
  /\bunited states\b/i,
  /\busa?\b/i,
  /\buk\b/i,
  /\bunited kingdom\b/i,
  /\blondon\b/i,
  /\beurope\b/i,
  /\bgermany\b/i,
  /\bfrance\b/i,
  /\bcanada\b/i,
  /\baustralia\b/i,
  /\bsingapore\b/i,
  /\bdubai\b/i,
  /\buae\b/i,
];

const REMOTE_PATTERNS = [
  /\bremote\b/i,
  /\bworldwide\b/i,
  /\bglobal\b/i,
  /\banywhere\b/i,
  /\bwork from home\b/i,
  /\bwfh\b/i,
];

export interface HardFilterOptions {
  allowMissingCompany?: boolean;
  /** Active query or work-unit search intent term (e.g. "Chief Marketing Officer") */
  query?: string;
  /** Authoritative search-plan role/function terms for discovery admission. */
  targetRoles?: readonly string[];
  targetFunctions?: readonly string[];
  /** Explicit search-plan exclusions (negative policy constraints). */
  excludedRoles?: readonly string[];
  excludedFunctions?: readonly string[];
  /** Whether remote opportunities are permitted (default: true). */
  disallowRemote?: boolean;
}

const ROLE_NOISE_TOKENS = new Set([
  "chief", "officer", "head", "director", "manager", "senior", "junior",
  "associate", "vice", "president", "lead", "role", "and", "of", "the",
]);

function extractIntentTokens(values: readonly string[] | undefined): Set<string> {
  return new Set(
    (values || [])
      .flatMap((value) => value.toLowerCase().match(/[a-z0-9]{3,}/g) || [])
      .filter((token) => !ROLE_NOISE_TOKENS.has(token)),
  );
}

/**
 * Returns true if the card PASSES the hard filter (i.e. should be processed).
 * Distinguishes PROVABLY_DISQUALIFIED vs DEFER_TO_DETAIL.
 * A card is rejected pre-detail ONLY when discovery metadata contains
 * sufficiently reliable positive evidence of exclusion. Missing or ambiguous
 * evidence defers to full detail evaluation.
 */
export function passesHardFilter(
  card: CardData,
  options?: HardFilterOptions,
): HardFilterResult {
  const title = (card.title || "").trim();
  const company = (card.company || "").trim();

  // 1. Universal metadata presence checks
  if (!title && !company) {
    return {
      pass: false,
      decision: "PROVABLY_DISQUALIFIED",
      reason: "Missing title and company name",
      reasonCode: "OTHER",
    };
  }
  if (!title) {
    return {
      pass: false,
      decision: "PROVABLY_DISQUALIFIED",
      reason: "Missing title",
      reasonCode: "OTHER",
    };
  }
  if (!company && !options?.allowMissingCompany) {
    return {
      pass: false,
      decision: "PROVABLY_DISQUALIFIED",
      reason: "Missing company name",
      reasonCode: "OTHER",
    };
  }

  // 2. Universal non-job page patterns
  for (const p of NON_JOB_PATTERNS) {
    if (p.test(title)) {
      return {
        pass: false,
        decision: "PROVABLY_DISQUALIFIED",
        reason: `Non-job page title: "${title}"`,
        reasonCode: "OTHER",
      };
    }
  }

  // 3. Universal junior seniority patterns
  for (const p of JUNIOR_PATTERNS) {
    if (p.test(title)) {
      return {
        pass: false,
        decision: "PROVABLY_DISQUALIFIED",
        reason: "Junior title detected",
        reasonCode: "SENIORITY_EXCLUSION",
      };
    }
  }

  // 4. Universal junior experience patterns
  if (card.experience) {
    for (const p of JUNIOR_EXPERIENCE_PATTERNS) {
      if (p.test(card.experience)) {
        return {
          pass: false,
          decision: "PROVABLY_DISQUALIFIED",
          reason: `Junior experience level detected: ${card.experience}`,
          reasonCode: "EXPERIENCE_EXCLUSION",
        };
      }
    }
  }

  // 5. Explicit Search-Plan Role/Function Exclusions
  const excludedList = [
    ...(options?.excludedRoles || []),
    ...(options?.excludedFunctions || []),
  ];
  if (excludedList.length > 0) {
    const titleLower = title.toLowerCase();
    for (const excluded of excludedList) {
      const exTerm = excluded.toLowerCase().trim();
      if (exTerm && titleLower.includes(exTerm)) {
        return {
          pass: false,
          decision: "PROVABLY_DISQUALIFIED",
          reason: `Explicitly excluded by active search plan: "${excluded}" (Title: "${title}")`,
          reasonCode: "TITLE_INTENT_MISMATCH",
        };
      }
    }
  }

  // 6. Location check: Positive conflicting location evidence vs remote/ambiguous
  if (card.location) {
    const isRemoteAmbiguous = REMOTE_PATTERNS.some((p) => p.test(card.location!));
    if (isRemoteAmbiguous) {
      if (options?.disallowRemote) {
        return {
          pass: false,
          decision: "PROVABLY_DISQUALIFIED",
          reason: `Remote work excluded by active search plan: "${card.location}"`,
          reasonCode: "LOCATION_EXCLUSION",
        };
      }
      // Ambiguous remote/international wording defers to detail evaluation
    } else {
      for (const p of NON_INDIA_LOCATIONS) {
        if (p.test(card.location)) {
          // If it explicitly mentions India alongside a foreign location, defer to detail
          if (!/\bindia\b/i.test(card.location)) {
            return {
              pass: false,
              decision: "PROVABLY_DISQUALIFIED",
              reason: `Non-India location detected without India or remote anchor: "${card.location}"`,
              reasonCode: "LOCATION_EXCLUSION",
            };
          }
        }
      }
    }
  }

  // 7. Role & Function Intent Scoping (Current Work Unit / Query Intent)
  const targetTerms: string[] = [
    ...(card.query ? [card.query] : []),
    ...(options?.query ? [options.query] : []),
    ...(options?.targetRoles || []),
    ...(options?.targetFunctions || []),
  ];

  const expectedTokens = extractIntentTokens(targetTerms);
  if (expectedTokens.size > 0) {
    const titleTokens = new Set(title.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
    const matchesIntent = [...expectedTokens].some((token) => titleTokens.has(token));
    if (matchesIntent) {
      return { pass: true, decision: "PASS" };
    }

    // Ambiguous executive titles or titles with missing functional evidence
    // (e.g. "Business Head", "Managing Director", "Director", "VP", "Country Head")
    // must NOT be disqualified pre-detail. Defer to full detail evaluation.
    return {
      pass: true,
      decision: "DEFER_TO_DETAIL",
      reason: "Ambiguous title or missing functional evidence; deferring to full detail evaluation",
    };
  }

  return { pass: true, decision: "PASS" };
}
