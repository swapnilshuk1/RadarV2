// Sentence tokeniser used by every deterministic extractor.
// Keeping this shared guarantees that "anchor" verbatim checks stay consistent.
export function scanSentences(rawText: string): string[] {
  return rawText
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])|\n+|;\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}
