/** Canonical boundary between a transport response and a usable job document. */
import type { FailureClass } from "./failure-taxonomy";
import type {
  AcquisitionQuality,
  DocumentExtractionState,
  DocumentTransportState,
  DocumentUsabilityState,
  ValidatedJobDocument,
} from "../domain/canonical_acquisition";

export type { AcquisitionQuality, ValidatedJobDocument };
export type ValidationConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNUSABLE";

export interface JobDocumentValidationInput {
  html?: string;
  extractedText?: string;
  url: string;
  finalUrl?: string;
  sourcePortal: string;
  sourceJobId?: string;
  httpStatus?: number;
  contentType?: string | null;
  extractedTitle?: string;
  extractedCompany?: string;
  extractedLocation?: string;
  expectedTitle?: string;
  expectedCompany?: string;
  /** A discovery-card fallback is not a captured JD, even when it has a title and company. */
  contentOrigin?: "DETAIL_DOCUMENT" | "DISCOVERY_CARD_FALLBACK";
  provenance?: ValidatedJobDocument["provenance"];
}

export interface ValidationResult {
  isValid: boolean;
  quality: AcquisitionQuality;
  confidence: ValidationConfidence;
  failureClass?: FailureClass;
  extractedTitle?: string;
  extractedCompany?: string;
  extractedDescription?: string;
  extractedLocation?: string;
  document: ValidatedJobDocument;
}

const NON_JOB_PATTERNS = [
  /job searching just got simpler/i, /search jobs filters/i, /we want to work with you/i,
  /this website is based on the successfactors/i, /please enable cookies/i, /access denied/i,
  /attention required! \| cloudflare/i, /verify you are human/i, /sign in to continue/i,
  /log in to your account/i, /fill out this form to start the conversation/i,
];
const SCRIPT_PATTERNS = [
  /var\s+queuedSuperProps/i, /window\.ub\s*=/i, /\(function\(\)\s*\{/i,
  /var\s+faviconUrl\s*=/i, /<iframe\s+src=/i, /googletagmanager\.com/i,
  /rmkcdn\.successfactors\.com/i,
];

function agreement(expected?: string, actual?: string): "MATCHED" | "MISMATCHED" | "UNKNOWN" {
  if (!expected || !actual) return "UNKNOWN";
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = clean(expected), b = clean(actual);
  return a === b || a.includes(b) || b.includes(a) ? "MATCHED" : "MISMATCHED";
}

function invalid(input: JobDocumentValidationInput, detail: {
  transportState: DocumentTransportState; extractionState: DocumentExtractionState;
  failureClass: FailureClass; retryable: boolean; text?: string;
  wordCount?: number; boilerplateRatio?: number; scriptRatio?: number; quality?: AcquisitionQuality;
}): ValidationResult {
  const text = detail.text || "";
  const title = input.extractedTitle?.trim() || null;
  const company = input.extractedCompany?.trim() || null;
  const document: ValidatedJobDocument = {
    source: input.sourcePortal, sourceJobId: input.sourceJobId, canonicalUrl: input.url,
    finalUrl: input.finalUrl || input.url, contentType: input.contentType || null,
    transportState: detail.transportState, extractionState: detail.extractionState,
    usabilityState: "UNUSABLE", acquisitionQuality: detail.quality || "INVALID", title, company,
    location: input.extractedLocation?.trim() || null,
    titleAgreement: agreement(input.expectedTitle, title || undefined),
    companyAgreement: agreement(input.expectedCompany, company || undefined),
    substantiveWordCount: detail.wordCount || 0, substantiveCharacterCount: text.length,
    boilerplateRatio: detail.boilerplateRatio || 0, scriptRatio: detail.scriptRatio || 0,
    failureClass: detail.failureClass, retryable: detail.retryable, extractedText: null,
    provenance: input.provenance || "HTTP",
  };
  return { isValid: false, quality: document.acquisitionQuality,
    confidence: document.acquisitionQuality === "MINIMAL" ? "LOW" : "UNUSABLE", failureClass: detail.failureClass,
    extractedTitle: title || undefined, extractedCompany: company || undefined,
    extractedLocation: document.location || undefined, document };
}

/** Returns a typed outcome for every response. It never treats raw PDF bytes as JD text. */
export function validateJobDocument(input: JobDocumentValidationInput): ValidationResult {
  const html = input.html || "";
  const text = (input.extractedText || "").replace(/\s+/g, " ").trim();
  const contentType = (input.contentType || "").toLowerCase();
  const isPdf = contentType.includes("application/pdf") || /^%PDF-/i.test(text);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  const codeChars = (text.match(/[{};=()<>]/g) || []).length;
  const scriptMatches = SCRIPT_PATTERNS.filter((pattern) => pattern.test(text) || pattern.test(html)).length;
  const boilerplateMatches = NON_JOB_PATTERNS.filter((pattern) => pattern.test(text) || pattern.test(html)).length;
  const scriptRatio = text.length ? codeChars / text.length : 0;
  const boilerplateRatio = words.length ? boilerplateMatches / words.length : 0;
  const failure = (transportState: DocumentTransportState, extractionState: DocumentExtractionState, failureClass: FailureClass, retryable: boolean) =>
    invalid(input, { transportState, extractionState, failureClass, retryable, text, wordCount: words.length, boilerplateRatio, scriptRatio });

  if (input.httpStatus === 404) return failure("FAILED", "NOT_ATTEMPTED", "REMOVED_404", false);
  // A non-success HTTP response is acquisition evidence, never a job document.
  // In particular, access-denied and verification pages often contain enough
  // text to otherwise look like a genuinely sparse specification.
  if (input.httpStatus === 401) return failure("FAILED", "NOT_ATTEMPTED", "LOGIN_REQUIRED", false);
  if (input.httpStatus === 403) return failure("FAILED", "NOT_ATTEMPTED", "BOT_CHALLENGE_BLOCK", false);
  if (input.httpStatus === 429) return failure("FAILED", "NOT_ATTEMPTED", "RATE_LIMIT_429", true);
  if (input.httpStatus !== undefined && input.httpStatus >= 500) {
    return failure("FAILED", "NOT_ATTEMPTED", "HTTP_SERVER_ERROR", true);
  }
  if ((input.httpStatus !== undefined && input.httpStatus >= 300 && input.httpStatus < 400) || ((input.finalUrl && input.finalUrl !== input.url) && !text)) return failure("REDIRECTED", "NOT_ATTEMPTED", "UNRESOLVED_REDIRECT", true);
  if (isPdf) return failure("SUCCEEDED", "PENDING", "UNEXTRACTED_PDF", true);
  if ((html.toLowerCase().includes("cloudflare") && (html.toLowerCase().includes("attention required") || html.toLowerCase().includes("cf-challenge"))) || /verify you are human|captcha-delivery/i.test(html)) return failure("FAILED", "NOT_ATTEMPTED", "BOT_CHALLENGE_BLOCK", false);
  if (/sign in to linkedin|login\.naukri\.com|naukri\.com\/nlogin\/login/i.test(html)) return failure("FAILED", "NOT_ATTEMPTED", "LOGIN_REQUIRED", false);
  if (scriptMatches > 0 || boilerplateMatches > 0 || (scriptRatio > 0.12 && words.length < 150)) return failure("SUCCEEDED", "FAILED", "WRONG_PAGE", true);
  if (!text) return failure("SUCCEEDED", "FAILED", "EMPTY_CONTENT", true);
  if (input.contentOrigin === "DISCOVERY_CARD_FALLBACK") return invalid(input, {
    transportState: "SUCCEEDED", extractionState: "FAILED", failureClass: "PARTIAL_CONTENT", retryable: true,
    text, wordCount: words.length, boilerplateRatio, scriptRatio, quality: "MINIMAL",
  });
  // A portal card/snippet is not a sparse job document. It is incomplete
  // acquisition and must be recovered rather than evaluated as a real JD.
  if (/\b(search card|snippet|preview|short summary|too short)\b/i.test(text)) return invalid(input, {
    transportState: "SUCCEEDED", extractionState: "FAILED", failureClass: "PARTIAL_CONTENT", retryable: true,
    text, wordCount: words.length, boilerplateRatio, scriptRatio, quality: "MINIMAL",
  });

  const quality: AcquisitionQuality = text.length >= 500 ? "COMPLETE" : text.length >= 200 ? "PARTIAL" : "MINIMAL";
  const usabilityState: DocumentUsabilityState = quality === "MINIMAL" ? "GENUINELY_SPARSE" : "SUBSTANTIVE";
  const title = input.extractedTitle?.trim() || null;
  const company = input.extractedCompany?.trim() || null;
  const confidence: ValidationConfidence = quality === "COMPLETE" && title && company ? "HIGH" : quality === "MINIMAL" ? "LOW" : "MEDIUM";
  const document: ValidatedJobDocument = {
    source: input.sourcePortal, sourceJobId: input.sourceJobId, canonicalUrl: input.url,
    finalUrl: input.finalUrl || input.url, contentType: input.contentType || null,
    transportState: "SUCCEEDED", extractionState: "EXTRACTED", usabilityState, acquisitionQuality: quality,
    title, company, location: input.extractedLocation?.trim() || null,
    titleAgreement: agreement(input.expectedTitle, title || undefined), companyAgreement: agreement(input.expectedCompany, company || undefined),
    substantiveWordCount: words.length, substantiveCharacterCount: text.length, boilerplateRatio, scriptRatio,
    failureClass: quality === "MINIMAL" ? "PARTIAL_CONTENT" : null, retryable: quality === "MINIMAL",
    extractedText: text, provenance: input.provenance || "HTTP",
  };
  return { isValid: quality !== "MINIMAL", quality, confidence, failureClass: (document.failureClass || undefined) as FailureClass | undefined,
    extractedTitle: title || undefined, extractedCompany: company || undefined, extractedDescription: text,
    extractedLocation: document.location || undefined, document };
}

/** Compatibility facade. New acquisition code uses validateJobDocument directly. */
export class ResponseValidator {
  static validate(payload: {
    html: string; url: string; sourcePortal: string; httpStatus?: number; contentType?: string | null; finalUrl?: string;
    extractedTitle?: string; extractedCompany?: string; extractedDescription?: string; extractedLocation?: string;
  }): ValidationResult {
    return validateJobDocument({ html: payload.html, extractedText: payload.extractedDescription, url: payload.url,
      finalUrl: payload.finalUrl, sourcePortal: payload.sourcePortal, httpStatus: payload.httpStatus,
      contentType: payload.contentType, extractedTitle: payload.extractedTitle, extractedCompany: payload.extractedCompany,
      extractedLocation: payload.extractedLocation });
  }
}
