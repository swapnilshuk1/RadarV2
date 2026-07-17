import { anchor, missing, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";

const REPORTING_PATTERNS = [
  /\b(?:will\s+)?reports?\s+(?:directly\s+)?(?:in)?to\s+the\s+([A-Z][A-Za-z ]{2,40})\b/,
  /\breporting\s+(?:in)?to\s+the\s+([A-Z][A-Za-z ]{2,40})\b/,
  /\bdotted\s+line\s+(?:in)?to\s+the\s+([A-Z][A-Za-z ]{2,40})\b/,
  /\bn[-\s]?1\s+to\s+the\s+(ceo|coo|cfo|cmo|cto|board)\b/i,
];

const KNOWN_ROLES = /\b(ceo|coo|cfo|cmo|cto|cpo|cro|cio|chro|board|president|managing director|md)\b/i;

export function extractReportingLine(input: { title: string; snippet: string; detailText: string }): Anchored<string> {
  const rawText = [input.snippet, input.detailText].filter(Boolean).join("\n");
  for (const s of scanSentences(rawText)) {
    for (const rx of REPORTING_PATTERNS) {
      const m = s.match(rx);
      if (m && m[1]) {
        const target = m[1].trim();
        // Reject if it looks like a person name rather than a role/title.
        if (!KNOWN_ROLES.test(target) && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(target)) continue;
        return anchor(target, rawText, m[0], "snippet");
      }
    }
  }
  return missing<string>();
}

export const reportingLineExtractorId = "reportingLine@1.0.0";
