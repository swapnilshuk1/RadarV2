import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
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

/**
 * SQLite Publisher: Updates opportunities, documents, and facts tables inside radar.sqlite.
 */
export class SqlitePublisher implements Publisher {
  constructor(private dbPath: string) {}

  async publish(enriched: EnrichedOpportunity[]): Promise<void> {
    console.log(`[Publish:SQLite] Connecting to SQLite database at: ${this.dbPath}`);
    const db = new Database(this.dbPath);
    
    // Enable WAL mode for performance
    db.pragma("journal_mode = WAL");

    const tx = db.transaction(() => {
      let oppMerged = 0;
      let docMerged = 0;
      let factsMerged = 0;

      for (const item of enriched) {
        // 1. Resolve Opportunity ID (id in opportunities table)
        // Check if opportunity already exists by fingerprint
        let oppId: string;
        const existingOpp = db.prepare("SELECT id FROM opportunities WHERE fingerprint = ?").get(item.jobHash) as { id: string } | undefined;
        
        if (existingOpp) {
          oppId = existingOpp.id;
        } else {
          oppId = `opp_${item.jobHash}`;
        }

        // Merge opportunity details
        const mergeOppStmt = db.prepare(`
          INSERT INTO opportunities (
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
            updated_at = CURRENT_TIMESTAMP
        `);

        // Resolve company_id
        const compNameClean = item.company.toLowerCase().replace(/[^a-z0-9]/g, "");
        const compId = `comp_${compNameClean || "confidential"}`;

        // Ensure company exists in the companies table
        db.prepare(`
          INSERT OR IGNORE INTO companies (id, name, hq, size, created_at, updated_at)
          VALUES (?, ?, ?, null, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(compId, item.company, item.location);

        mergeOppStmt.run(
          oppId,
          compId,
          item.role,
          item.location || null,
          "Full-time", // default employment type
          "Recent",    // default window
          item.jobHash,
          "Active",    // default lifecycle
          "1.0.0",     // schema version
          item.extractorVersion || null,
          item.promptVersion || null,
          item.telemetry?.llmFallbackReason ? "gpt-4" : "rule-based",
          null,        // run id
        );
        oppMerged++;

        // Ensure source exists in the sources table
        const srcId = item.scrapedFrom;
        db.prepare(`
          INSERT OR IGNORE INTO sources (id, type, name, created_at, updated_at)
          VALUES (?, 'Portal', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(srcId, item.scrapedFrom);

        // 2. Merge Document Record (documents table)
        let docId: string;
        const existingDoc = db.prepare("SELECT id FROM documents WHERE opportunity_id = ?").get(oppId) as { id: string } | undefined;
        if (existingDoc) {
          docId = existingDoc.id;
        } else {
          docId = `doc_${item.jobHash}`;
        }

        const mergeDocStmt = db.prepare(`
          INSERT INTO documents (
            id, source_id, opportunity_id, payload_type, content, lifecycle,
            created_at, updated_at,
            meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
          )
          VALUES (?, ?, ?, 'Structured', ?, 'Active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, null, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            content = excluded.content,
            updated_at = CURRENT_TIMESTAMP
        `);

        mergeDocStmt.run(
          docId,
          srcId,
          oppId,
          JSON.stringify(item),
          "1.0.0", // schema version
          item.extractorVersion || null,
          item.promptVersion || null,
          item.telemetry?.llmFallbackReason ? "gpt-4" : "rule-based"
        );
        docMerged++;

        // 3. Sync Fact records (facts table)
        for (const dim of item.dimensions) {
          const existingFact = db.prepare("SELECT id FROM facts WHERE opportunity_id = ? AND attribute = ?").get(oppId, dim.key) as { id: string } | undefined;
          
          if (dim.jdEvidence.value !== undefined && dim.jdEvidence.value !== null) {
            const factValue = JSON.stringify(dim.jdEvidence.value);
            
            if (existingFact) {
              db.prepare("UPDATE facts SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(factValue, existingFact.id);
            } else {
              const factId = `f_${dim.key.substring(0, 4)}_${oppId}`;
              db.prepare(`
                INSERT INTO facts (id, opportunity_id, attribute, value, created_at, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
              `).run(factId, oppId, dim.key, factValue);
            }
            factsMerged++;
          } else {
            // Delete stale fact if dimension is now missing
            if (existingFact) {
              db.prepare("DELETE FROM claim_facts WHERE fact_id = ?").run(existingFact.id);
              db.prepare("DELETE FROM fact_evidence WHERE fact_id = ?").run(existingFact.id);
              db.prepare("DELETE FROM facts WHERE id = ?").run(existingFact.id);
            }
          }
        }
      }

      console.log(`[Publish:SQLite] Transaction complete. Merged: ${oppMerged} opportunities, ${docMerged} documents, ${factsMerged} facts.`);
    });

    try {
      tx();
      console.log(`[Publish:SQLite] SQLite database successfully updated.`);
    } catch (err: any) {
      console.error(`[Publish:SQLite] Transaction failed and was rolled back:`, err.message);
      throw err;
    } finally {
      db.close();
    }
  }
}
