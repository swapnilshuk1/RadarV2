import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { EnrichmentProvider, EnrichInput, EnrichPatch } from "./contract";
import { EXTRACTOR_PROMPT_VERSION } from "../versions";
import { ENRICHMENT_CACHE_DIR } from "../config";
import { readJsonSafe, writeJsonAtomic } from "../utils/fs-atomic";

// Normalize text for hashing: lowercase, collapse whitespace, trim
function normalizeText(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function computeHash(input: EnrichInput, providerId: string): string {
  const normalized = normalizeText(
    `${input.title}\n${input.company}\n${input.location}\n${input.detailText}`
  );
  
  // The missingKeys are part of the request payload, so they should be hashed too
  // so a request missing ["mandate"] doesn't get a cached hit for a request missing ["workModel"]
  const keysStr = [...input.missingKeys].sort().join(",");

  const payload = `${normalized}|${EXTRACTOR_PROMPT_VERSION}|${providerId}|${keysStr}`;
  
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function withCache(provider: EnrichmentProvider): EnrichmentProvider {
  return {
    id: provider.id,
    
    async enrich(input: EnrichInput): Promise<EnrichPatch | null> {
      // 1. Compute deterministic hash
      const hash = computeHash(input, provider.id);
      const cachePath = path.join(ENRICHMENT_CACHE_DIR, `${hash}.json`);
      
      // 2. Check cache
      if (fs.existsSync(cachePath)) {
        const cached = readJsonSafe<EnrichPatch>(cachePath);
        if (cached) {
          return cached;
        }
      }
      
      // 3. Fallback to LLM
      const result = await provider.enrich(input);
      
      // 4. Save to cache
      if (result) {
        writeJsonAtomic(cachePath, result);
      }
      
      return result;
    }
  };
}
