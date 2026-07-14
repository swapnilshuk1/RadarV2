import { anchor, missing, type Anchored } from "../anchor";

const WORK_MODEL = [
  { value: "remote", rx: /\b(fully\s+remote|remote[- ]first|work\s+from\s+home|wfh)\b/i },
  { value: "hybrid", rx: /\bhybrid\b/i },
  { value: "onsite", rx: /\b(on[- ]site|in[- ]office|onsite)\b/i },
];

export function extractWorkModel(input: { snippet: string; detailText: string }): Anchored<string> {
  const rawText = [input.snippet, input.detailText].filter(Boolean).join("\n");
  for (const p of WORK_MODEL) {
    const m = rawText.match(p.rx);
    if (m) return anchor(p.value, rawText, m[0], "snippet");
  }
  return missing<string>();
}

export const workModelExtractorId = "workModel@1.0.0";
