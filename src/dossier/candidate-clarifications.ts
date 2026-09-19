import type { EvidenceSource } from "./contracts";

/** Owner-authored scope notes belong to the bound candidate document, not a global
 * prompt or a latest-profile override. Preserve this source section verbatim so
 * extraction cannot accidentally drop a distinction while summarising the CV. */
export function candidateSourceClarifications(sources: EvidenceSource[]) {
  const heading = /^# Candidate factual scope clarifications\r?\n/;
  const divider = /\r?\n# Candidate source\r?\n/;
  return sources
    .filter((source) => source.plane === "CANDIDATE" && heading.test(source.text))
    .map((source) => {
      const start = source.text.match(heading)![0].length;
      const boundary = divider.exec(source.text);
      if (!boundary || boundary.index < start)
        throw new Error("CANDIDATE_CLARIFICATION_SOURCE_INVALID");
      const quote = source.text.slice(start, boundary.index).trim();
      if (!quote || !source.text.slice(boundary.index + boundary[0].length).trim())
        throw new Error("CANDIDATE_CLARIFICATION_SOURCE_INVALID");
      return { sourceId: source.id, quote };
    });
}
