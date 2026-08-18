/**
 * Safely truncates a string at a word boundary up to maxLen characters.
 */
export function truncateWordBoundary(str: string, maxLen: number = 60): string {
  if (!str) return "";
  const trimmed = str.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const sub = trimmed.slice(0, maxLen);
  const lastSpace = sub.lastIndexOf(" ");
  if (lastSpace > 20) {
    return sub.slice(0, lastSpace).replace(/[,.;:]$/, "") + "...";
  }
  return sub.replace(/[,.;:]$/, "") + "...";
}

/**
 * Cleans up raw ontology constants (e.g. PL_OWNERSHIP -> P&L Ownership, ON_SITE -> On-site)
 */
export function cleanOntologyConstants(val: string): string {
  if (!val) return "";
  let s = val
    .replace(/PL_OWNERSHIP/gi, "P&L Ownership")
    .replace(/GROWTH_EXPANSION/gi, "Growth Expansion")
    .replace(/SCALE_TRANSFORMATION/gi, "Scale Transformation")
    .replace(/FOUNDER_EXPOSURE/gi, "Founder Exposure")
    .replace(/CAREER_CAPITAL/gi, "Career Capital")
    .replace(/ON_SITE/gi, "On-site")
    .replace(/HYBRID/gi, "Hybrid")
    .replace(/REMOTE/gi, "Remote")
    .replace(/_/g, " ")
    .replace(/\s+&\s+/g, " and ")
    .trim();

  // Convert ALL-CAPS constant strings (e.g. "MARKETING STRATEGY") to Title Case
  if (/^[A-Z\s]+$/.test(s) && s.length > 3) {
    s = s.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
  }

  // Preserve standard executive acronyms
  s = s
    .replace(/\bPandl\b/gi, "P&L")
    .replace(/\bPandL\b/gi, "P&L")
    .replace(/\bP and L\b/gi, "P&L")
    .replace(/\bRandd\b/gi, "R&D")
    .replace(/\bMandA\b/gi, "M&A")
    .replace(/\bDando\b/gi, "D&O");

  return s;
}

/**
 * Unwraps raw stringified JSON extractor payloads (e.g. from technologyStack or mandate)
 * into clean, human-readable display values, stripping large snippets or metadata.
 */
export function unwrapEvidenceValue(raw: any): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "boolean") return raw ? "Required" : "Optional";
  if (Array.isArray(raw)) return raw.map((r) => unwrapEvidenceValue(r)).filter(Boolean).join(", ");

  let obj = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        obj = JSON.parse(trimmed);
      } catch {
        obj = null;
      }
    } else if (trimmed.startsWith("{") || trimmed.includes('"value":')) {
      // Truncated or malformed JSON string: safely extract value if present, else sanitize
      const match = trimmed.match(/"value"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        return cleanOntologyConstants(match[1]);
      }
      return "";
    } else {
      return cleanOntologyConstants(trimmed);
    }
  }

  if (typeof obj === "object" && obj !== null) {
    if (obj.rawValue && typeof obj.rawValue === "string" && !obj.rawValue.startsWith("{")) {
      return cleanOntologyConstants(obj.rawValue);
    }
    if (obj.value && typeof obj.value === "string" && !obj.value.startsWith("{")) {
      return cleanOntologyConstants(obj.value);
    }
    if (obj.canonicalValue) {
      if (typeof obj.canonicalValue === "string") {
        return cleanOntologyConstants(obj.canonicalValue);
      }
      if (typeof obj.canonicalValue === "object" && Array.isArray(obj.canonicalValue.products)) {
        return obj.canonicalValue.products.map((p: any) => cleanOntologyConstants(String(p))).join(", ");
      }
    }
    // Fall back to first readable string property if value/rawValue not found
    const stringVal = Object.values(obj).find((v) => typeof v === "string" && !v.startsWith("{") && !v.includes("extractorVersion"));
    if (stringVal) return cleanOntologyConstants(String(stringVal));
    return "";
  }

  if (typeof raw === "string") {
    return cleanOntologyConstants(raw);
  }
  return "";
}

/**
 * Compile-time boundary: Translates raw ESG ontology nodes and trace constants
 * into clean natural language concepts before passing to editorial presentation.
 * Ensures prose NEVER leaks raw JSON keys, ampersands in running text, or generic placeholders.
 */
import { ExecutiveKnowledgeNormalizationPipeline } from "../ekb/ExecutiveKnowledgeNormalizationPipeline";

export class SemanticNaturalLanguageResolver {
  public static resolveCapabilities(caps: string[]): string {
    if (!caps || caps.length === 0) {
      console.warn("[EDITORIAL DEFECT] Suppressed generic capability fallback for empty capability list");
      return "";
    }

    // Convert flat list of capability strings to expected pipeline dimension format for clean backwards compatibility
    const mockDimensions = caps.map((c) => ({
      key: "functionalScope",
      jdEvidence: { value: c }
    }));

    const normalized = ExecutiveKnowledgeNormalizationPipeline.normalize(mockDimensions);
    const resolvedList = normalized.map((c) => c.label);

    if (resolvedList.length === 0) {
      console.warn("[EDITORIAL DEFECT] Suppressed generic capability fallback due to unresolvable capability strings");
      return "";
    }

    return resolvedList.join(", ");
  }

  public static resolveIdentity(identityValue: string): string {
    if (!identityValue) return "Commercial and Marketing Leadership";
    const unwrapped = unwrapEvidenceValue(identityValue);
    return unwrapped
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }
}
