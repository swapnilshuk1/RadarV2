import { anchor, missing, type Anchored } from "../anchor";

const INDIA_HINTS = /\b(india|bengaluru|bangalore|mumbai|gurgaon|gurugram|pune|hyderabad|chennai|delhi|noida|kolkata|ahmedabad)\b/i;
const APAC_HINTS = /\b(apac|asia[- ]pacific|southeast asia|singapore)\b/i;
const EMEA_HINTS = /\b(emea|europe|middle east|africa|dubai|london)\b/i;

export function extractGeography(input: { location: string; snippet: string; detailText: string }): Anchored<string> {
  const rawText = [input.location, input.snippet, input.detailText].filter(Boolean).join("\n");
  const scan = [
    { value: "India", rx: INDIA_HINTS },
    { value: "APAC", rx: APAC_HINTS },
    { value: "EMEA", rx: EMEA_HINTS },
  ];
  for (const p of scan) {
    const m = rawText.match(p.rx);
    if (m) return anchor(p.value, rawText, m[0], "snippet");
  }
  return missing<string>();
}

export const geographyExtractorId = "geography@1.0.0";
