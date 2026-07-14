import type { Evidence, EvidenceSource } from "../types";

// Traced field with strict verbatim contract (extractor-remediation §2.1).
// If the quote is not literally present in rawText, we downgrade to Missing —
// no fuzzy matching, no normalisation. This is what keeps Terrible-tier
// `missingRetain` at ~100%.
export interface Anchored<T> {
  value: T | null;
  status: "Explicit" | "Inferred" | "Missing";
  evidence: Evidence[];
}

export function anchor<T>(
  value: T,
  rawText: string,
  quote: string,
  source: EvidenceSource
): Anchored<T> {
  const q = quote.trim();
  if (!q || !rawText.includes(q)) {
    return { value: null, status: "Missing", evidence: [] };
  }
  return { value, status: "Explicit", evidence: [{ quote: q, source }] };
}

export function missing<T>(): Anchored<T> {
  return { value: null, status: "Missing", evidence: [] };
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Disqualifier scan within a ±12-word window of a hit (extractor-remediation §2.3).
export function hasDisqualifierNear(rawText: string, hit: string, disq: RegExp[]): boolean {
  const idx = rawText.indexOf(hit);
  if (idx < 0) return false;
  const before = rawText.slice(Math.max(0, idx - 120), idx);
  const after = rawText.slice(idx + hit.length, idx + hit.length + 120);
  const window = `${before} ${after}`;
  return disq.some((rx) => rx.test(window));
}
