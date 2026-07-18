import fs from "fs";
import path from "path";
import type { DetailedCard } from "../scraper/types";

const SNAPSHOT_DIR = path.resolve(process.cwd(), ".scraper-artifacts", "snapshots");

/**
 * Ingest Stage: Reads all immutable raw snapshots from disk.
 * IDEMPOTENT: This only reads from the disk cache.
 */
export function ingestCorpus(): DetailedCard[] {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    console.warn(`[Ingest] Snapshots directory not found at: ${SNAPSHOT_DIR}`);
    return [];
  }

  const files = fs.readdirSync(SNAPSHOT_DIR).filter(file => file.endsWith(".json"));
  console.log(`[Ingest] Found ${files.length} raw snapshots in disk cache.`);

  const snapshots: DetailedCard[] = [];
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

  console.log(`[Ingest] Successfully loaded ${snapshots.length} raw snapshots.`);
  return snapshots;
}
