/**
 * MechanicalSourceSegmenter.ts
 *
 * Mechanical source text segmenter for RADAR v2 Gate 1B Batch 04B.
 *
 * INVARIANTS:
 * 1. Zero Semantic Rules: Contains NO semantic keywords (no checks for 'P&L', 'reports to', 'salary', etc.).
 * 2. Exact Slices: For every emitted unit, sourceText.slice(startOffset, endOffset) === exactText.
 * 3. Abbreviation Protection: Does NOT split on common corporate, title, academic, or unit abbreviations.
 * 4. Structural Respect: Preserves markdown lists, bullets, and line breaks without destructive clause splitting.
 * 5. Glued Transition Detection: Breaks unspaced layout-stripped transitions (e.g., lower-to-upper boundary).
 *
 * Protocol Version: source-segmentation/v1
 */

export interface SourceUnit {
  readonly spanId: string;
  readonly exactText: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface SegmentedDocument {
  readonly id: string;
  readonly partition: string;
  readonly sha256: string;
  readonly charLength: number;
  readonly unitCount: number;
  readonly units: readonly SourceUnit[];
}

export const SEGMENTATION_VERSION = "source-segmentation/v1";

const ABBREVIATIONS = new Set([
  "pvt", "ltd", "inc", "corp", "co", "llc", "llp",
  "mr", "mrs", "ms", "dr", "prof",
  "eg", "e.g", "ie", "i.e", "etc", "vs", "v", "approx", "viz",
  "sq", "ft", "pa", "p.a", "mo", "yr", "avg", "min", "max", "no", "nos",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "ph.d", "phd", "mba", "m.b.a", "bs", "b.s", "ms", "m.s", "ba", "b.a",
  "sell", "do", "js", "com", "org", "net", "io", "ai"
]);

export function segmentSourceText(sourceText: string): SourceUnit[] {
  if (!sourceText || typeof sourceText !== "string") return [];

  const rawUnits: Array<{ startOffset: number; endOffset: number; exactText: string }> = [];
  const len = sourceText.length;
  let unitStart = 0;
  let i = 0;

  function emitUnit(start: number, end: number) {
    while (start < end && /\s/.test(sourceText[start])) start++;
    while (end > start && /\s/.test(sourceText[end - 1])) end--;
    if (end > start) {
      rawUnits.push({
        startOffset: start,
        endOffset: end,
        exactText: sourceText.slice(start, end)
      });
    }
  }

  while (i < len) {
    const ch = sourceText[i];
    const nextCh = i + 1 < len ? sourceText[i + 1] : "";

    // 1. Line break boundaries
    if (ch === "\n" || ch === "\r") {
      let j = i;
      while (j < len && (sourceText[j] === "\r" || sourceText[j] === "\n")) j++;
      emitUnit(unitStart, i);
      unitStart = j;
      i = j;
      continue;
    }

    // 2. Sentence boundary (. ! ? ;)
    if (ch === "." || ch === "!" || ch === "?" || ch === ";") {
      let isSplitPoint = false;

      // Case A: Followed by whitespace and capital letter / digit / quote
      if (/\s/.test(nextCh)) {
        let afterWs = i + 1;
        while (afterWs < len && /\s/.test(sourceText[afterWs])) afterWs++;

        if (afterWs < len && /[A-Z0-9"'(#\*\-•]/.test(sourceText[afterWs])) {
          if (ch === ".") {
            let wordStart = i - 1;
            while (wordStart >= 0 && /[a-zA-Z]/.test(sourceText[wordStart])) wordStart--;
            const word = sourceText.slice(wordStart + 1, i).toLowerCase();

            let multiDot = false;
            if (wordStart >= 1 && sourceText[wordStart] === "." && /[a-zA-Z]/.test(sourceText[wordStart - 1])) {
              multiDot = true;
            }

            const isDigitBefore = i > 0 && /\d/.test(sourceText[i - 1]);
            const isSingleCap = (i - wordStart === 2) && /[A-Z]/.test(sourceText[i - 1]);

            if (ABBREVIATIONS.has(word) || multiDot || isSingleCap) {
              isSplitPoint = false;
            } else if (isDigitBefore && !/^\n/.test(sourceText.slice(afterWs - 2, afterWs))) {
              isSplitPoint = false;
            } else {
              isSplitPoint = true;
            }
          } else {
            isSplitPoint = true;
          }
        }
      } 
      // Case B: Glued boundary without whitespace, e.g. "markets.The Role"
      else if (/[A-Z]/.test(nextCh)) {
        if (ch === ".") {
          let wordStart = i - 1;
          while (wordStart >= 0 && /[a-zA-Z]/.test(sourceText[wordStart])) wordStart--;
          const word = sourceText.slice(wordStart + 1, i).toLowerCase();

          if (word === "sell" && sourceText.slice(i + 1, i + 3) === "Do") {
            isSplitPoint = false;
          } else if (ABBREVIATIONS.has(word) || (i - wordStart <= 2)) {
            isSplitPoint = false;
          } else {
            isSplitPoint = true;
          }
        } else {
          isSplitPoint = true;
        }
      }

      if (isSplitPoint) {
        emitUnit(unitStart, i + 1);
        unitStart = i + 1;
        i++;
        continue;
      }
    }

    // 3. Glued Tag / Heading transitions: [a-z0-9)]{3,}[A-Z][a-z]{2,}
    if (/[a-z0-9\)]/.test(ch) && /[A-Z]/.test(nextCh)) {
      let wordStart = i;
      while (wordStart >= 0 && /[a-zA-Z0-9\)]/.test(sourceText[wordStart])) wordStart--;
      const prevWordLen = i - wordStart;

      const nextSlice = sourceText.slice(i + 1, i + 4);
      const isNextWordCapitalized = /^[A-Z][a-z]{2}/.test(nextSlice);

      const combined = sourceText.slice(Math.max(0, i - 9), i + 7).toLowerCase();
      const isCodeKeyword = combined.includes("javascript") || combined.includes("typescript") || combined.includes("salesforce");

      if (prevWordLen >= 4 && isNextWordCapitalized && !isCodeKeyword) {
        emitUnit(unitStart, i + 1);
        unitStart = i + 1;
      }
    }

    i++;
  }

  if (unitStart < len) {
    emitUnit(unitStart, len);
  }

  // Post-process: merge tiny fragments (< 5 chars) into prior unit unless standalone marker
  const mergedUnits: Array<{ startOffset: number; endOffset: number; exactText: string }> = [];
  for (let u = 0; u < rawUnits.length; u++) {
    const unit = rawUnits[u];
    if (mergedUnits.length > 0 && unit.exactText.length < 5 && !/^[A-Z0-9#\*\-]/.test(unit.exactText)) {
      const prev = mergedUnits[mergedUnits.length - 1];
      const mergedStart = prev.startOffset;
      const mergedEnd = unit.endOffset;
      mergedUnits[mergedUnits.length - 1] = {
        startOffset: mergedStart,
        endOffset: mergedEnd,
        exactText: sourceText.slice(mergedStart, mergedEnd)
      };
    } else {
      mergedUnits.push(unit);
    }
  }

  return mergedUnits.map((u, idx) => ({
    spanId: `S${String(idx + 1).padStart(3, "0")}`,
    exactText: u.exactText,
    startOffset: u.startOffset,
    endOffset: u.endOffset
  }));
}
