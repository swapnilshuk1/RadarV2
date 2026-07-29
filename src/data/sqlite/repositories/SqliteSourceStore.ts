import type { DatabaseAdapter } from "../../database/adapter";
import type { SourceStore } from "../../../domain/repositories";
import type { Source } from "../../../domain/entities";

export class SqliteSourceStore implements SourceStore {
  constructor(private db: DatabaseAdapter) {}

  async recordSource(source: Source): Promise<void> {
    await this.db.execute(
      `
      INSERT INTO sources (
        id, type, url, name, created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        url = excluded.url,
        name = excluded.name,
        updated_at = excluded.updated_at
      `,
      [
        source.id,
        source.type,
        source.url ?? null,
        source.name ?? null,
        source.createdAt,
        source.updatedAt,
        source.provenance.schemaVersion,
        source.provenance.extractorVersion ?? null,
        source.provenance.promptVersion ?? null,
        source.provenance.model ?? null,
        source.provenance.runId ?? null,
        source.provenance.timestamp
      ]
    );
  }

  async getSource(id: string): Promise<Source | undefined> {
    const row = await this.db.one<any>(`SELECT * FROM sources WHERE id = ?`, [id]);
    if (!row) return undefined;

    return {
      id: row.id,
      type: row.type,
      url: row.url,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      provenance: {
        schemaVersion: row.meta_schema_version,
        extractorVersion: row.meta_extractor_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model,
        runId: row.meta_run_id,
        timestamp: row.meta_timestamp
      }
    };
  }
}
