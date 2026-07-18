import type { EnrichmentProvider } from "../contract";

export const noopProvider: EnrichmentProvider = {
  id: "noop@1.0.0",
  async enrich() {
    return null;
  },
};
