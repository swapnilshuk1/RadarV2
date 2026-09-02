import { request, Agent } from "undici";
import * as cheerio from "cheerio";
import type {
  AcquisitionOutcome,
  ContentQualityResult,
  ContentQualityTier
} from "../types";

// Global keep-alive agent to reuse TLS handshakes across concurrent detail requests.
const agent = new Agent({
  keepAliveTimeout: 10,
  keepAliveMaxTimeout: 10,
  connections: 50,
});

export interface HttpFetchResult {
  fetched: boolean;
  rawHtml?: string;
  rawText?: string;
  extractedTitle?: string;
  extractedCompany?: string;
  fetchError?: string;
  fetchDurationMs?: number;
  httpStatus?: number;
  outcome: AcquisitionOutcome;
  qualityTier?: ContentQualityTier;
  extractionMethod?: "JSON_LD" | "TARGETED_DOM" | "SANITIZED_DOM" | "FALLBACK_CARD";
  qualityResult?: ContentQualityResult;
}

const NON_JOB_BOILERPLATE_PATTERNS = [
  /job searching just got simpler/i,
  /search jobs filters/i,
  /we want to work with you/i,
  /cookie information welcome to the/i,
  /this website is based on the successfactors/i,
  /please enable cookies/i,
  /access denied/i,
  /attention required! \| cloudflare/i,
  /verify you are human/i,
  /sign in to continue/i,
  /log in to your account/i
];

const CODE_OR_SCRIPT_PATTERNS = [
  /var\s+queuedSuperProps/i,
  /window\.ub\s*=/i,
  /\(function\(\)\s*\{/i,
  /var\s+faviconUrl\s*=/i,
  /<iframe\s+src=/i,
  /googletagmanager\.com/i,
  /rmkcdn\.successfactors\.com/i
];

/**
 * Evaluates extracted text for job-substance vs boilerplate or script remnants.
 */
export function evaluateContentQuality(
  text: string,
  title?: string,
  company?: string
): ContentQualityResult {
  const clean = (text || "").trim();
  const characterCount = clean.length;
  const words = clean.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const reasons: string[] = [];
  const boilerplateDetected: string[] = [];

  // 1. Script & code pollution detection
  let codeMatches = 0;
  for (const pat of CODE_OR_SCRIPT_PATTERNS) {
    if (pat.test(clean)) {
      codeMatches++;
      boilerplateDetected.push(`CodePattern: ${pat.source}`);
    }
  }

  // Check code syntax symbols ratio: { } ; = ( ) < >
  const codeChars = (clean.match(/[{};=()<>]/g) || []).length;
  const codeRatio = characterCount > 0 ? codeChars / characterCount : 0;

  if (codeMatches > 0 || codeRatio > 0.12) {
    reasons.push(`Executable code or tracking script detected (codeRatio=${(codeRatio * 100).toFixed(1)}%, codePatterns=${codeMatches})`);
  }

  // 2. Non-job boilerplate patterns
  for (const pat of NON_JOB_BOILERPLATE_PATTERNS) {
    if (pat.test(clean)) {
      boilerplateDetected.push(`Boilerplate: ${pat.source}`);
      reasons.push(`Known non-job boilerplate detected: ${pat.source}`);
    }
  }

  // 3. Check presence of job indicators
  const hasJobTitle = title ? clean.toLowerCase().includes(title.toLowerCase()) : false;
  const hasResponsibilities = /responsibilities|requirements|qualifications|about the role|what you will do|impact|who you are/i.test(clean);
  const hasJobDescription = hasResponsibilities || wordCount >= 80;

  // 4. Determine Tier
  let tier: ContentQualityTier = "VALID";
  let confidence = 0.9;

  if (codeMatches > 0 || boilerplateDetected.length > 0 || (codeRatio > 0.12 && wordCount < 150)) {
    tier = "NON_JOB";
    confidence = 0.95;
    reasons.push("Classified as NON_JOB due to script pollution or boilerplate dominance");
  } else if (wordCount < 60 || characterCount < 400) {
    tier = "SPARSE";
    confidence = 0.7;
    reasons.push(`Classified as SPARSE (wordCount=${wordCount}, characterCount=${characterCount})`);
  } else {
    tier = "VALID";
    confidence = 0.9;
    reasons.push(`Substantive job content validated (${wordCount} words, ${characterCount} chars)`);
  }

  return {
    tier,
    confidence,
    wordCount,
    characterCount,
    codeRatio,
    hasJobTitle,
    hasJobDescription,
    boilerplateDetected: boilerplateDetected.length > 0 ? boilerplateDetected : undefined,
    reasons
  };
}

/**
 * Extracts and validates schema.org JobPosting JSON-LD.
 * Returns clean content if valid, or null if missing/invalid.
 */
export function extractValidatedJsonLd(html: string): {
  rawHtml: string;
  rawText: string;
  title?: string;
  company?: string;
} | null {
  try {
    const $ = cheerio.load(html);
    const jsonLdScripts = $("script[type='application/ld+json']");
    if (!jsonLdScripts.length) return null;

    for (let i = 0; i < jsonLdScripts.length; i++) {
      const scriptContent = $(jsonLdScripts[i]).html();
      if (!scriptContent) continue;

      let parsed: any;
      try {
        parsed = JSON.parse(scriptContent);
      } catch {
        continue;
      }

      const items = Array.isArray(parsed)
        ? parsed
        : parsed["@graph"] && Array.isArray(parsed["@graph"])
        ? parsed["@graph"]
        : [parsed];

      for (const item of items) {
        if (item["@type"] === "JobPosting") {
          const descHtml = item.description || "";
          const title = (item.title || "").trim();
          const company = (item.hiringOrganization?.name || "").trim();

          // Validation: substantive description (>=100 chars), title present
          if (descHtml.length >= 100 && title.length > 0) {
            // Strip HTML from description for rawText
            const $desc = cheerio.load(descHtml);
            const descText = $desc.text().replace(/\s+/g, " ").trim();

            if (descText.length >= 100) {
              const rawText = [title, company, descText].filter(Boolean).join("\n\n");
              return {
                rawHtml: descHtml,
                rawText,
                title,
                company
              };
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Multi-stage HTML extractor:
 * Tier 1: Validated JSON-LD JobPosting
 * Tier 2: Sanitized DOM with Targeted Cascading Selectors
 * Tier 3: Content-Quality & Boilerplate Gate
 */
export function extractJobFromHtml(
  html: string,
  requiredSelector?: string,
  customTextSelector?: string,
  expectedTitle?: string,
  expectedCompany?: string
): {
  success: boolean;
  rawHtml: string;
  rawText: string;
  extractedTitle?: string;
  extractedCompany?: string;
  method: "JSON_LD" | "TARGETED_DOM" | "SANITIZED_DOM";
  quality: ContentQualityResult;
  outcome: AcquisitionOutcome;
  error?: string;
} {
  // --- Tier 1: Validated JSON-LD ---
  const jsonLdResult = extractValidatedJsonLd(html);
  if (jsonLdResult) {
    const quality = evaluateContentQuality(jsonLdResult.rawText, expectedTitle || jsonLdResult.title, expectedCompany || jsonLdResult.company);
    if (quality.tier !== "NON_JOB") {
      return {
        success: true,
        rawHtml: jsonLdResult.rawHtml,
        rawText: jsonLdResult.rawText,
        extractedTitle: jsonLdResult.title,
        extractedCompany: jsonLdResult.company,
        method: "JSON_LD",
        quality,
        outcome: "SUCCESS"
      };
    }
  }

  // --- Tier 2: Sanitized Cheerio DOM ---
  const $ = cheerio.load(html);

  // Extract topcard company and title before sanitization/stripping
  const topcardCompanyText = $(
    "a.topcard__org-name-link, a.top-card-layout__first-subline-link, .job-details-jobs-unified-top-card__company-name, .topcard__flavor:first-of-type, .topcard__org-name, [data-company-name], .company-name"
  ).first().text().replace(/\s+/g, " ").trim();
  const extractedCompany = topcardCompanyText || jsonLdResult?.company || undefined;

  const topcardTitleText = $(
    "h1.top-card-layout__title, h1.topcard__title, .job-details-jobs-unified-top-card__job-title, h1"
  ).first().text().replace(/\s+/g, " ").trim();
  const extractedTitle = topcardTitleText || jsonLdResult?.title || undefined;

  if (requiredSelector) {
    const req = $(requiredSelector);
    if (!req.length) {
      return {
        success: false,
        rawHtml: "",
        rawText: "",
        extractedTitle,
        extractedCompany,
        method: "TARGETED_DOM",
        quality: {
          tier: "NON_JOB",
          confidence: 1.0,
          wordCount: 0,
          characterCount: 0,
          codeRatio: 0,
          hasJobTitle: false,
          hasJobDescription: false,
          reasons: [`Required selector "${requiredSelector}" not found (Auth wall / Captcha / Redirect)`]
        },
        outcome: "AUTH_ERROR",
        error: `Required selector "${requiredSelector}" not found`
      };
    }
  }

  // MANDATORY: Remove non-content, tracking, script, style, and navigation tags
  $("script, style, noscript, iframe, svg, nav, footer, header, [class*='cookie'], [id*='cookie'], [class*='consent'], [id*='consent'], [class*='banner'], [id*='banner']").remove();

  // Targeted cascading selectors in priority order
  const TARGETED_SELECTORS = [
    customTextSelector,
    "[itemprop='description']",
    ".job-desc",
    "#job-description",
    ".job-description",
    "[class*='job-desc']",
    "[class*='jobDescription']",
    "[id*='jobDescription']",
    "[class*='job_description']",
    "article",
    "main",
    "[role='main']",
    "#content",
    ".content"
  ].filter(Boolean) as string[];

  let matchedElement: cheerio.Cheerio<any> | null = null;
  let extractionMethod: "TARGETED_DOM" | "SANITIZED_DOM" = "TARGETED_DOM";

  for (const selector of TARGETED_SELECTORS) {
    const el = $(selector);
    if (el.length) {
      // Find element with greatest text length among matches
      let bestEl = el.first();
      let bestLen = bestEl.text().replace(/\s+/g, " ").trim().length;

      el.each((_, item) => {
        const itemLen = $(item).text().replace(/\s+/g, " ").trim().length;
        if (itemLen > bestLen) {
          bestLen = itemLen;
          bestEl = $(item);
        }
      });

      if (bestLen >= 150) {
        matchedElement = bestEl;
        extractionMethod = "TARGETED_DOM";
        break;
      }
    }
  }

  // Fallback to body ONLY after strict tag stripping and non-content removal
  if (!matchedElement) {
    const bodyEl = $("body");
    const bodyText = bodyEl.text().replace(/\s+/g, " ").trim();
    if (bodyText.length >= 150) {
      matchedElement = bodyEl;
      extractionMethod = "SANITIZED_DOM";
    }
  }

  if (!matchedElement) {
    return {
      success: false,
      rawHtml: "",
      rawText: "",
      extractedTitle,
      extractedCompany,
      method: "SANITIZED_DOM",
      quality: {
        tier: "NON_JOB",
        confidence: 0.9,
        wordCount: 0,
        characterCount: 0,
        codeRatio: 0,
        hasJobTitle: false,
        hasJobDescription: false,
        reasons: ["No targeted or sanitized DOM content found with >= 150 characters"]
      },
      outcome: "EXTRACTION_FAILURE",
      error: "Content too short or empty after sanitation"
    };
  }

  const rawHtml = matchedElement.html() || "";
  const rawText = matchedElement.text().replace(/\s+/g, " ").trim();

  // --- Tier 3: Content-Quality & Boilerplate Gate ---
  const quality = evaluateContentQuality(rawText, expectedTitle, expectedCompany);

  if (quality.tier === "NON_JOB") {
    return {
      success: false,
      rawHtml,
      rawText,
      extractedTitle,
      extractedCompany,
      method: extractionMethod,
      quality,
      outcome: "EXTRACTION_FAILURE",
      error: `Sanitized content rejected by quality gate: ${quality.reasons.join("; ")}`
    };
  }

  return {
    success: true,
    rawHtml,
    rawText,
    extractedTitle,
    extractedCompany,
    method: extractionMethod,
    quality,
    outcome: "SUCCESS"
  };
}

/**
 * Executes a robust HTTP fetch with Undici and multi-stage extraction.
 */
export async function fastFetchDetail(
  url: string,
  requiredSelector?: string,
  textSelector?: string,
  customHeaders?: Record<string, string>,
  expectedTitle?: string,
  expectedCompany?: string
): Promise<HttpFetchResult> {
  const t0 = Date.now();
  let attempts = 0;

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    ...(customHeaders || {})
  };

  while (attempts < 3) {
    attempts++;
    try {
      const { statusCode, body } = await request(url, {
        dispatcher: agent,
        headers,
      });

      if (statusCode === 429) {
        if (attempts < 3) {
          await new Promise((r) => setTimeout(r, (attempts * 1000) + Math.random() * 500));
          continue;
        }
        return {
          fetched: false,
          fetchError: "HTTP 429 (Rate limited)",
          fetchDurationMs: Date.now() - t0,
          httpStatus: 429,
          outcome: "ANTI_BOT"
        };
      }

      if (statusCode === 401 || statusCode === 403) {
        return {
          fetched: false,
          fetchError: `HTTP ${statusCode} (Forbidden / Auth Wall)`,
          fetchDurationMs: Date.now() - t0,
          httpStatus: statusCode,
          outcome: "AUTH_ERROR"
        };
      }

      if (statusCode >= 500) {
        if (attempts < 3) {
          await new Promise((r) => setTimeout(r, (attempts * 1000) + Math.random() * 500));
          continue;
        }
        return {
          fetched: false,
          fetchError: `HTTP ${statusCode} (Server Error)`,
          fetchDurationMs: Date.now() - t0,
          httpStatus: statusCode,
          outcome: "TRANSPORT_ERROR"
        };
      }

      if (statusCode < 200 || statusCode >= 400) {
        return {
          fetched: false,
          fetchError: `HTTP ${statusCode}`,
          fetchDurationMs: Date.now() - t0,
          httpStatus: statusCode,
          outcome: "TRANSPORT_ERROR"
        };
      }

      const html = await body.text();
      const extracted = extractJobFromHtml(html, requiredSelector, textSelector, expectedTitle, expectedCompany);

      if (!extracted.success) {
        return {
          fetched: false,
          fetchError: extracted.error,
          fetchDurationMs: Date.now() - t0,
          httpStatus: statusCode,
          outcome: extracted.outcome,
          qualityTier: extracted.quality.tier,
          qualityResult: extracted.quality,
          extractionMethod: extracted.method
        };
      }

      return {
        fetched: true,
        rawHtml: extracted.rawHtml,
        rawText: extracted.rawText,
        extractedTitle: extracted.extractedTitle,
        extractedCompany: extracted.extractedCompany,
        fetchDurationMs: Date.now() - t0,
        httpStatus: statusCode,
        outcome: "SUCCESS",
        qualityTier: extracted.quality.tier,
        qualityResult: extracted.quality,
        extractionMethod: extracted.method
      };
    } catch (err: any) {
      if (attempts < 3 && err.code && (err.code === "ECONNRESET" || err.code === "ETIMEDOUT")) {
        await new Promise((r) => setTimeout(r, (attempts * 1000) + Math.random() * 500));
        continue;
      }
      const isTimeout = err.name === "TimeoutError" || err.code === "ETIMEDOUT";
      return {
        fetched: false,
        fetchError: err.message,
        fetchDurationMs: Date.now() - t0,
        outcome: isTimeout ? "TIMEOUT" : "TRANSPORT_ERROR"
      };
    }
  }

  return {
    fetched: false,
    fetchError: "Max retries exceeded",
    fetchDurationMs: Date.now() - t0,
    outcome: "TRANSPORT_ERROR"
  };
}

