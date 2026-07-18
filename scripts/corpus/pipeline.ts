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
export async function runCorpusPipeline() {
  const t0 = Date.now();
  console.log("\n==================================================================");
  console.log("             JOB INTELLIGENCE CORPUS REGENERATION PIPELINE");
  console.log("==================================================================\n");

  try {
    // 1. Ingest
    console.log("--- STAGE 1: INGESTION ---");
    const rawSnapshots = ingestCorpus();
    if (rawSnapshots.length === 0) {
      console.error("[Pipeline] No raw snapshots found. Pipeline aborted.");
      return { success: false, reason: "No raw snapshots" };
    }

    // 2. Normalize
    console.log("\n--- STAGE 2: NORMALIZATION ---");
    const normalized = normalizeCorpus(rawSnapshots);

    // 3. Enrich (Dimension / Fact Extraction)
    console.log("\n--- STAGE 3: ENRICHMENT ---");
    const enriched = await enrichCorpus(normalized, rawSnapshots);

    // 4. Publish (Write to targets)
    console.log("\n--- STAGE 4: PUBLISHING ---");
    
    // Publish to local extraction JSONs and compiled live-scraped.json
    const jsonPub = new JsonPublisher();
    await jsonPub.publish(enriched);

    // Publish to radar.sqlite database
    const dbPath = path.resolve(process.cwd(), "radar.sqlite");
    if (fs.existsSync(dbPath)) {
      const sqlitePub = new SqlitePublisher(dbPath);
      await sqlitePub.publish(enriched);
    } else {
      console.warn(`[Pipeline] SQLite database not found at ${dbPath}. Skipping SQLite publishing.`);
    }

    const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log("\n==================================================================");
    console.log(`  PIPELINE COMPLETED SUCCESSFULLY in ${durationSec}s`);
    console.log(`  Total Processed Opportunities : ${enriched.length}`);
    console.log("==================================================================\n");

    return { success: true, processedCount: enriched.length };

  } catch (err: any) {
    console.error("\n[Pipeline] PIPELINE CRITICAL FAILURE:", err.message);
    console.error(err.stack);
    return { success: false, error: err.message };
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
