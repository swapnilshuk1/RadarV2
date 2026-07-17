import { anchor, missing, hasDisqualifierNear, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";

const COMMERCIAL_PATTERNS = [
  /\bp&l\s+(?:ownership|responsibility|accountability)\s+of\s+(\$?[\d.,]+\s?[bmk]?)\b/i,
  /\bown(?:s|ership)?\s+(?:the\s+)?(?:top[- ]line|bottom[- ]line|p&l)\b/i,
  /\brevenue\s+accountability\s+(?:for|of)\s+([\w &-]+)/i,
  /\bbudget\s+(?:authority|ownership)\s+of\s+(\$?[\d.,]+\s?[bmk]?)\b/i,
  /\bcarry(?:ing)?\s+the\s+number\b/i,
  /\bebitda\s+(?:ownership|responsibility|target)\b/i,
];

const DISQUALIFIERS = [
  /\bbudget owner support\b/i,
  /\bbudget input\b/i,
  /\brecommend budget\b/i,
];

export function extractCommercial(input: { title: string; snippet: string; detailText: string }): Anchored<string> {
  const rawText = [input.snippet, input.detailText].filter(Boolean).join("\n");
  for (const s of scanSentences(rawText)) {
    for (const rx of COMMERCIAL_PATTERNS) {
      const m = s.match(rx);
      if (m && !hasDisqualifierNear(rawText, m[0], DISQUALIFIERS)) {
        const value = m[1] ? m[1].trim() : "P&L Ownership";
        return anchor(value, rawText, m[0], "snippet");
      }
    }
  }
  return missing<string>();
}

export const commercialExtractorId = "commercialAccountability@1.0.0";
