/**
 * src/lib/acquisition/canonical-identity.ts
 * 
 * Canonical Job Identity Resolution Subsystem.
 * Strips transient tracking parameters and resolves job cards to deterministic,
 * stable canonical IDs using a 3-tier hierarchy:
 * 1. STABLE_JOB_ID (HIGH confidence)
 * 2. URL_FINGERPRINT (MEDIUM confidence)
 * 3. CONTENT_HASH (LOW confidence)
 */

import crypto from "crypto";

export type IdentityMethod = "STABLE_JOB_ID" | "URL_FINGERPRINT" | "CONTENT_HASH";
export type IdentityConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface CanonicalIdentity {
  canonicalJobId: string;      // e.g. "linkedin:4450224496", "naukri:300826001234", "indeed:jk_829c871d"
  sourcePortal: string;        // "LinkedIn" | "Naukri" | "Indeed"
  sourceJobId: string;         // e.g. "4450224496"
  canonicalUrl: string;        // Parameter-stripped clean URL
  identityMethod: IdentityMethod;
  identityConfidence: IdentityConfidence;
}

/**
 * Strips tracking parameters from job posting URLs.
 */
export function stripTrackingParams(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    const urlObj = new URL(rawUrl);
    const paramsToKeep = new Set(["jk", "jobId", "data-jk", "k"]); // Keep structural query params if needed
    
    const keys = Array.from(urlObj.searchParams.keys());
    for (const key of keys) {
      if (
        key.startsWith("utm_") ||
        key.startsWith("ref") ||
        key.startsWith("tracking") ||
        key === "eBP" ||
        key === "trk" ||
        key === "l" ||
        key === "start" ||
        key === "position" ||
        key === "pageNum"
      ) {
        urlObj.searchParams.delete(key);
      }
    }
    return urlObj.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.split("?")[0].replace(/\/$/, "");
  }
}

/**
 * Resolves a raw job card or URL into a canonical identity.
 */
export function resolveCanonicalIdentity(input: {
  portal: string;
  url: string;
  title: string;
  companyName: string;
  rawJobId?: string;
}): CanonicalIdentity {
  const portal = input.portal.trim();
  const cleanUrl = stripTrackingParams(input.url || "");

  // 1. Check for explicit rawJobId from portal card dataset
  if (input.rawJobId && input.rawJobId.trim().length > 3) {
    const cleanId = input.rawJobId.trim().replace(/^jk_/, "");
    return {
      canonicalJobId: `${portal.toLowerCase()}:${cleanId}`,
      sourcePortal: portal,
      sourceJobId: cleanId,
      canonicalUrl: cleanUrl,
      identityMethod: "STABLE_JOB_ID",
      identityConfidence: "HIGH"
    };
  }

  // 2. Portal-Specific URL Regex Extraction (Tier 1: STABLE_JOB_ID)
  if (portal.toLowerCase() === "linkedin") {
    // Matches /jobs/view/4450224496 or currentJobId=4450224496
    const viewMatch = cleanUrl.match(/\/jobs\/view\/(\d+)/i) || cleanUrl.match(/currentJobId=(\d+)/i);
    if (viewMatch && viewMatch[1]) {
      const jobId = viewMatch[1];
      return {
        canonicalJobId: `linkedin:${jobId}`,
        sourcePortal: "LinkedIn",
        sourceJobId: jobId,
        canonicalUrl: `https://www.linkedin.com/jobs/view/${jobId}`,
        identityMethod: "STABLE_JOB_ID",
        identityConfidence: "HIGH"
      };
    }
  }

  if (portal.toLowerCase() === "indeed") {
    // Matches ?jk=829c871daddf233a or /viewjob?jk=829c871daddf233a
    const jkMatch = cleanUrl.match(/[?&]jk=([a-f0-9]+)/i) || cleanUrl.match(/\/rc\/clk\?jk=([a-f0-9]+)/i);
    if (jkMatch && jkMatch[1]) {
      const jobId = jkMatch[1];
      return {
        canonicalJobId: `indeed:jk_${jobId}`,
        sourcePortal: "Indeed",
        sourceJobId: jobId,
        canonicalUrl: `https://in.indeed.com/viewjob?jk=${jobId}`,
        identityMethod: "STABLE_JOB_ID",
        identityConfidence: "HIGH"
      };
    }
  }

  if (portal.toLowerCase() === "naukri") {
    // Matches naukri.com/...-jobs-12345678 or job-tuples data-job-id="12345678"
    const naukriMatch = cleanUrl.match(/-(\d{10,14})(?:\?|$)/) || cleanUrl.match(/job-id-(\d{10,14})/);
    if (naukriMatch && naukriMatch[1]) {
      const jobId = naukriMatch[1];
      return {
        canonicalJobId: `naukri:${jobId}`,
        sourcePortal: "Naukri",
        sourceJobId: jobId,
        canonicalUrl: cleanUrl,
        identityMethod: "STABLE_JOB_ID",
        identityConfidence: "HIGH"
      };
    }
  }

  // 3. URL Fingerprint (Tier 2: URL_FINGERPRINT)
  if (cleanUrl && cleanUrl.length > 10) {
    const urlHash = crypto.createHash("sha256").update(cleanUrl.toLowerCase()).digest("hex").slice(0, 16);
    return {
      canonicalJobId: `${portal.toLowerCase()}:url_${urlHash}`,
      sourcePortal: portal,
      sourceJobId: urlHash,
      canonicalUrl: cleanUrl,
      identityMethod: "URL_FINGERPRINT",
      identityConfidence: "MEDIUM"
    };
  }

  // 4. Content Hash Fallback (Tier 3: CONTENT_HASH)
  const normTitle = input.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normCompany = input.companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const contentHash = crypto.createHash("sha256").update(`${normTitle}|${normCompany}`).digest("hex").slice(0, 16);

  return {
    canonicalJobId: `${portal.toLowerCase()}:content_${contentHash}`,
    sourcePortal: portal,
    sourceJobId: contentHash,
    canonicalUrl: cleanUrl || `https://${portal.toLowerCase()}.com/job/${contentHash}`,
    identityMethod: "CONTENT_HASH",
    identityConfidence: "LOW"
  };
}
