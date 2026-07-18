import { anchor, missing, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";

const FUNCTION_PATTERNS: { value: string; rx: RegExp }[] = [
  { value: "Growth", rx: /\bgrowth\s+(?:marketing|strategy|team|leader)\b/i },
  { value: "Brand", rx: /\bbrand\s+(?:strategy|marketing|building)\b/i },
  { value: "Performance", rx: /\bperformance\s+marketing\b/i },
  { value: "CRM", rx: /\b(?:crm|salesforce|hubspot|marketing automation)\b/i },
  { value: "Product Marketing", rx: /\bproduct\s+marketing\b/i },
  { value: "Digital", rx: /\bdigital\s+marketing\b/i },
];

export function extractFunctionalScope(input: { title: string; snippet: string; detailText: string }): Anchored<string> {
  const rawText = [input.title, input.snippet, input.detailText].filter(Boolean).join("\n");
  for (const s of scanSentences(rawText)) {
    for (const p of FUNCTION_PATTERNS) {
      const m = s.match(p.rx);
      if (m) return anchor(p.value, rawText, m[0], "snippet");
    }
  }
  return missing<string>();
}

export const functionalScopeExtractorId = "functionalScope@1.0.0";
