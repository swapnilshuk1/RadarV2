import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { extractCommercial } from "./scraper/extract/dimensions/commercialAccountability";
import { extractMandate } from "./scraper/extract/dimensions/mandate";
import { extractReportingLine } from "./scraper/extract/dimensions/reportingLine";
import { extractTechnology } from "./scraper/extract/dimensions/technologyStack";

const CONFIGS = [
  {
    key: "commercialAccountability",
    label: "Commercial Accountability",
    extractFn: extractCommercial,
    version: "2.1.0"
  },
  {
    key: "mandate",
    label: "Mandate",
    extractFn: extractMandate,
    version: "2.0.2"
  },
  {
    key: "reportingLine",
    label: "Reporting Line",
    extractFn: extractReportingLine,
    version: "2.0.0"
  },
  {
    key: "technologyStack",
    label: "Technology Stack",
    extractFn: extractTechnology,
    version: "1.0.0"
  }
];

async function main() {
  const args = process.argv.slice(2);
  let targetDim = "all";
  const dimIdx = args.indexOf("--dimension");
  if (dimIdx >= 0 && args[dimIdx + 1]) {
    targetDim = args[dimIdx + 1];
  }

  const dbPath = path.resolve(process.cwd(), "radar.sqlite");
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    process.exit(1);
  }

  const activeConfigs = targetDim === "all"
    ? CONFIGS
    : CONFIGS.filter(c => c.key === targetDim);

  if (activeConfigs.length === 0) {
    console.error(`Unknown dimension name: "${targetDim}". Supported: commercialAccountability, mandate, reportingLine, technologyStack, all`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  console.log(`Reprocessing dimensions: [${activeConfigs.map(c => c.key).join(", ")}] over 588 opportunities...`);

  const tx = db.transaction(() => {
    const opportunities = db.prepare("SELECT id, fingerprint FROM opportunities").all() as any[];
    let updatedCount = 0;
    let removedCount = 0;

    for (const opp of opportunities) {
      const snapPath = path.join(".scraper-artifacts", "snapshots", `${opp.fingerprint}.json`);
      if (!fs.existsSync(snapPath)) continue;

      const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf-8"));
      const title = snapshot.title || "";
      const snippet = snapshot.rawText || "";
      const detailText = snapshot.detail?.rawText || "";

      // Load existing document content
      const doc = db.prepare("SELECT id, content FROM documents WHERE opportunity_id = ?").get(opp.id) as any;
      let extraction: any = {};
      if (doc) {
        try {
          extraction = JSON.parse(doc.content);
        } catch {}
      }
      if (!extraction.dimensions) {
        extraction.dimensions = [];
      }

      for (const config of activeConfigs) {
        const result = config.extractFn({ title, snippet, detailText });
        const existingFact = db.prepare("SELECT id FROM facts WHERE opportunity_id = ? AND attribute = ?").get(opp.id, config.key) as any;

        if (result.value !== undefined && result.value !== null) {
          const payload = JSON.parse(result.value);

          // 1. Update documents extraction list
          const dimIdx = extraction.dimensions.findIndex((d: any) => d.key === config.key);
          const dimData = {
            key: config.key,
            label: config.label,
            importance: "Core",
            bucket: "Matched",
            jdEvidence: {
              value: payload,
              status: "Explicit",
              evidence: [{ quote: payload.rawValue || "", source: "snippet" }],
              provenance: "explicit",
              quality: "high",
              extractorId: `${config.key}@${config.version}`
            }
          };

          if (dimIdx >= 0) {
            extraction.dimensions[dimIdx] = dimData;
          } else {
            extraction.dimensions.push(dimData);
          }

          // 2. Update facts table
          if (existingFact) {
            db.prepare("UPDATE facts SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(result.value, existingFact.id);
          } else {
            const factId = `f_${config.key.substring(0, 4)}_${opp.id}`;
            db.prepare(`
              INSERT INTO facts (id, opportunity_id, attribute, value, created_at, updated_at)
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(factId, opp.id, config.key, result.value);
          }
          updatedCount++;
        } else {
          // Mark as missing in document
          const dimIdx = extraction.dimensions.findIndex((d: any) => d.key === config.key);
          if (dimIdx >= 0) {
            extraction.dimensions[dimIdx].jdEvidence = {
              value: null,
              status: "Missing",
              evidence: [],
              provenance: "none",
              quality: "low",
              extractorId: `${config.key}@${config.version}`
            };
            extraction.dimensions[dimIdx].bucket = "Missing";
          }

          // Clean up facts table
          if (existingFact) {
            db.prepare("DELETE FROM claim_facts WHERE fact_id = ?").run(existingFact.id);
            db.prepare("DELETE FROM fact_evidence WHERE fact_id = ?").run(existingFact.id);
            db.prepare("DELETE FROM facts WHERE id = ?").run(existingFact.id);
            removedCount++;
          }
        }
      }

      if (doc) {
        db.prepare("UPDATE documents SET content = ? WHERE id = ?").run(JSON.stringify(extraction), doc.id);
      }
    }

    console.log(`Reprocessing complete. Updated/Inserted facts: ${updatedCount} | Removed stale facts: ${removedCount}`);
  });

  try {
    tx();
    console.log("Database transaction committed successfully.");
  } catch (err) {
    console.error("Migration transaction failed & rolled back:", err);
  } finally {
    db.close();
  }
}

main();
