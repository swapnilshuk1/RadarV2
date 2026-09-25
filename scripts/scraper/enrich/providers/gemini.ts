// Gemini provider — wraps the existing enrich/gemini.ts implementation
// behind the EnrichmentProvider contract.
import type { EnrichmentProvider } from "../contract";
import { enrichWithLLM, GEMINI_ENRICHMENT_MODEL } from "../gemini";

export const geminiProvider: EnrichmentProvider = {
  id: `gemini:${GEMINI_ENRICHMENT_MODEL}@2.0.0`,
  async enrich(input) {
    return enrichWithLLM(input);
  },
};
