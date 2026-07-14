import type { Database } from "better-sqlite3";
import type { AcquisitionStore } from "../../../domain/repositories";
import type { Extraction } from "../../../domain/entities";

export class SqliteAcquisitionStore implements AcquisitionStore {
  constructor(private db: Database) {}

  recordExtraction(extraction: Extraction): void {
    const stmt = this.db.prepare(`
      INSERT INTO extractions (
        id, source_listing_id, raw_json,
        created_at, updated_at, meta_schema_version, meta_extractor_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at,
        meta_extractor_version = excluded.meta_extractor_version
    `);

    stmt.run(
      extraction.id,
      extraction.sourceListingId,
      extraction.rawJson,
      extraction.createdAt,
      extraction.updatedAt,
      extraction._meta.schemaVersion,
      extraction._meta.extractorVersion ?? null
    );
  }
}
