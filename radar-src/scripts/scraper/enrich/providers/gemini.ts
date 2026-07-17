// Gemini provider — wraps the existing enrich/gemini.ts implementation
// behind the EnrichmentProvider contract.
import type { EnrichmentProvider } from "../contract";
import { enrichWithLLM } from "../gemini";

export const geminiProvider: EnrichmentProvider = {
  id: "gemini-2.5-flash@1.0.0",
  async enrich(input) {
    return enrichWithLLM(input);
  },
};
