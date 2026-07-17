import { anchor, missing, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";

const STACK_PATTERNS: { value: string; rx: RegExp }[] = [
  { value: "Salesforce", rx: /\bsalesforce\b/i },
  { value: "HubSpot", rx: /\bhubspot\b/i },
  { value: "Adobe", rx: /\b(adobe|marketo|aem)\b/i },
  { value: "Braze", rx: /\bbraze\b/i },
  { value: "Segment", rx: /\bsegment\b/i },
  { value: "SFMC", rx: /\b(sfmc|salesforce marketing cloud)\b/i },
];

export function extractTechnologyStack(input: { snippet: string; detailText: string }): Anchored<string> {
  const rawText = [input.snippet, input.detailText].filter(Boolean).join("\n");
  for (const s of scanSentences(rawText)) {
    for (const p of STACK_PATTERNS) {
      const m = s.match(p.rx);
      if (m) return anchor(p.value, rawText, m[0], "snippet");
    }
  }
  return missing<string>();
}

export const technologyStackExtractorId = "technologyStack@1.0.0";
