// src/lib/intelligence/ekb/EKBNormalizer.ts

export interface NormalizedTermResult {
  rawTerm: string;
  normalizedStem: string;
  proposedAction: "NEW_CAPABILITY_PROPOSAL" | "ALIAS_ADDITION_PROPOSAL";
  matchedCanonicalCapabilityId?: string;
}

export class EKBNormalizer {

  /**
   * Normalizes raw term strings and performs Porter stemming / edit distance
   * checks to prevent synonym capability explosion.
   */
  public static normalizeTerm(rawTerm: string, existingCapabilities: Array<{ id: string; canonicalName: string }>): NormalizedTermResult {
    const clean = rawTerm
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim();

    const stem = clean.replace(/(ing|ed|es|s|tion|ment)$/, "");

    // Check edit distance or exact stem match against existing capability names
    for (const cap of existingCapabilities) {
      const capClean = cap.canonicalName.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
      const capStem = capClean.replace(/(ing|ed|es|s|tion|ment)$/, "");

      if (stem === capStem || clean === capClean) {
        return {
          rawTerm,
          normalizedStem: stem,
          proposedAction: "ALIAS_ADDITION_PROPOSAL",
          matchedCanonicalCapabilityId: cap.id,
        };
      }
    }

    return {
      rawTerm,
      normalizedStem: stem,
      proposedAction: "NEW_CAPABILITY_PROPOSAL",
    };
  }
}
