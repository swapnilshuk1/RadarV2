import { anchor, missing, hasDisqualifierNear, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";

const TITLE_PATTERNS: { level: string; rx: RegExp }[] = [
  { level: "CxO",      rx: /\b(chief [a-z]+ officer|c[emgdorpft]o)\b/i },
  { level: "SVP",      rx: /\b(senior vice president|svp)\b/i },
  { level: "VP",       rx: /\b(vice president|vp of)\b/i },
  { level: "Head",     rx: /\bhead of\b/i },
  { level: "Director", rx: /\b(director|group director)\b/i },
];

const SNIPPET_CORROBORATION: { level: string; rx: RegExp }[] = [
  { level: "CxO", rx: /\b(member of the executive committee|c[- ]suite|reports to the (?:ceo|board))\b/i },
  { level: "SVP", rx: /\b(senior leadership team|slt member)\b/i },
  { level: "VP",  rx: /\b(vp[- ]level|executive leadership role)\b/i },
];

const DISQUALIFIERS = [
  /\bindividual contributor\b/i,
  /\bno direct reports?\b/i,
  /\badvisory only\b/i,
  /\bcontract(?:or)? role\b/i,
];

export interface RawInput {
  title: string;
  snippet: string;
  detailText: string;
}

export function extractRequiredLevel(input: RawInput): Anchored<string> {
  const rawTitle = input.title || "";
  const rawText = [input.title, input.snippet, input.detailText].filter(Boolean).join("\n");

  for (const p of TITLE_PATTERNS) {
    const m = rawTitle.match(p.rx);
    if (m && !hasDisqualifierNear(rawText, m[0], DISQUALIFIERS)) {
      return anchor(p.level, rawText, m[0], "title");
    }
  }
  // Snippet corroboration only when the title had no verbatim seniority marker.
  for (const s of scanSentences(rawText)) {
    for (const p of SNIPPET_CORROBORATION) {
      const m = s.match(p.rx);
      if (m && !hasDisqualifierNear(rawText, m[0], DISQUALIFIERS)) {
        return anchor(p.level, rawText, m[0], "snippet");
      }
    }
  }
  return missing<string>();
}

export const requiredLevelExtractorId = "requiredLevel@1.0.0";
