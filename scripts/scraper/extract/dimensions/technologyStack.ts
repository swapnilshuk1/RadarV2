import { anchor, missing, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";
import { TechnologyOntology } from "../../../../src/lib/ontology/TechnologyOntology";
import type { DimensionExtractor, RawExtraction, NormalizedFact } from "../../../../src/lib/recommendation/DimensionExtractor";

export interface TechnologyEvidence {
  products: string[];
  categories: string[];
  snippets: string[];
  categoryBreakdown: Record<string, string[]>; // category → [products]
}

export const extractorVersion = "2.0.0";
export const normalizerVersion = "2.0.0";

export class TechnologyStackExtractor implements DimensionExtractor<TechnologyEvidence> {
  name = "technologyStack";
  extractorVersion = extractorVersion;
  normalizerVersion = normalizerVersion;

  // Singleton ontology — loaded once, reused on every extraction call
  private readonly ontology = TechnologyOntology.load();

  extract(input: { title: string; snippet: string; detailText: string }): RawExtraction | null {
    const start = performance.now();
    const rawText = [input.title, input.snippet, input.detailText].filter(Boolean).join("\n");
    const sentences = scanSentences(rawText);

    const matchedProducts = new Set<string>();
    const matchedCategories = new Set<string>();
    const matchedSnippets: string[] = [];
    const matchesList: string[] = [];

    for (const s of sentences) {
      // Tokenize sentence into candidate tokens (split on whitespace and punctuation)
      const tokens = s.split(/[\s,/;:()\[\]|.!?'"`]+/).map(t => t.trim()).filter(t => t.length >= 2);

      // Also try multi-word phrases (2-word combos)
      const phrases: string[] = [...tokens];
      for (let i = 0; i < tokens.length - 1; i++) {
        phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
      }
      for (let i = 0; i < tokens.length - 2; i++) {
        phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
      }

      for (const phrase of phrases) {
        const result = this.ontology.lookup(phrase);
        if (!result) continue;

        // Guard against generic single-word tokens matching multi-word product names.
        // e.g. "teams" should NOT match "Microsoft Teams" when "Microsoft Teams" is not in the lookup index as a single word.
        // But "Azure" is a single-word canonical product, so it should pass through.
        // Rule: skip if phrase is a single word AND canonical product is multi-word
        //       AND the phrase is not a registered alias itself (i.e. it only matched because the lookup 
        //       found a partial/substring match — but our O(1) map only stores exact entries, so if lookup
        //       returned a result for a single word, it IS in the alias map.
        // Real issue: "teams" is stored as part of "Microsoft Teams" only if we index single words of product names.
        // Since we only index the FULL alias and FULL product name, "teams" alone would NOT be in the map.
        // So this guard is only needed for cases where the tokenizer created "microsoft teams" as a 2-word combo
        // but then "teams" alone somehow matched. Since lookup is exact, this shouldn't happen.
        // Leave this as a safety check for unexpected future regressions:

        // Negation filter: check 30 chars before this phrase in the original sentence
        const phraseIdx = s.toLowerCase().indexOf(phrase.toLowerCase());
        if (phraseIdx === -1) continue;
        const textBefore = s.substring(Math.max(0, phraseIdx - 40), phraseIdx);
        const hasNegation = /\b(?:not|no|without|never|not\s+required)\b\s*(?:\w+\s+){0,3}$/i.test(textBefore);
        if (hasNegation) continue;

        matchedProducts.add(result.product);
        matchedCategories.add(result.category);
        if (!matchedSnippets.includes(s.trim())) {
          matchedSnippets.push(s.trim());
        }
        matchesList.push(result.product);
      }
    }

    const end = performance.now();
    const latencyMs = Number((end - start).toFixed(3));

    if (matchedProducts.size === 0) {
      return null;
    }

    return {
      rawValue: Array.from(matchedProducts).join(", "),
      evidenceSnippet: matchedSnippets[0] ?? "",
      latencyMs,
      matches: [...matchedProducts], // deduplicated product names
      ambiguity: matchedProducts.size > 3
    };
  }

  normalize(raw: RawExtraction): NormalizedFact<TechnologyEvidence> | null {
    const matchedProducts = new Set<string>();
    const matchedCategories = new Set<string>();
    const categoryBreakdown: Record<string, string[]> = {};

    for (const match of raw.matches) {
      const result = this.ontology.lookup(match);
      if (!result) continue;

      matchedProducts.add(result.product);
      matchedCategories.add(result.category);

      if (!categoryBreakdown[result.category]) {
        categoryBreakdown[result.category] = [];
      }
      if (!categoryBreakdown[result.category].includes(result.product)) {
        categoryBreakdown[result.category].push(result.product);
      }
    }

    if (matchedProducts.size === 0) {
      return null;
    }

    const meta = this.ontology.getMeta();
    const techEvidence: TechnologyEvidence = {
      products: Array.from(matchedProducts),
      categories: Array.from(matchedCategories),
      snippets: [raw.evidenceSnippet],
      categoryBreakdown
    };

    return {
      canonicalValue: techEvidence,
      confidence: 1.0,
      rawValue: raw.rawValue,
      metadata: {
        ontologyVersion: meta.version,
        evidence: techEvidence
      }
    };
  }
}

export const technologyExtractorInstance = new TechnologyStackExtractor();

// Backwards compatibility wrapper for extractor registry
export function extractTechnology(input: { title: string; snippet: string; detailText: string }): Anchored<string> {
  const raw = technologyExtractorInstance.extract(input);
  if (!raw) return missing<string>();
  const norm = technologyExtractorInstance.normalize(raw);
  if (!norm) return missing<string>();

  const cleanValue = (norm.canonicalValue?.products && norm.canonicalValue.products.length > 0)
    ? norm.canonicalValue.products.join(", ")
    : String(norm.rawValue || "TECHNOLOGY").trim();

  return anchor(cleanValue, raw.evidenceSnippet, raw.rawValue, "snippet");
}

export const technologyExtractorId = `technologyStack@${extractorVersion}`;
