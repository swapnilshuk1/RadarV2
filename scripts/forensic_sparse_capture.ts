import { getDatabaseAdapter } from "../src/data/database/index.js";
import fs from "fs";
import path from "path";

async function main() {
  const db = getDatabaseAdapter();

  console.log("=== INSPECTING DOCUMENT CONTENT JSON KEYS ===");
  const docs = await db.many<any>(`
    SELECT id, opportunity_id, source_id, content
    FROM documents
    LIMIT 5
  `);

  for (const doc of docs) {
    try {
      const parsed = JSON.parse(doc.content);
      console.log(`Doc ${doc.id}:`);
      console.log("  Top keys:", Object.keys(parsed));
      console.log("  role:", parsed.role);
      console.log("  company:", parsed.company);
      console.log("  applyUrl:", parsed.applyUrl);
      console.log("  scrapedFrom:", parsed.scrapedFrom);
      console.log("  normalizedText length:", (parsed.normalizedText || "").length);
      console.log("  normalizedText words:", (parsed.normalizedText || "").split(/\s+/).filter(Boolean).length);
      console.log("  normalizedText preview:", (parsed.normalizedText || "").slice(0, 150));
      if (parsed.telemetry) {
        console.log("  telemetry:", JSON.stringify(parsed.telemetry));
      }
    } catch (e) {
      console.log(`Doc ${doc.id} is not JSON or failed parse:`, doc.content.slice(0, 100));
    }
  }

  // Check how many documents in DB vs live-scraped.json
  const totalDocs = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM documents");
  console.log("\nTotal documents in DB:", totalDocs?.count);

  // Check canonical_opportunities to see if it has URLs for all jobs
  const totalCanon = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM canonical_opportunities");
  console.log("Total canonical_opportunities in DB:", totalCanon?.count);

  // Check opportunity_discoveries
  const totalDisc = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunity_discoveries");
  console.log("Total opportunity_discoveries in DB:", totalDisc?.count);

  // Check acquisition_ledger
  const totalAcq = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM acquisition_ledger");
  console.log("Total acquisition_ledger in DB:", totalAcq?.count);
}

main().catch(console.error);
