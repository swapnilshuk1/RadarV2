import fs from "fs";
import path from "path";
import type { EnrichedOpportunity } from "./enrich";
import { writeJsonAtomic } from "../scraper/utils/fs-atomic";
import { EXTRACTION_DIR, LIVE_SCRAPED_JSON } from "../scraper/config";

export interface Publisher {
  publish(enriched: EnrichedOpportunity[]): Promise<void>;
}

/**
 * JSON Publisher: Writes enriched results content-addressed on disk and rebuilds live-scraped.json.
 */
export class JsonPublisher implements Publisher {
  async publish(enriched: EnrichedOpportunity[]): Promise<void> {
    console.log(`[Publish:JSON] Publishing ${enriched.length} opportunities to extraction files...`);
    
    if (!fs.existsSync(EXTRACTION_DIR)) {
      fs.mkdirSync(EXTRACTION_DIR, { recursive: true });
    }

    for (const item of enriched) {
      const p = path.join(EXTRACTION_DIR, `${item.jobHash}.json`);
      writeJsonAtomic(p, item);
    }

    console.log(`[Publish:JSON] Extraction files written to: ${EXTRACTION_DIR}`);

    // Rebuild system-of-record live-scraped.json
    console.log(`[Publish:JSON] Rebuilding consolidated live-scraped.json file...`);
    const allFiles = fs.readdirSync(EXTRACTION_DIR).filter(f => f.endsWith(".json"));
    const records: EnrichedOpportunity[] = [];
    const seenJobHash = new Set<string>();

    for (const f of allFiles) {
      try {
        const filePath = path.join(EXTRACTION_DIR, f);
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as EnrichedOpportunity;
        if (seenJobHash.has(parsed.jobHash)) continue;
        seenJobHash.add(parsed.jobHash);
        records.push(parsed);
      } catch (err: any) {
        console.error(`[Publish:JSON] Error reading extraction file ${f}:`, err.message);
      }
    }

    writeJsonAtomic(LIVE_SCRAPED_JSON, records);
    console.log(`[Publish:JSON] Atomically wrote ${records.length} records to: ${LIVE_SCRAPED_JSON}`);
  }
}

import { getDatabaseAdapter } from "../../src/data/database";

/**
 * SQLite / Turso Publisher: Updates opportunities, documents, and facts tables via DatabaseAdapter.
 */
export class SqlitePublisher implements Publisher {
  constructor(private dbPath?: string) {}

  async publish(enriched: EnrichedOpportunity[]): Promise<void> {
    console.log(`[Publish:Database] Connecting to database adapter...`);
    const adapter = getDatabaseAdapter(this.dbPath);

    let oppMerged = 0;
    let docMerged = 0;
    let factsMerged = 0;

    for (const item of enriched) {
      try {
        const oppId = `opp_${item.jobHash}`;
        const compNameClean = item.company.toLowerCase().replace(/[^a-z0-9]/g, "");
        const compId = `comp_${compNameClean || "confidential"}`;

        // Ensure company exists in the companies table
        await adapter.execute(
          `INSERT INTO companies (id, name, hq, size, created_at, updated_at)
           VALUES (?, ?, ?, null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
          [compId, item.company, item.location || null]
        );

        // Merge opportunity details
        await adapter.execute(
          `INSERT INTO opportunities (
             id, company_id, canonical_title, location, employment_type, posting_window, fingerprint, lifecycle,
             created_at, updated_at,
             meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(fingerprint) DO UPDATE SET
             canonical_title = excluded.canonical_title,
             location = excluded.location,
             employment_type = excluded.employment_type,
             lifecycle = excluded.lifecycle,
             updated_at = CURRENT_TIMESTAMP`,
          [
            oppId,
            compId,
            item.role,
            item.location || null,
            "Full-time",
            "Recent",
            item.jobHash,
            "Active",
            "1.0.0",
            item.extractorVersion || null,
            item.promptVersion || null,
            item.telemetry?.llmFallbackReason ? "gpt-4" : "rule-based",
            null,
          ]
        );
        oppMerged++;

        // Ensure source exists in the sources table
        const srcId = item.scrapedFrom || "LinkedIn";
        await adapter.execute(
          `INSERT INTO sources (id, type, name, created_at, updated_at)
           VALUES (?, 'Portal', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO NOTHING`,
          [srcId, srcId]
        );

        // Merge Document Record (documents table)
        const docId = `doc_${item.jobHash}`;
        await adapter.execute(
          `INSERT INTO documents (
             id, source_id, opportunity_id, payload_type, content, lifecycle,
             created_at, updated_at,
             meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
           )
           VALUES (?, ?, ?, 'Structured', ?, 'Active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, null, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET
             content = excluded.content,
             updated_at = CURRENT_TIMESTAMP`,
          [
            docId,
            srcId,
            oppId,
            JSON.stringify(item),
            "1.0.0",
            item.extractorVersion || null,
            item.promptVersion || null,
            item.telemetry?.llmFallbackReason ? "gpt-4" : "rule-based",
          ]
        );
        docMerged++;

        // Sync Fact records (facts table)
        if (item.dimensions) {
          for (const dim of item.dimensions) {
            if (dim.jdEvidence?.value !== undefined && dim.jdEvidence?.value !== null) {
              const factValue = JSON.stringify(dim.jdEvidence.value);
              const factId = `f_${dim.key.substring(0, 4)}_${oppId}`;

              await adapter.execute(
                `INSERT INTO facts (id, opportunity_id, attribute, value, created_at, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
                [factId, oppId, dim.key, factValue]
              );
              factsMerged++;
            }
          }
        }
      } catch (err: any) {
        console.error(`[Publish:Database] Error merging ${item.jobHash}:`, err.message);
      }
    }

    console.log(`[Publish:Database] Database successfully updated. Merged: ${oppMerged} opportunities, ${docMerged} documents, ${factsMerged} facts.`);
  }
}
