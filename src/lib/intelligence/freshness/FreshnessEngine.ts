/**
 * FreshnessEngine.ts
 *
 * P7-A: Opportunity Freshness & Posting Age Module
 *
 * Traces, computes, and renders opportunity freshness metadata without modifying core Quality Score or Decision Policy.
 */

export type FreshnessState = "FRESH" | "RECENT" | "AGING" | "STALE" | "UNKNOWN";

export interface FreshnessMetadata {
  state: FreshnessState;
  postedDateDisplay: string;
  scrapedAtDisplay?: string;
  sourcePortalDisplay: string;
  ageInDays?: number;
  staleWarning?: string;
  isStale: boolean;
  precision: "EXACT" | "RELATIVE_ESTIMATE" | "LOWER_BOUND" | "UNKNOWN";
}

/**
 * Parses a relative date string (e.g., "Posted 2 days ago", "3w ago", "Posted 47 days ago") or ISO date.
 */
export function parsePostingAgeDays(postedRelative?: string, postedDate?: string): number | undefined {
  if (postedDate) {
    const parsed = new Date(postedDate);
    if (!isNaN(parsed.getTime())) {
      const diffMs = Date.now() - parsed.getTime();
      return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }
  }

  if (!postedRelative) return undefined;

  const text = postedRelative.toLowerCase().trim();

  if (text.includes("today") || text.includes("just now") || text.includes("hours")) {
    return 0;
  }
  if (text.includes("yesterday") || text.includes("1 day")) {
    return 1;
  }

  // Days match: "posted 4 days ago", "4d ago", "4 days"
  const daysMatch = text.match(/(\d+)\s*(?:d|day|days)/);
  if (daysMatch) {
    return parseInt(daysMatch[1], 10);
  }

  // Weeks match: "posted 3 weeks ago", "3w ago"
  const weeksMatch = text.match(/(\d+)\s*(?:w|week|weeks)/);
  if (weeksMatch) {
    return parseInt(weeksMatch[1], 10) * 7;
  }

  // Months match: "posted 2 months ago", "2m ago"
  const monthsMatch = text.match(/(\d+)\s*(?:m|month|months)/);
  if (monthsMatch) {
    return parseInt(monthsMatch[1], 10) * 30;
  }

  return undefined;
}

/**
 * Formats time elapsed since a timestamp ISO string.
 */
export function formatTimeElapsed(isoTimestamp?: string): string {
  if (!isoTimestamp) return "recently";
  const date = new Date(isoTimestamp);
  if (isNaN(date.getTime())) return "recently";

  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) return "less than an hour ago";
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
}

/**
 * Evaluates opportunity freshness without modifying quality scores or decisions.
 */
export function evaluateFreshness(params: {
  postedRelative?: string;
  postedDate?: string;
  postedPrecision?: "EXACT" | "RELATIVE_ESTIMATE" | "LOWER_BOUND" | "UNKNOWN" | null;
  scrapedAt?: string;
  scrapedFrom?: string;
}): FreshnessMetadata {
  const portal = params.scrapedFrom || "Workday";
  const ageDays = parsePostingAgeDays(params.postedRelative, params.postedDate);

  let state: FreshnessState = "UNKNOWN";
  let isStale = false;
  let staleWarning: string | undefined = undefined;
  let postedDateDisplay = "";

  if (ageDays !== undefined) {
    if (ageDays <= 7) {
      state = "FRESH";
      postedDateDisplay = ageDays === 0 ? `Posted today · ${portal}` : `Posted ${ageDays} day${ageDays > 1 ? 's' : ''} ago · ${portal}`;
    } else if (ageDays <= 21) {
      state = "RECENT";
      postedDateDisplay = `Posted ${ageDays} days ago · ${portal}`;
    } else if (ageDays <= 45) {
      state = "AGING";
      postedDateDisplay = `Posted ${ageDays} days ago · ${portal}`;
    } else {
      state = "STALE";
      isStale = true;
      postedDateDisplay = `Posted ${ageDays} days ago · ${portal}`;
      staleWarning = `Posted ${ageDays} days ago — verify that the role is still active before investing heavily.`;
    }
  } else if (params.postedRelative && params.postedRelative.trim().length > 0 && params.postedRelative !== "Age unavailable") {
    postedDateDisplay = `${params.postedRelative} · ${portal}`;
    state = "RECENT";
  } else {
    state = "UNKNOWN";
    const scrapedText = formatTimeElapsed(params.scrapedAt);
    postedDateDisplay = `Age unavailable · Last scraped ${scrapedText}`;
  }

  return {
    state,
    postedDateDisplay,
    scrapedAtDisplay: params.scrapedAt ? `Last scraped ${formatTimeElapsed(params.scrapedAt)}` : undefined,
    sourcePortalDisplay: portal,
    ageInDays: ageDays,
    staleWarning,
    isStale,
    precision: params.postedPrecision || "UNKNOWN",
  };
}
