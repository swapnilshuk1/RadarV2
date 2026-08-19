/**
 * src/lib/intelligence/semantic/normalizers/TemporalParser.ts
 *
 * Temporal state and tense parser for executive claims.
 *
 * Distinguishes:
 * - CURRENT: "Currently owns a $500M P&L", "Leads global marketing"
 * - HISTORICAL: "Previously owned a $50M P&L", "Owned P&L from 2017 to 2020", "Former VP"
 * - ASPIRATIONAL: "Looking to own P&L", "Seeking a role with P&L responsibility", "Desires to transition"
 * - UNKNOWN: "P&L responsibility for $100M business unit"
 */

import type { TemporalState } from "../types";

export interface TemporalParsingResult {
  readonly temporalState: TemporalState;
  readonly startYear?: number;
  readonly endYear?: number;
  readonly recencyYears?: number;
  readonly triggerPhrase?: string;
  readonly isAspirational: boolean;
}

const ASPIRATIONAL_TRIGGERS = [
  /\bseeking\s+(?:a\s+role|an\s+opportunity|to|a\s+position)\b/i,
  /\blooking\s+(?:to|for|forward\s+to)\b/i,
  /\baim(?:s|ing)?\s+to\b/i,
  /\bdesir(?:es|ing|ed)?\s+to\b/i,
  /\baspir(?:es|ing|ed)?\s+to\b/i,
  /\bwill\s+(?:take|own|lead|manage|be\s+responsible)\b/i,
  /\bopen\s+to\s+(?:roles|opportunities|positions|owning)\b/i,
  /\binterested\s+in\s+(?:roles|opportunities|owning)\b/i,
  /\btransitioning\s+into\b/i,
];

const HISTORICAL_TRIGGERS = [
  /\bpreviously\b/i,
  /\bformer(?:ly)?\b/i,
  /\bpast\b/i,
  /\bearlier\b/i,
  /\bprior\s+to\b/i,
  /\bmanaged\s+until\b/i,
  /\bex-[a-z0-9]+\b/i,
];

const CURRENT_TRIGGERS = [
  /\bcurrently\b/i,
  /\bpresent(?:ly)?\b/i,
  /\bongoing\b/i,
  /\bactive(?:ly)?\b/i,
  /\bsince\s+(?:20\d\d|19\d\d)\b/i,
];

const YEAR_RANGE_REGEX = /\b(19\d\d|20\d\d)\s*(?:-|–|to|until)\s*(19\d\d|20\d\d|present|current)\b/i;

export class TemporalParser {
  /**
   * Analyzes context text to extract temporal state and recency.
   */
  public static parse(context: string, currentYear: number = 2026): TemporalParsingResult {
    const raw = context.trim();
    if (!raw) {
      return { temporalState: "UNKNOWN", isAspirational: false };
    }

    const textLower = raw.toLowerCase();

    // 1. Check Aspirational triggers first (takes precedence)
    for (const regex of ASPIRATIONAL_TRIGGERS) {
      const match = textLower.match(regex);
      if (match) {
        return {
          temporalState: "ASPIRATIONAL",
          triggerPhrase: match[0].trim(),
          isAspirational: true,
        };
      }
    }

    // 2. Check for Date Ranges (e.g. 2017-2020 or 2021-present)
    const rangeMatch = textLower.match(YEAR_RANGE_REGEX);
    if (rangeMatch) {
      const startYear = parseInt(rangeMatch[1], 10);
      const endStr = rangeMatch[2].toLowerCase();
      
      if (endStr === "present" || endStr === "current" || parseInt(endStr, 10) >= currentYear) {
        return {
          temporalState: "CURRENT",
          startYear,
          endYear: currentYear,
          recencyYears: 0,
          triggerPhrase: rangeMatch[0],
          isAspirational: false,
        };
      } else {
        const endYear = parseInt(endStr, 10);
        return {
          temporalState: "HISTORICAL",
          startYear,
          endYear,
          recencyYears: Math.max(0, currentYear - endYear),
          triggerPhrase: rangeMatch[0],
          isAspirational: false,
        };
      }
    }

    // 3. Check Explicit Historical triggers
    for (const regex of HISTORICAL_TRIGGERS) {
      const match = textLower.match(regex);
      if (match) {
        return {
          temporalState: "HISTORICAL",
          triggerPhrase: match[0].trim(),
          isAspirational: false,
        };
      }
    }

    // 4. Check Explicit Current triggers
    for (const regex of CURRENT_TRIGGERS) {
      const match = textLower.match(regex);
      if (match) {
        return {
          temporalState: "CURRENT",
          triggerPhrase: match[0].trim(),
          isAspirational: false,
        };
      }
    }

    return {
      temporalState: "UNKNOWN",
      isAspirational: false,
    };
  }
}
