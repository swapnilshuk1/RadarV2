import type { DatabaseAdapter } from "../../database/adapter";
import type { ReasoningStore } from "../../../domain/repositories";
import type { Claim } from "../../../domain/entities";

export class SqliteReasoningStore implements ReasoningStore {
  constructor(private db: DatabaseAdapter) {}

  async recordClaims(claims: Claim[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const claim of claims) {
        await tx.execute(
          `
          INSERT INTO claims (
            id, opportunity_id, statement, confidence,
            created_at, updated_at,
            meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            statement = excluded.statement,
            confidence = excluded.confidence,
            updated_at = excluded.updated_at
          `,
          [
            claim.id,
            claim.opportunityId,
            claim.statement,
            claim.confidence,
            claim.createdAt,
            claim.updatedAt,
            claim.provenance.schemaVersion,
            claim.provenance.extractorVersion ?? null,
            claim.provenance.promptVersion ?? null,
            claim.provenance.model ?? null,
            claim.provenance.runId ?? null,
            claim.provenance.timestamp
          ]
        );

        for (const inferenceId of claim.inferenceIds) {
          await tx.execute(
            `INSERT OR IGNORE INTO claim_inferences (claim_id, inference_id) VALUES (?, ?)`,
            [claim.id, inferenceId]
          );
        }
      }
    });
  }

  async findClaimsForOpportunity(opportunityId: string): Promise<Claim[]> {
    const rows = await this.db.many<any>(
      `
      SELECT c.*, group_concat(ci.inference_id) as inference_ids
      FROM claims c
      LEFT JOIN claim_inferences ci ON c.id = ci.claim_id
      WHERE c.opportunity_id = ?
      GROUP BY c.id
      `,
      [opportunityId]
    );

    return rows.map(row => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      statement: row.statement,
      confidence: row.confidence,
      inferenceIds: row.inference_ids ? row.inference_ids.split(",") : [],
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
    }));
  }
}
