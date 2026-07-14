import { anchor, missing, hasDisqualifierNear, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";

const MANDATE_PATTERNS: { lifecycle: string; rx: RegExp }[] = [
  { lifecycle: "Greenfield",     rx: /\b(build\s+from\s+scratch|0[- ]to[- ]1|greenfield|stand\s+up\s+the)\b/i },
  { lifecycle: "Scale",          rx: /\b(scale\s+from|scale\s+the\s+(?:business|team|org)|10x|hyperscale)\b/i },
  { lifecycle: "Transformation", rx: /\b(digital transformation|business transformation|operating model redesign|modernize)\b/i },
  { lifecycle: "Turnaround",     rx: /\b(turnaround|restructur\w+|reset\s+the|stabilize)\b/i },
  { lifecycle: "Integration",    rx: /\bpost[- ]merger integration|m&a integration|pmi\b/i },
];

const DISQUALIFIERS = [/\bmaintain the status quo\b/i, /\bcaretaker role\b/i];

export function extractMandate(input: { title: string; snippet: string; detailText: string }): Anchored<string> {
  const rawText = [input.snippet, input.detailText].filter(Boolean).join("\n");
  for (const s of scanSentences(rawText)) {
    for (const p of MANDATE_PATTERNS) {
      const m = s.match(p.rx);
      if (m && !hasDisqualifierNear(rawText, m[0], DISQUALIFIERS)) {
        return anchor(p.lifecycle, rawText, m[0], "snippet");
      }
    }
  }
  return missing<string>();
}

export const mandateExtractorId = "mandate@1.0.0";
