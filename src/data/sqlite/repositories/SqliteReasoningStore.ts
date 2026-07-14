import type { Database } from "better-sqlite3";
import type { ReasoningStore } from "../../../domain/repositories";
import type { Claim } from "../../../domain/entities";

export class SqliteReasoningStore implements ReasoningStore {
  constructor(private db: Database) {}

  recordClaims(claims: Claim[]): void {
    const claimStmt = this.db.prepare(`
      INSERT INTO claims (
        id, opportunity_id, statement, confidence,
        created_at, updated_at, meta_schema_version, meta_prompt_version, meta_model
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        statement = excluded.statement,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `);

    const linkStmt = this.db.prepare(`
      INSERT OR IGNORE INTO claim_facts (claim_id, fact_id) VALUES (?, ?)
    `);

    this.db.transaction(() => {
      for (const claim of claims) {
        claimStmt.run(
          claim.id,
          claim.opportunityId,
          claim.statement,
          claim.confidence,
          claim.createdAt,
          claim.updatedAt,
          claim._meta.schemaVersion,
          claim._meta.promptVersion ?? null,
          claim._meta.model ?? null
        );

        for (const factId of claim.factIds) {
          linkStmt.run(claim.id, factId);
        }
      }
    })();
  }

  findClaimsForOpportunity(opportunityId: string): Claim[] {
    const rows = this.db.prepare(`
      SELECT c.*, group_concat(cf.fact_id) as fact_ids
      FROM claims c
      LEFT JOIN claim_facts cf ON c.id = cf.claim_id
      WHERE c.opportunity_id = ?
      GROUP BY c.id
    `).all(opportunityId) as any[];

    return rows.map(row => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      statement: row.statement,
      confidence: row.confidence,
      factIds: row.fact_ids ? row.fact_ids.split(",") : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: {
        schemaVersion: row.meta_schema_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model
      }
    }));
  }
}
