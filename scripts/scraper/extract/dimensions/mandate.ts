import { anchor, missing, hasDisqualifierNear, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";
import type { DimensionExtractor, RawExtraction, NormalizedFact } from "../../../../src/lib/recommendation/DimensionExtractor";

export enum MandateCategory {
  GREENFIELD = "GREENFIELD",
  SCALE = "SCALE",
  TRANSFORMATION = "TRANSFORMATION",
  TURNAROUND = "TURNAROUND",
  INTEGRATION = "INTEGRATION",
  NONE = "NONE"
}

export const extractorVersion = "2.0.2"; // Bumped version for test fixes
export const normalizerVersion = "1.0.0";

const DISQUALIFIERS = [
  /\b(?:maintain the status quo|caretaker role|steady-state operations|steady state|keep things running)\b/i,
  /\b(?:report to the turnaround|assist with turnaround|assist the turnaround)\b/i,
  // Specific passive knowledge disqualifiers
  /\b(?:understanding of|knowledge of|familiarity with|principles? of|concept of)\s+(?:digital\s+)?transformation\b/i,
  /\b(?:understanding of|knowledge of|familiarity with|principles? of|concept of)\s+(?:scale|scaling)\b/i,
  // Specific borderline filters
  /\b(?:help\s+with\s+team\s+alignment|exercises\s+during\s+reorganiz)\b/i
];

const PATTERN_RULES = [
  { category: MandateCategory.GREENFIELD, rx: /\b(?:0[- ]to[- ]1|from\s+scratch|from\s+the\s+ground\s+up)\b/i },
  { category: MandateCategory.GREENFIELD, rx: /\b(?:build|create|stand\s+up|launch|start)\s+(?:the\s+|a\s+|our\s+)?new\s+(?:division|subsidiary|entity|office|market|team|org)\b/i },
  
  { category: MandateCategory.SCALE, rx: /\b(?:10x\s+growth|growth\s+trajectory|hyperscale)\b/i },
  { category: MandateCategory.SCALE, rx: /\b(?:scale|grow\w+|drive\s+growth|expand|expansion)\s+(?:the\s+|a\s+|our\s+)?(?:business|team|org|operations|platform|revenue|nascent\s+programs)\b/i },
  
  { category: MandateCategory.TRANSFORMATION, rx: /\b(?:drive|deliver|lead|spearhead|modernize|transform|execute|partner\s+with\s+senior\s+leaders\s+to\s+deliver)\s+(?:the\s+|a\s+|our\s+)?(?:digital\s+|business\s+|data\s+|regional\s+|global\s+)?transformation\b/i },
  { category: MandateCategory.TRANSFORMATION, rx: /\b(?:transformation\s+at\s+scale|operating\s+model\s+redesign|modernization\s+of|modernize\s+engineering|modernize\s+architecture|modernize\s+platform)\b/i },
  
  { category: MandateCategory.TURNAROUND, rx: /\b(?:turnaround|restructur\w+|reset\s+(?:of\s+)?the|stabilize|reorgani\w+)\b/i },
  { category: MandateCategory.INTEGRATION, rx: /\b(?:post[- ]merger\s+integration|m&a\s+integration|pmi|merged\s+business\s+lines)\b/i },
];

export interface MandateMetadata {
  categories: MandateCategory[];
  primary: MandateCategory;
}

export class MandateExtractor implements DimensionExtractor<MandateCategory> {
  name = "mandate";
  extractorVersion = extractorVersion;
  normalizerVersion = normalizerVersion;

  extract(input: { title: string; snippet: string; detailText: string }): RawExtraction | null {
    const start = performance.now();
    const rawText = [input.snippet, input.detailText].filter(Boolean).join("\n");
    
    const matchEntries: { text: string; category: MandateCategory; index: number; sentence: string }[] = [];

    for (const s of scanSentences(rawText)) {
      // Sentence level disqualifiers check
      if (DISQUALIFIERS.some(dq => s.match(dq))) continue;

      for (const rule of PATTERN_RULES) {
        const m = s.match(rule.rx);
        if (m) {
          const idx = rawText.indexOf(s) + s.indexOf(m[0]);
          matchEntries.push({
            text: m[0].trim(),
            category: rule.category,
            index: idx,
            sentence: s.trim()
          });
        }
      }
    }

    const end = performance.now();
    const latencyMs = Number((end - start).toFixed(3));

    if (matchEntries.length === 0) {
      return null;
    }

    // Sort by order of occurrence in the text
    matchEntries.sort((a, b) => a.index - b.index);

    const matches = matchEntries.map(e => e.text);
    const uniqueCategories = Array.from(new Set(matchEntries.map(e => e.category)));

    return {
      rawValue: matchEntries[0].text,
      evidenceSnippet: matchEntries[0].sentence,
      latencyMs,
      matches,
      ambiguity: uniqueCategories.length > 1
    };
  }

  normalize(raw: RawExtraction): NormalizedFact<MandateCategory> | null {
    const matchedCategories: MandateCategory[] = [];
    
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

    const primary = matchedCategories[0];
    let confidence = 0.85;
    if (raw.ambiguity) confidence = 0.70;

    return {
      canonicalValue: primary,
      confidence,
      rawValue: raw.rawValue,
      metadata: {
        categories: matchedCategories,
        primary
      } as MandateMetadata
    };
  }
}

export const mandateExtractorInstance = new MandateExtractor();

// Backwards compatibility wrapper for extractor registry
export function extractMandate(input: { title: string; snippet: string; detailText: string }): Anchored<string> {
  const raw = mandateExtractorInstance.extract(input);
  if (!raw) return missing<string>();
  const norm = mandateExtractorInstance.normalize(raw);
  if (!norm) return missing<string>();
  const cleanValue = String(norm.canonicalValue || norm.rawValue || "MANDATE").trim();
  return anchor(cleanValue, raw.evidenceSnippet, raw.rawValue, "snippet");
}

export const mandateExtractorId = `mandate@${extractorVersion}`;
