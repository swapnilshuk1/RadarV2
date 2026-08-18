import { anchor, missing, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";
import type { DimensionExtractor, RawExtraction, NormalizedFact } from "../../../../src/lib/recommendation/DimensionExtractor";

export enum CommercialCategory {
  PL_OWNERSHIP = "PL_OWNERSHIP",
  BUDGET = "BUDGET",
  REVENUE = "REVENUE",
  EBITDA = "EBITDA",
  GENERAL = "GENERAL",
  NONE = "NONE"
}

export const extractorVersion = "2.1.0";
export const normalizerVersion = "1.0.0";

const DISQUALIFIERS = [
  /\b(?:budget owner support|support the budget|collaborate with budget|report to the budget|assist with budget|inputs? for the budget)\b/i,
  /\b(?:sales enablement|revenue operations|customer success|retention campaigns|net promoter score)\b/i,
  /\b(?:analyze|understand) (?:p&l|financial statements|ebitda)\b/i,
];

const PATTERN_RULES = [
  // P&L
  {
    category: CommercialCategory.PL_OWNERSHIP,
    rx: /\bp&l\s+(?:ownership|responsibility|accountability|management|size|targets?|goals?|of|exceeding)(?:\s*(?:of|up to|exceeding)?\s*([$€£]?[\d.,]+\s?[bmk]?))?\b/i,
    confidence: 1.0
  },
  {
    category: CommercialCategory.PL_OWNERSHIP,
    rx: /\bown(?:s|ership)?\s+(?:the\s+)?(?:top[- ]line|bottom[- ]line|p&l)\b/i,
    confidence: 1.0
  },
  // Budget
  {
    category: CommercialCategory.BUDGET,
    rx: /\b(?:managing|annual|operating|capital)?\s*budget\s+(?:authority|ownership|responsibility|allocation|size|of|exceeding)(?:\s*(?:of|up to|exceeding)?\s*([$€£]?[\d.,]+\s?[bmk]?))?\b/i,
    confidence: 0.90
  },
  // Revenue
  {
    category: CommercialCategory.REVENUE,
    rx: /\b(?:carry(?:ing)?|quota|revenue|sales)\s+(?:target|responsibility|accountability|quota|goals?)(?:\s*(?:of|up to|exceeding)?\s*([$€£]?[\d.,]+\s?[bmk]?))?\b/i,
    confidence: 0.85
  },
  // EBITDA
  {
    category: CommercialCategory.EBITDA,
    rx: /\bebitda\s+(?:responsibility|targets?|goals?|objectives?)(?:\s*(?:of|up to|exceeding)?\s*([$€£]?[\d.,]+\s?[bmk]?))?\b/i,
    confidence: 0.80
  },
  // General Commercial
  {
    category: CommercialCategory.GENERAL,
    rx: /\bcommercial\s+(?:accountability|responsibility|growth strategy|performance)\b/i,
    confidence: 0.60
  }
];

export class CommercialAccountabilityExtractor implements DimensionExtractor<CommercialCategory> {
  name = "commercialAccountability";
  extractorVersion = extractorVersion;
  normalizerVersion = normalizerVersion;

  extract(input: { title: string; snippet: string; detailText: string }): RawExtraction | null {
    const start = performance.now();
    const rawText = [input.snippet, input.detailText].filter(Boolean).join("\n");
    
    const matches: string[] = [];
    const matchedCategories = new Set<CommercialCategory>();
    let rawPhrase = "";
    let matchedPhrase = "";
    let matchedSnippet = "";

    for (const s of scanSentences(rawText)) {
      let disqualified = false;
      for (const dq of DISQUALIFIERS) {
        if (s.match(dq)) {
          disqualified = true;
          break;
        }
      }
      if (disqualified) continue;

      for (const rule of PATTERN_RULES) {
        const m = s.match(rule.rx);
        if (m) {
          matchedCategories.add(rule.category);
          matches.push(m[0]);
          if (!matchedPhrase) {
            rawPhrase = m[1] ? m[1].trim() : m[0].trim();
            matchedPhrase = m[0].trim();
            matchedSnippet = s.trim();
          }
        }
      }
    }

    const end = performance.now();
    const latencyMs = Number((end - start).toFixed(3));

    if (matches.length === 0) {
      return null;
    }

    return {
      rawValue: rawPhrase,
      evidenceSnippet: matchedSnippet,
      latencyMs,
      matches,
      ambiguity: matchedCategories.size > 1
    };
  }

  normalize(raw: RawExtraction): NormalizedFact<CommercialCategory> | null {
    // Normalization logic uses the matched phrase or rule categories
    const matchedCategories: CommercialCategory[] = [];
    for (const match of raw.matches) {
      for (const rule of PATTERN_RULES) {
        if (match.match(rule.rx)) {
          if (!matchedCategories.includes(rule.category)) {
            matchedCategories.push(rule.category);
          }
        }
      }
    }

    if (matchedCategories.length === 0) {
      return null;
    }

    const bestCategory = matchedCategories[0];
    
    // Confidence mapping
    let confidence = 0.60;
    if (bestCategory === CommercialCategory.PL_OWNERSHIP) confidence = 1.0;
    else if (bestCategory === CommercialCategory.BUDGET) confidence = 0.90;
    else if (bestCategory === CommercialCategory.REVENUE) confidence = 0.85;
    else if (bestCategory === CommercialCategory.EBITDA) confidence = 0.80;

    return {
      canonicalValue: bestCategory,
      confidence,
      rawValue: raw.rawValue,
      metadata: {
        rawPhrase: raw.rawValue,
        canonical: bestCategory
      }
    };
  }
}

export const commercialExtractorInstance = new CommercialAccountabilityExtractor();

// Backwards compatibility wrapper for extractor registry
export function extractCommercial(input: { title: string; snippet: string; detailText: string }): Anchored<string> {
  const raw = commercialExtractorInstance.extract(input);
  if (!raw) return missing<string>();
  const norm = commercialExtractorInstance.normalize(raw);
  if (!norm) return missing<string>();
  // Re-map value to category for compatibility
  const cleanValue = String(norm.canonicalValue || norm.rawValue || "COMMERCIAL").trim();
  return anchor(cleanValue, raw.evidenceSnippet, raw.rawValue, "snippet");
}

export const commercialExtractorId = `commercialAccountability@${extractorVersion}`;
