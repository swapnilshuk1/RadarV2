import type { DatabaseAdapter } from "../../database/adapter";
import type { TimelineEvent, Workspace, RecommendationSnapshot } from "../../../domain/entities";

export class SqliteTimelineStore {
  constructor(private db: DatabaseAdapter) {}

  async createWorkspace(workspace: Workspace): Promise<void> {
    await this.db.execute(
      `
      INSERT INTO workspaces (
        id, created_by, owner, name, configuration_version,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        workspace.id,
        workspace.createdBy,
        workspace.owner,
        workspace.name,
        workspace.configurationVersion,
        workspace.createdAt,
        workspace.updatedAt,
        workspace.provenance.schemaVersion,
        workspace.provenance.extractorVersion ?? null,
        workspace.provenance.promptVersion ?? null,
        workspace.provenance.model ?? null,
        workspace.provenance.runId ?? null,
        workspace.provenance.timestamp
      ]
    );
  }

  async saveSnapshot(snapshot: RecommendationSnapshot): Promise<void> {
    await this.db.execute(
      `
      INSERT OR IGNORE INTO recommendation_snapshots (
        id, snapshot_hash, person_id, opportunity_id, recommendation_id,
        confidence, summary, prompt_version, model, graph_version,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        snapshot.id,
        snapshot.snapshotHash,
        snapshot.personId,
        snapshot.opportunityId,
        snapshot.recommendationId,
        snapshot.confidence,
        snapshot.summary,
        snapshot.promptVersion,
        snapshot.model,
        snapshot.graphVersion,
        snapshot.createdAt,
        snapshot.updatedAt,
        snapshot.provenance.schemaVersion,
        snapshot.provenance.extractorVersion ?? null,
        snapshot.provenance.promptVersion ?? null,
        snapshot.provenance.model ?? null,
        snapshot.provenance.runId ?? null,
        snapshot.provenance.timestamp
      ]
    );
  }

  async appendEvent(event: TimelineEvent): Promise<void> {
    await this.db.execute(
      `
      INSERT INTO timeline_events (
        id, workspace_id, person_id, opportunity_id,
        aggregate_type, aggregate_id,
        event_category, event_type, event_version, occurred_at,
        recommendation_snapshot_id, payload_json, metadata_json,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        event.id,
        event.workspaceId,
        event.personId,
        event.opportunityId ?? null,
        event.aggregateType,
        event.aggregateId,
        event.eventCategory,
        event.eventType,
        event.eventVersion,
        event.occurredAt,
        event.recommendationSnapshotId ?? null,
        event.payloadJson,
        event.metadataJson,
        event.provenance.timestamp,
        event.provenance.timestamp,
        event.provenance.schemaVersion,
        event.provenance.extractorVersion ?? null,
        event.provenance.promptVersion ?? null,
        event.provenance.model ?? null,
        event.provenance.runId ?? null,
        event.provenance.timestamp
      ]
    );
  }

  async getEventStream(workspaceId: string): Promise<TimelineEvent[]> {
    const rows = await this.db.many<any>(
      `
      SELECT * FROM timeline_events 
      WHERE workspace_id = ?
      ORDER BY occurred_at ASC
      `,
      [workspaceId]
    );

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      personId: row.person_id,
      opportunityId: row.opportunity_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      eventCategory: row.event_category,
      eventType: row.event_type,
      eventVersion: row.event_version,
      occurredAt: row.occurred_at,
      recommendationSnapshotId: row.recommendation_snapshot_id,
      payloadJson: row.payload_json,
      metadataJson: row.metadata_json,
      provenance: {
        schemaVersion: row.meta_schema_version,
        extractorVersion: row.meta_extractor_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model,
        runId: row.meta_run_id,
        timestamp: row.meta_timestamp,
      },
    }));
  }
}
