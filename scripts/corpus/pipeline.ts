import path from "path";
import fs from "fs";
import { ingestCorpus } from "./ingest";
import { normalizeCorpus } from "./normalize";
import { enrichCorpus, type EnrichedOpportunity } from "./enrich";
import { JsonPublisher, SqlitePublisher } from "./publish";

/**
 * Corpus Regeneration Pipeline orchestrator.
 * Fully idempotent and deterministic regeneration of the opportunity corpus from raw snapshots.
 */
export async function runCorpusPipeline(
  onProgress?: (msg: string, stage: string) => void
) {
  const t0 = Date.now();
  const notify = (msg: string, stage: string) => {
    console.log(msg);
    if (onProgress) onProgress(msg, stage);
  };

  notify("Initializing Job Intelligence Corpus Ingestion Stage...", "INGESTING");

  try {
    // 1. Ingest
    notify("INGESTION: Reading immutable raw scraped snapshots from local cache storage...", "INGESTING");
    const rawSnapshots = ingestCorpus();
    if (rawSnapshots.length === 0) {
      notify("[Pipeline] CRITICAL: No raw snapshots found in cache storage. Pipeline aborted.", "FAILED");
      return { success: false, reason: "No raw snapshots" };
    }
    notify(`INGESTION: Loaded ${rawSnapshots.length} raw scraped snapshots from cache.`, "INGESTING");

    // 2. Normalize
    notify("NORMALIZATION: Standardizing document structures, formatting rich text fields, sanitizing HTML nodes...", "NORMALIZING");
    const normalized = normalizeCorpus(rawSnapshots);
    notify(`NORMALIZATION: Successfully standardized ${normalized.length} structured job listings.`, "NORMALIZING");

    // 3. Enrich (Dimension / Fact Extraction)
    notify("ENRICHMENT: Running deterministic core rules over 8 dimensional capability boundaries...", "ENRICHING");
    notify("ENRICHMENT: Synthesizing confidence metrics, gathering verbatim evidence quotes, resolving missing criteria...", "ENRICHING");
    const enriched = await enrichCorpus(normalized, rawSnapshots);
    notify(`ENRICHMENT: Successfully extracted dimensions and facts for ${enriched.length} opportunities.`, "ENRICHING");

    // 4. Publish (Write to targets)
    notify("PUBLISHING: Invoking server-side database publisher and content-addressed JSON compiler...", "PUBLISHING");
    
    // Publish to local extraction JSONs and compiled live-scraped.json
    const jsonPub = new JsonPublisher();
    await jsonPub.publish(enriched);
    notify(`PUBLISHING: Content-addressed JSON extractions written to disk and live-scraped.json compiled.`, "PUBLISHING");

    // Publish to active DatabaseAdapter (Turso Cloud / local SQLite)
    notify("SQLITE: Publishing updated opportunities, documents, and facts tables to database...", "PUBLISHING");
    const sqlitePub = new SqlitePublisher();
    await sqlitePub.publish(enriched);
    notify("SQLITE: Published updated opportunities, documents, and facts tables inside database.", "PUBLISHING");

    const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
    const successMsg = `SUCCESS: Job Intelligence Corpus successfully regenerated and derived from immutable source of truth in ${durationSec}s (${enriched.length} opportunities)!`;
    notify(successMsg, "COMPLETE");

    return { success: true, processedCount: enriched.length };

  } catch (err: any) {
    const errorMsg = `CRITICAL ERROR: Corpus Regeneration failed: ${err.message || String(err)}`;
    notify(errorMsg, "FAILED");
    console.error(err.stack);
    return { success: false, error: err.message || String(err) };
  }
}

// CLI runner check
const isMain = typeof process !== "undefined" && 
  process.argv && 
  process.argv[1] && 
  (process.argv[1].endsWith("pipeline.ts") || process.argv[1].endsWith("pipeline"));

if (isMain) {
  runCorpusPipeline().then((res) => {
    if (!res.success) process.exit(1);
  });
}
