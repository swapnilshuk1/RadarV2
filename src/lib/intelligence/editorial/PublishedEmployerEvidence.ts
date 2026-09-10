import type { DimensionResult } from "@/data/opportunity-fixtures";

export type DimensionEvaluation = DimensionResult;

const MANDATE_PATTERN = /\b(?:mandate|charter)\b/i;
const COMMERCIAL_PATTERN =
  /\b(?:own(?:s|ership)?\s+(?:the\s+)?(?:end-to-end\s+)?(?:p\s*&\s*l|profit\s+and\s+loss)|(?:p\s*&\s*l|profit\s+and\s+loss)\s+responsibilit(?:y|ies)|accountable\s+for\s+(?:revenue|profitability)|budget\s+ownership|commercial\s+accountability)\b/i;
const DECISION_AUTHORITY_PATTERN =
  /\b(?:final\s+decision|ultimate\s+sign-off|approve|budget\s+approval|executive\s+sign-off|autonomous\s+decision|hiring\s+authority)\b/i;
const WORK_MODEL_PATTERN =
  /\b(?:remote|hybrid|on[- ]?site|office[- ]?based|in\s+(?:the\s+)?office|work\s+from\s+(?:home|office)|(?:one|two|three|four|five|\d+)\s+days?\s+(?:a|per)\s+week\s+(?:in|at)\s+(?:the\s+)?office|office\s+(?:attendance|days?))\b/i;

const CLASSIFIER_METADATA_VALUES = new Set([
  "HYBRID",
  "REMOTE",
  "ON_SITE",
  "ONSITE",
  "IN_OFFICE",
  "SCALE",
  "ENTERPRISE",
  "PORTFOLIO",
  "FUNCTION",
  "ACCELERATE_GROWTH",
  "AUTONOMOUS",
  "GLOBAL_PNL",
  "BUSINESS_UNIT",
  "DIRECTOR",
  "VP",
  "CXO",
]);

function hasPatternQuote(dimension: DimensionResult, pattern: RegExp): boolean {
  const quotes = (dimension.jdEvidence?.evidence || [])
    .map((e) => (typeof e?.quote === "string" ? e.quote.trim() : ""))
    .filter((q) => q.length > 0 && !CLASSIFIER_METADATA_VALUES.has(q.toUpperCase()));

  if (quotes.some((q) => pattern.test(q))) {
    return true;
  }

  const value = typeof dimension.jdEvidence?.value === "string"
    ? dimension.jdEvidence.value.trim()
    : "";

  if (value.length > 0 && !CLASSIFIER_METADATA_VALUES.has(value.toUpperCase()) && pattern.test(value)) {
    return true;
  }

  return false;
}

export function sanitizePublishedEmployerDimensions(
  dimensions: DimensionResult[] = []
): DimensionResult[] {
  return dimensions.map((dimension) => {
    let requiresGroundedCheck = false;
    let pattern: RegExp | null = null;

    switch (dimension.key as string) {
      case "mandate":
        requiresGroundedCheck = true;
        pattern = MANDATE_PATTERN;
        break;
      case "commercialScope":
      case "commercialAccountability":
        requiresGroundedCheck = true;
        pattern = COMMERCIAL_PATTERN;
        break;
      case "decisionAuthority":
        requiresGroundedCheck = true;
        pattern = DECISION_AUTHORITY_PATTERN;
        break;
      case "workModel":
        requiresGroundedCheck = true;
        pattern = WORK_MODEL_PATTERN;
        break;
      default:
        requiresGroundedCheck = false;
        pattern = null;
        break;
    }

    if (!requiresGroundedCheck || !pattern) {
      return dimension;
    }

    const isGrounded = hasPatternQuote(dimension, pattern);
    if (isGrounded) {
      return dimension;
    }

    return {
      ...dimension,
      bucket: "Missing",
      jdEvidence: {
        status: "Missing",
        value: "",
        evidence: [],
      },
    };
  });
}
