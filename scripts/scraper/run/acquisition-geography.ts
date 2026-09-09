/**
 * scripts/scraper/run/acquisition-geography.ts
 *
 * Centralized Canonical Acquisition Geography Contract & Portal Identifier Registry.
 *
 * Invariants:
 * - Build canonical geography semantics first, then portal-specific mappings.
 * - City / Metro / State ontology semantics must apply uniformly to all locations.
 * - Portal identifiers (such as LinkedIn geo IDs) are centralized, versioned, and explicit.
 * - Unknown locations fail narrow: leave to native portal resolvers rather than silently widening.
 */

import { GeographyResolver } from "../../../src/lib/intelligence/semantic/resolvers/GeographyResolver";

export interface CanonicalGeography {
  readonly canonicalCity: string;
  readonly metroCluster: string;
  readonly state: string;
  readonly country: string;
  readonly isRemote: boolean;
}

export const LINKEDIN_GEO_INDIA = "102713980";

/**
 * Verified LinkedIn Geo IDs.
 * Resolved against LinkedIn's public search API and verified for city boundaries.
 */
export const LINKEDIN_GEO_BY_LOCATION: Readonly<Record<string, string>> = {
  // NCR Metros
  "gurugram": "106442238",
  "gurgaon": "106442238",
  "delhi": "106187582",
  "new delhi": "106187582",
  "noida": "104869687",
  "greater noida": "104869687",
  "faridabad": "100839447",
  "ghaziabad": "100497616",

  // Primary Tech Metros
  "bengaluru": "105214831",
  "bangalore": "105214831",
  "mumbai": "106164952",
  "bombay": "106164952",
  "navi mumbai": "106164952",
  "thane": "106164952",
  "pune": "103671728",
  "hyderabad": "105556991",
  "secunderabad": "105556991",
};

export function normalizeLocationKey(location: string): string {
  return location
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/,.*$/, "")
    .trim();
}

/**
 * Resolves a verified LinkedIn Geo ID for a given location.
 * - If location is empty or unspecified: returns India country Geo ID.
 * - If location matches a verified entry: returns that Geo ID.
 * - If location is unknown: returns undefined (leaving resolution to LinkedIn native search).
 */
export function resolveLinkedInGeoId(location?: string): string | undefined {
  if (!location?.trim()) return LINKEDIN_GEO_INDIA;
  const key = normalizeLocationKey(location);
  if (key === "india") return LINKEDIN_GEO_INDIA;
  return LINKEDIN_GEO_BY_LOCATION[key];
}

/**
 * Resolves portal-safe location string for Naukri search.
 */
export function resolveNaukriLocation(location?: string): string | undefined {
  if (!location?.trim()) return undefined;
  const key = normalizeLocationKey(location);
  if (key === "india") return undefined; // Naukri searches India by default
  return location.trim();
}

/**
 * Resolves portal-safe location and radius for Indeed search.
 */
export function resolveIndeedLocation(
  location?: string,
  radiusKm?: number
): { location?: string; radiusKm?: number } {
  if (!location?.trim()) return {};
  const key = normalizeLocationKey(location);
  if (key === "india") return {};
  return {
    location: location.trim(),
    radiusKm: radiusKm !== undefined ? radiusKm : undefined,
  };
}

/**
 * Resolves a raw location string into canonical geography semantics.
 */
export function resolveCanonicalGeography(rawLocation?: string): CanonicalGeography | null {
  if (!rawLocation?.trim()) return null;

  const isRemote = /\bremote\b/i.test(rawLocation);
  const mapping = GeographyResolver.getCanonicalCityMapping(rawLocation);
  if (mapping) {
    return {
      canonicalCity: mapping.canonicalCity,
      metroCluster: mapping.metroCluster || mapping.canonicalCity,
      state: mapping.state,
      country: mapping.country,
      isRemote,
    };
  }

  const res = GeographyResolver.resolve(rawLocation);
  if (!res || !res.canonicalLocation) return null;

  const isRemoteRes = res.canonicalLocation.includes("REMOTE");
  return {
    canonicalCity: res.canonicalLocation,
    metroCluster: res.canonicalLocation,
    state: "",
    country: "INDIA",
    isRemote: isRemote || isRemoteRes,
  };
}
