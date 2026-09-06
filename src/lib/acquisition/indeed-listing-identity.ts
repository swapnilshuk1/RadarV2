/**
 * Indeed listing identity is intentionally narrower than URL normalization.
 * Sponsored URLs are observations; only an Indeed /viewjob URL with a stable
 * `jk` parameter may identify a canonical opportunity.
 */
export const MAX_INDEED_LISTING_REDIRECT_HOPS = 5;

const INDEED_LISTING_ID = /^[a-z0-9_-]{4,128}$/i;

export interface VerifiedIndeedListingIdentity {
  sourceJobId: string;
  canonicalJobId: string;
  canonicalUrl: string;
  resolvedUrl: string;
}

export function parseVerifiedIndeedListingUrl(rawUrl: string): VerifiedIndeedListingIdentity | undefined {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (!(host === "indeed.com" || host.endsWith(".indeed.com")) || url.pathname.toLowerCase() !== "/viewjob") {
      return undefined;
    }
    const sourceJobId = (url.searchParams.get("jk") || "").trim().toLowerCase();
    if (!INDEED_LISTING_ID.test(sourceJobId)) return undefined;
    return {
      sourceJobId,
      canonicalJobId: `indeed:jk_${sourceJobId}`,
      canonicalUrl: `https://in.indeed.com/viewjob?jk=${sourceJobId}`,
      resolvedUrl: url.toString(),
    };
  } catch {
    return undefined;
  }
}

export type IndeedResolutionFailure = "IDENTITY_UNRESOLVED" | "REDIRECT_HOP_LIMIT" | "UNSAFE_REDIRECT_DESTINATION";

export type IndeedResolutionResult =
  | { ok: true; identity: VerifiedIndeedListingIdentity; redirectHops: number }
  | { ok: false; failure: IndeedResolutionFailure; finalUrl?: string; redirectHops: number };

/**
 * Follows only explicitly supplied redirect locations. Runtime adapters must
 * use a no-auto-redirect request primitive, so the hop limit is enforcement,
 * not post-navigation telemetry.
 */
export async function resolveIndeedListingBounded(
  initialUrl: string,
  requestOnce: (url: string) => Promise<{ status: number; location?: string | null }>,
): Promise<IndeedResolutionResult> {
  let currentUrl = initialUrl;
  for (let redirectHops = 0; redirectHops <= MAX_INDEED_LISTING_REDIRECT_HOPS; redirectHops += 1) {
    const direct = parseVerifiedIndeedListingUrl(currentUrl);
    if (direct) return { ok: true, identity: direct, redirectHops };

    const response = await requestOnce(currentUrl);
    if (response.status < 300 || response.status >= 400 || !response.location) {
      return { ok: false, failure: "IDENTITY_UNRESOLVED", finalUrl: currentUrl, redirectHops };
    }
    if (redirectHops === MAX_INDEED_LISTING_REDIRECT_HOPS) {
      return { ok: false, failure: "REDIRECT_HOP_LIMIT", finalUrl: currentUrl, redirectHops: redirectHops + 1 };
    }
    let nextUrl: string;
    try {
      nextUrl = new URL(response.location, currentUrl).toString();
    } catch {
      return { ok: false, failure: "UNSAFE_REDIRECT_DESTINATION", finalUrl: currentUrl, redirectHops };
    }
    const host = new URL(nextUrl).hostname.toLowerCase();
    if (!(host === "indeed.com" || host.endsWith(".indeed.com"))) {
      return { ok: false, failure: "UNSAFE_REDIRECT_DESTINATION", finalUrl: nextUrl, redirectHops: redirectHops + 1 };
    }
    currentUrl = nextUrl;
  }
  return { ok: false, failure: "REDIRECT_HOP_LIMIT", finalUrl: currentUrl, redirectHops: MAX_INDEED_LISTING_REDIRECT_HOPS };
}
