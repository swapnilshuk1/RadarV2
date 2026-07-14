// Provider factory — the single place that decides which LLM provider to use.
// Consumers (extractor.ts) import `defaultProvider` and never need to know
// which concrete implementation is active.
//
// Resolution order:
//   1. LLM_PROVIDER env var (explicit: "groq" | "gemini" | "none")
//   2. Auto-detect: GROQ_API_KEY present -> groq
//   3. Auto-detect: GEMINI_API_KEY present -> gemini
//   4. Fallback -> noop (deterministic-only run)
import type { EnrichmentProvider } from "../contract";
import { groqProvider } from "./groq";
import { geminiProvider } from "./gemini";
import { noopProvider } from "./noop";

import { withCache } from "../cache";

function createProvider(): EnrichmentProvider {
  const explicit = (process.env.LLM_PROVIDER ?? "").toLowerCase();

  if (explicit === "groq") return groqProvider;
  if (explicit === "gemini") return geminiProvider;
  if (explicit === "none") return noopProvider;

  // Auto-detect from whichever API key is present.
  if (process.env.GROQ_API_KEY) return groqProvider;
  if (process.env.GEMINI_API_KEY) return geminiProvider;

  return noopProvider;
}

// Singleton — created once at module-load time so the provider ID is stable
// throughout a scrape run. Wrapped in cache layer.
export const defaultProvider: EnrichmentProvider = withCache(createProvider());
