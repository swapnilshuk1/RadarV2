import { anchor, missing, type Anchored } from "../anchor";
import { scanSentences } from "../sentences";
import type { DimensionExtractor, RawExtraction, NormalizedFact } from "../../../../src/lib/recommendation/DimensionExtractor";

export enum ReportingHierarchy {
  BOARD = "BOARD",
  CEO = "CEO",
  EXECUTIVE_COMMITTEE = "EXECUTIVE_COMMITTEE",
  BU_HEAD = "BU_HEAD",
  FUNCTION_HEAD = "FUNCTION_HEAD",
  NONE = "NONE"
}

export const extractorVersion = "2.0.0";
export const normalizerVersion = "1.0.0";

const DISQUALIFIERS = [
  /\b(?:collaborate with|work closely with|present to|assist the|dotted line|align with)\b/i,
];

// Case-insensitive rules with spacing & parenthesis support in name capturing group
const REPORTING_RULES = [
  { rx: /\b(?:will\s+)?reports?\s+(?:directly\s+)?(?:in)?to\s+(?:the\s+)?([a-z][a-z &\/\s\(\)-]{2,50})\b/i },
  { rx: /\breporting\s+(?:directly\s+)?(?:in)?to\s+(?:the\s+)?([a-z][a-z &\/\s\(\)-]{2,50})\b/i },
  { rx: /\breporting\s+relationship\s*(?::|\bto\b)\s*(?:the\s+)?([a-z][a-z &\/\s\(\)-]{2,50})\b/i },
  { rx: /\breporting\s+line\s+to\s+(?:the\s+)?([a-z][a-z &\/\s\(\)-]{2,50})\b/i },
  { rx: /\baccountable\s+(?:directly\s+)?to\s+(?:the\s+)?([a-z][a-z &\/\s\(\)-]{2,50})\b/i },
  { rx: /\bdotted\s+line\s+(?:in)?to\s+(?:the\s+)?([a-z][a-z &\/\s\(\)-]{2,50})\b/i },
  { rx: /\bn[-\s]?1\s+to\s+(?:the\s+)?(ceo|coo|cfo|cmo|cto|board)\b/i },
  { rx: /\bdirect\s+reports?\s+to\s+(?:the\s+)?([a-z][a-z &\/\s\(\)-]{2,50})\b/i }
];

export interface ReportingMetadata {
  rawRole: string;
  canonical: ReportingHierarchy;
}

export class ReportingLineExtractor implements DimensionExtractor<ReportingHierarchy> {
  name = "reportingLine";
  extractorVersion = extractorVersion;
  normalizerVersion = normalizerVersion;

  extract(input: { title: string; snippet: string; detailText: string }): RawExtraction | null {
    const start = performance.now();
    const rawText = [input.snippet, input.detailText].filter(Boolean).join("\n");
    
    const matches: string[] = [];
    let firstSnippet = "";
    let firstRawValue = "";

    for (const s of scanSentences(rawText)) {
      let disqualified = false;
      for (const dq of DISQUALIFIERS) {
        if (s.match(dq) && !s.match(/\breports?\s+to\b/i) && !s.match(/\baccountable\s+to\b/i)) {
          disqualified = true;
          break;
        }
      }
      if (disqualified) continue;

      for (const rule of REPORTING_RULES) {
        const m = s.match(rule.rx);
        if (m) {
          const roleVal = m[1] ? m[1].trim() : m[0].trim();
          matches.push(roleVal);
          if (!firstRawValue) {
            firstRawValue = roleVal;
            firstSnippet = s.trim();
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
      rawValue: firstRawValue,
      evidenceSnippet: firstSnippet,
      latencyMs,
      matches,
      ambiguity: matches.length > 1
    };
  }

  normalize(raw: RawExtraction): NormalizedFact<ReportingHierarchy> | null {
    const rawRole = raw.rawValue;
    const lowerRole = rawRole.toLowerCase();

    let canonical = ReportingHierarchy.NONE;
    let confidence = 0.90;

    // Check BU_HEAD first with higher specificity to avoid general MD mapping
    if (lowerRole.match(/\b(?:managing director of|bu leader|business unit president|region|country manager|general manager)\b/)) {
      canonical = ReportingHierarchy.BU_HEAD;
      confidence = 0.85;
    } else if (lowerRole.match(/\b(?:board|directors|trustees)\b/)) {
      canonical = ReportingHierarchy.BOARD;
      confidence = 1.0;
    } else if (lowerRole.match(/\b(?:coo|cfo|cto|cmo|cpo|cro|cio|executive vice president|evp|svp|vp|vice president|president\s+-\s+|president\s+of\s+)\b/)) {
      // Check Executive Committee first. Regional president maps here.
      canonical = ReportingHierarchy.EXECUTIVE_COMMITTEE;
      confidence = 0.95;
    } else if (lowerRole.match(/\b(?:ceo|chief executive officer|founder|president)\b/)) {
      canonical = ReportingHierarchy.CEO;
      confidence = 1.0;
    } else if (lowerRole.match(/\b(?:managing director|md)\b/)) {
      canonical = ReportingHierarchy.BU_HEAD;
      confidence = 0.85;
    } else if (lowerRole.match(/\b(?:director|head of|lead of|manager|chief)\b/)) {
      canonical = ReportingHierarchy.FUNCTION_HEAD;
      confidence = 0.80;
    }

    if (canonical === ReportingHierarchy.NONE) {
      return null;
    }

    return {
      canonicalValue: canonical,
      confidence,
      rawValue: rawRole,
      metadata: {
        rawRole,
        canonical
      } as ReportingMetadata
    };
  }
}

export const reportingLineExtractorInstance = new ReportingLineExtractor();

// Backwards compatibility wrapper for extractor registry
export function extractReportingLine(input: { title: string; snippet: string; detailText: string }): Anchored<string> {
  const raw = reportingLineExtractorInstance.extract(input);
  if (!raw) return missing<string>();
  const norm = reportingLineExtractorInstance.normalize(raw);
  if (!norm) return missing<string>();
  const cleanValue = String(norm.canonicalValue || norm.rawValue || "REPORTING").trim();
  return anchor(cleanValue, raw.evidenceSnippet, raw.rawValue, "snippet");
}

export const reportingExtractorId = `reportingLine@${extractorVersion}`;
