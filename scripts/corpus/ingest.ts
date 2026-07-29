import fs from "fs";
import path from "path";
import type { DetailedCard } from "../scraper/types";

const SNAPSHOT_DIR = path.resolve(process.cwd(), ".scraper-artifacts", "snapshots");

/**
 * Ingest Stage: Reads all immutable raw snapshots from disk.
 * IDEMPOTENT: This only reads from the disk cache.
 */
export function ingestCorpus(): DetailedCard[] {
  const snapshots: DetailedCard[] = [];

  if (fs.existsSync(SNAPSHOT_DIR)) {
    const files = fs.readdirSync(SNAPSHOT_DIR).filter(file => file.endsWith(".json"));
    console.log(`[Ingest] Found ${files.length} raw snapshots in disk cache.`);

    for (const file of files) {
      try {
        const filePath = path.join(SNAPSHOT_DIR, file);
        const rawContent = fs.readFileSync(filePath, "utf-8");
        const card = JSON.parse(rawContent) as DetailedCard;
        
        // Ensure card has a hash
        if (!card.cardHash) {
          card.cardHash = path.basename(file, ".json");
        }
        
        snapshots.push(card);
      } catch (err: any) {
        console.error(`[Ingest] Error reading snapshot ${file}:`, err.message);
      }
    }
  } else {
    console.warn(`[Ingest] Snapshots directory not found at: ${SNAPSHOT_DIR}`);
  }

  // Fallback: If no raw snapshots in .scraper-artifacts/snapshots, load from live-scraped.json
  if (snapshots.length === 0) {
    const liveJsonPath = path.resolve(process.cwd(), "src", "data", "live-scraped.json");
    const altLiveJsonPath = path.resolve(process.cwd(), ".data", "live-scraped.json");
    const targetJson = fs.existsSync(liveJsonPath) ? liveJsonPath : fs.existsSync(altLiveJsonPath) ? altLiveJsonPath : null;

    if (targetJson) {
      try {
        const raw = fs.readFileSync(targetJson, "utf-8");
        const list = JSON.parse(raw) as any[];
        for (const item of list) {
          snapshots.push({
            cardHash: item.jobHash || item.fingerprint || `j-${Math.random().toString(36).substring(2, 10)}`,
            portal: (item.scrapedFrom as any) || "LinkedIn",
            keyword: "Executive",
            searchUrl: item.applyUrl || "",
            detailUrl: item.applyUrl || "",
            discoveredAt: new Date().toISOString(),
            title: item.role || item.canonicalTitle || "Executive Role",
            company: item.company || "Confidential",
            location: item.location || "Remote",
            rawHtml: item.descriptionHtml || item.description || "",
            rawText: item.description || item.recommendation || "",
            snapshotSchemaVersion: "1.0.0",
            scraperVersion: "1.0.0",
            detail: {
              fetched: true,
              rawHtml: item.descriptionHtml || item.description || "",
              rawText: item.description || item.recommendation || "",
            },
            telemetry: {
              cardExtractMs: 0,
              detailExtractMs: 0,
              totalMs: 0,
            },
          });
        }
        console.log(`[Ingest] Fallback: Successfully loaded ${snapshots.length} snapshots from ${path.basename(targetJson)}.`);
      } catch (err: any) {
        console.error(`[Ingest] Fallback failed reading live-scraped.json:`, err.message);
      }
    }
  }

  console.log(`[Ingest] Successfully loaded ${snapshots.length} total raw snapshots.`);
  return snapshots;
}
