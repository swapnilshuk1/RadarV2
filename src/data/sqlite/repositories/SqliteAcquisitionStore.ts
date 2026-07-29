import type { DatabaseAdapter } from "../../database/adapter";
import type { AcquisitionStore } from "../../../domain/repositories";
import type { Document } from "../../../domain/entities";

export class SqliteAcquisitionStore implements AcquisitionStore {
  constructor(private db: DatabaseAdapter) {}

  async recordDocument(document: Document): Promise<void> {
    await this.db.execute(
      `
      INSERT INTO documents (
        id, source_id, opportunity_id, payload_type, content, lifecycle,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        lifecycle = excluded.lifecycle,
        updated_at = excluded.updated_at
      `,
      [
        document.id,
        document.sourceId,
        document.opportunityId ?? null,
        document.payloadType,
        document.content,
        document.lifecycle,
        document.createdAt,
        document.updatedAt,
        document.provenance.schemaVersion,
        document.provenance.extractorVersion ?? null,
        document.provenance.promptVersion ?? null,
        document.provenance.model ?? null,
        document.provenance.runId ?? null,
        document.provenance.timestamp
      ]
    );
  }

  async logDiscovery(discovery: {
    id: string;
    opportunityId: string;
    executionId: string;
    sourceName: string;
    firstPortal: string;
    firstDefinition: string;
  }): Promise<void> {
    await this.db.execute(
      `
      INSERT OR IGNORE INTO opportunity_discoveries 
      (id, opportunity_id, execution_id, source_name, first_portal, first_definition) 
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        discovery.id,
        discovery.opportunityId,
        discovery.executionId,
        discovery.sourceName,
        discovery.firstPortal,
        discovery.firstDefinition
      ]
    );
  }
}
