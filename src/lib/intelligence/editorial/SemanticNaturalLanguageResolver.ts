/**
 * Unwraps raw stringified JSON extractor payloads (e.g. from technologyStack or mandate)
 * into clean, human-readable display values, stripping large snippets or metadata.
 */
export function unwrapEvidenceValue(raw: any): string {
  if (!raw) return "";
  if (typeof raw === "object") {
    if (typeof raw.value === "string" && !raw.value.startsWith("{")) return raw.value;
    if (raw.rawValue && typeof raw.rawValue === "string") return raw.rawValue;
    if (raw.canonicalValue) {
      if (typeof raw.canonicalValue === "string") return raw.canonicalValue;
      if (typeof raw.canonicalValue === "object" && Array.isArray(raw.canonicalValue.products)) {
        return raw.canonicalValue.products.join(", ");
      }
    }
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        return unwrapEvidenceValue(parsed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  return String(raw);
}

/**
 * Compile-time boundary: Translates raw ESG ontology nodes and trace constants
 * into clean natural language concepts before passing to editorial presentation.
 * Ensures prose NEVER leaks raw JSON keys or ontology constants.
 */
export class SemanticNaturalLanguageResolver {
  public static resolveCapabilities(caps: string[]): string {
    if (!caps || caps.length === 0) return "strategic growth & execution";

    const cleanedList = caps
      .map((c) => unwrapEvidenceValue(c))
      .map((c) => {
        let clean = c.replace(/PURPOSE_[A-Z_]+/g, "")
                     .replace(/fit\)/g, "")
                     .replace(/\([0-9]+%/g, "")
                     .replace(/_/g, " ")
                     .trim();
        if (clean.length === 0 || clean.length > 80) return "growth strategy";
        return clean.charAt(0).toUpperCase() + clean.slice(1);
      })
      .filter((v) => v.length > 0 && v.length <= 80)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 3);

    return cleanedList.length > 0 ? cleanedList.join(", ") : "strategic growth & execution";
  }

  public static resolveIdentity(identityValue: string): string {
    if (!identityValue) return "Commercial & Marketing Leadership";
    const unwrapped = unwrapEvidenceValue(identityValue);
    return unwrapped.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }

  public static resolveActionRecommendation(decision: "PURSUE" | "CONSIDER" | "PASS", role: string, company: string): string {
    if (decision === "PURSUE") {
      return `PURSUE — Submit direct application for ${role} at ${company} (Priority Executive Lead)`;
    }
    if (decision === "CONSIDER") {
      return `CONSIDER — Verify operating scope and reporting line at ${company} before applying`;
    }
    return `PASS — Mandate scope for ${role} does not align with target executive profile`;
  }
}
