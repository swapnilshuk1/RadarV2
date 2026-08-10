/**
 * src/lib/acquisition/validator.ts
 * 
 * Standalone Acquisition Response Validation Module.
 * Decouples transport success (HTTP 200 / DOM loaded) from content quality.
 */

import type { FailureClass } from "./failure-taxonomy";

export type AcquisitionQuality = "COMPLETE" | "PARTIAL" | "DEGRADED" | "INVALID";
export type ValidationConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNUSABLE";

export interface ValidationResult {
  isValid: boolean;
  quality: AcquisitionQuality;
  confidence: ValidationConfidence;
  failureClass?: FailureClass;
  extractedTitle?: string;
  extractedCompany?: string;
  extractedDescription?: string;
  extractedLocation?: string;
}

export class ResponseValidator {
  static validate(payload: {
    html: string;
    url: string;
    sourcePortal: string;
    httpStatus?: number;
    extractedTitle?: string;
    extractedCompany?: string;
    extractedDescription?: string;
  }): ValidationResult {
    // 1. HTTP Status Checks
    if (payload.httpStatus === 404) {
      return { isValid: false, quality: "INVALID", confidence: "UNUSABLE", failureClass: "REMOVED_404" };
    }
    if (payload.httpStatus === 429) {
      return { isValid: false, quality: "INVALID", confidence: "UNUSABLE", failureClass: "RATE_LIMIT_429" };
    }

    const html = (payload.html || "").toLowerCase();

    // 2. Anti-Bot / CAPTCHA / Challenge Page Detection
    if (
      (html.includes("cloudflare") && (html.includes("attention required") || html.includes("cf-challenge"))) ||
      html.includes("verify you are human") ||
      html.includes("captcha-delivery")
    ) {
      return { isValid: false, quality: "INVALID", confidence: "UNUSABLE", failureClass: "BOT_CHALLENGE_BLOCK" };
    }

    // 3. Login Wall Detection
    if (
      html.includes("sign in to linkedin") ||
      html.includes("login.naukri.com") ||
      html.includes("naukri.com/nlogin/login")
    ) {
      return { isValid: false, quality: "INVALID", confidence: "UNUSABLE", failureClass: "LOGIN_REQUIRED" };
    }

    // 4. Length & Shell Validation
    const desc = payload.extractedDescription || "";
    const descLen = desc.trim().length;

    if (descLen === 0 && html.length < 300) {
      return { isValid: false, quality: "INVALID", confidence: "UNUSABLE", failureClass: "EMPTY_CONTENT" };
    }

    // 5. Title & Company Presence Validation
    const title = payload.extractedTitle?.trim() || "";
    const company = payload.extractedCompany?.trim() || "";

    if (!title && !company && descLen < 200) {
      return { isValid: false, quality: "DEGRADED", confidence: "LOW", failureClass: "PARTIAL_CONTENT" };
    }

    // 6. Quality & Confidence Rating
    if (descLen >= 500 && title && company) {
      return {
        isValid: true,
        quality: "COMPLETE",
        confidence: "HIGH",
        extractedTitle: title,
        extractedCompany: company,
        extractedDescription: desc
      };
    }

    if (descLen >= 200 || title || company) {
      return {
        isValid: true,
        quality: "PARTIAL",
        confidence: "MEDIUM",
        extractedTitle: title,
        extractedCompany: company,
        extractedDescription: desc
      };
    }

    return {
      isValid: true,
      quality: "DEGRADED",
      confidence: "LOW",
      extractedTitle: title,
      extractedCompany: company,
      extractedDescription: desc
    };
  }
}
