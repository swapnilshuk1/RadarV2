/**
 * src/lib/acquisition/failure-taxonomy.ts
 * 
 * Formal Failure Taxonomy & Recovery Policy Engine for RADAR v2 Acquisition.
 */

export type FailureCategory = "TRANSPORT" | "ACCESS" | "CONTENT" | "IDENTITY" | "LIFECYCLE";

export type FailureClass =
  // TRANSPORT (Retryable with exponential backoff)
  | "HTTP_TIMEOUT"
  | "HTTP_SERVER_ERROR"
  | "NAVIGATION_TIMEOUT"
  | "DNS_ERROR"
  | "CONNECTION_ERROR"
  
  // ACCESS (Throttle / Context Reset / Session Alert)
  | "LOGIN_REQUIRED"
  | "CAPTCHA_CHALLENGE"
  | "RATE_LIMIT_429"
  | "BOT_CHALLENGE_BLOCK"
  
  // CONTENT (Transport Fallback / Secondary Selector Retry)
  | "EMPTY_CONTENT"
  | "WRONG_PAGE_REDIRECT"
  | "WRONG_PAGE"
  | "UNRESOLVED_REDIRECT"
  | "UNEXTRACTED_PDF"
  | "PARTIAL_CONTENT"
  | "INVALID_SCHEMA"
  
  // IDENTITY (Quarantine)
  | "MISSING_JOB_ID"
  | "AMBIGUOUS_IDENTITY"
  | "LISTING_DOCUMENT_IDENTITY_MISMATCH"
  
  // LIFECYCLE (Terminal)
  | "EXPIRED"
  | "REMOVED_404"
  | "PERMANENT_FAILURE";

export interface RecoveryAction {
  category: FailureCategory;
  failureClass: FailureClass;
  isTerminal: boolean;
  shouldRetry: boolean;
  backoffMs: number;
  resetBrowserContext: boolean;
  pausePortalQueue: boolean;
}

export class FailurePolicyEngine {
  static evaluate(failureClass: FailureClass, attemptCount = 1): RecoveryAction {
    switch (failureClass) {
      // TRANSPORT
      case "HTTP_TIMEOUT":
      case "HTTP_SERVER_ERROR":
      case "NAVIGATION_TIMEOUT":
      case "CONNECTION_ERROR":
      case "DNS_ERROR":
        return {
          category: "TRANSPORT",
          failureClass,
          isTerminal: attemptCount >= 3,
          shouldRetry: attemptCount < 3,
          backoffMs: Math.min(1000 * Math.pow(2, attemptCount), 30000),
          resetBrowserContext: attemptCount >= 2,
          pausePortalQueue: false
        };

      // ACCESS
      case "RATE_LIMIT_429":
        return {
          category: "ACCESS",
          failureClass,
          isTerminal: attemptCount >= 3,
          shouldRetry: attemptCount < 3,
          backoffMs: 60000,
          resetBrowserContext: true,
          pausePortalQueue: true
        };

      case "CAPTCHA_CHALLENGE":
      case "BOT_CHALLENGE_BLOCK":
      case "LOGIN_REQUIRED":
        return {
          category: "ACCESS",
          failureClass,
          isTerminal: true,
          shouldRetry: false,
          backoffMs: 0,
          resetBrowserContext: true,
          pausePortalQueue: true
        };

      // CONTENT
      case "EMPTY_CONTENT":
      case "PARTIAL_CONTENT":
      case "WRONG_PAGE_REDIRECT":
      case "WRONG_PAGE":
      case "UNRESOLVED_REDIRECT":
      case "UNEXTRACTED_PDF":
      case "INVALID_SCHEMA":
        return {
          category: "CONTENT",
          failureClass,
          isTerminal: attemptCount >= 2,
          shouldRetry: attemptCount < 2,
          backoffMs: 2000,
          resetBrowserContext: false,
          pausePortalQueue: false
        };

      // IDENTITY
      case "MISSING_JOB_ID":
      case "AMBIGUOUS_IDENTITY":
      case "LISTING_DOCUMENT_IDENTITY_MISMATCH":
        return {
          category: "IDENTITY",
          failureClass,
          isTerminal: true,
          shouldRetry: false,
          backoffMs: 0,
          resetBrowserContext: false,
          pausePortalQueue: false
        };

      // LIFECYCLE
      case "REMOVED_404":
      case "EXPIRED":
      case "PERMANENT_FAILURE":
      default:
        return {
          category: "LIFECYCLE",
          failureClass,
          isTerminal: true,
          shouldRetry: false,
          backoffMs: 0,
          resetBrowserContext: false,
          pausePortalQueue: false
        };
    }
  }
}
