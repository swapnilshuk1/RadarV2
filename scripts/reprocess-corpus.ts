import fs from "fs";
import path from "path";
import { getDatabaseAdapter } from "../src/data/database";
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

  const activeConfigs = targetDim === "all"
    ? CONFIGS
    : CONFIGS.filter(c => c.key === targetDim);

  if (activeConfigs.length === 0) {
    console.error(`Unknown dimension name: "${targetDim}". Supported: commercialAccountability, mandate, reportingLine, technologyStack, all`);
    process.exit(1);
  }

  const db = getDatabaseAdapter();
  console.log(`Reprocessing dimensions: [${activeConfigs.map(c => c.key).join(", ")}] over opportunities...`);

  await db.transaction(async (tx) => {
    const opportunities = await tx.many<any>("SELECT id, fingerprint FROM opportunities");
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
      const doc = await tx.one<any>("SELECT id, content FROM documents WHERE opportunity_id = ?", [opp.id]);
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
        const existingFact = await tx.one<any>("SELECT id FROM facts WHERE opportunity_id = ? AND attribute = ?", [opp.id, config.key]);

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
            await tx.execute("UPDATE facts SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [result.value, existingFact.id]);
          } else {
            const factId = `f_${config.key.substring(0, 4)}_${opp.id}`;
            await tx.execute(`
              INSERT INTO facts (id, opportunity_id, attribute, value, created_at, updated_at)
              VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [factId, opp.id, config.key, result.value]);
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
            await tx.execute("DELETE FROM claim_facts WHERE fact_id = ?", [existingFact.id]);
            await tx.execute("DELETE FROM fact_evidence WHERE fact_id = ?", [existingFact.id]);
            await tx.execute("DELETE FROM facts WHERE id = ?", [existingFact.id]);
            removedCount++;
          }
        }
      }

      if (doc) {
        await tx.execute("UPDATE documents SET content = ? WHERE id = ?", [JSON.stringify(extraction), doc.id]);
      }
    }

    console.log(`Reprocessing complete. Updated/Inserted facts: ${updatedCount} | Removed stale facts: ${removedCount}`);
  });

  console.log("Database transaction committed successfully.");
}

main().catch(console.error);
