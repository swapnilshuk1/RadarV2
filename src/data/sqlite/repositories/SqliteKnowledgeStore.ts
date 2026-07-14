import type { Database } from "better-sqlite3";
import type { KnowledgeStore } from "../../../domain/repositories";
import type { Evidence, Fact } from "../../../domain/entities";

export class SqliteKnowledgeStore implements KnowledgeStore {
  constructor(private db: Database) {}

  recordEvidence(evidenceList: Evidence[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO evidence (
        id, source_listing_id, text, source_type, quality_score,
        created_at, updated_at, meta_schema_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        source_type = excluded.source_type,
        quality_score = excluded.quality_score,
        updated_at = excluded.updated_at
    `);

    this.db.transaction(() => {
      for (const ev of evidenceList) {
        stmt.run(
          ev.id,
          ev.sourceListingId,
          ev.text,
          ev.sourceType,
          ev.qualityScore,
          ev.createdAt,
          ev.updatedAt,
          ev._meta.schemaVersion
        );
      }
    })();
  }

  recordFacts(facts: Fact[]): void {
    const factStmt = this.db.prepare(`
      INSERT INTO facts (
        id, opportunity_id, attribute, value,
        created_at, updated_at, meta_schema_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        attribute = excluded.attribute,
        value = excluded.value,
        updated_at = excluded.updated_at
    `);

    const linkStmt = this.db.prepare(`
      INSERT OR IGNORE INTO fact_evidence (fact_id, evidence_id) VALUES (?, ?)
    `);

    this.db.transaction(() => {
      for (const fact of facts) {
        factStmt.run(
          fact.id,
          fact.opportunityId,
          fact.attribute,
          JSON.stringify(fact.value),
          fact.createdAt,
          fact.updatedAt,
          fact._meta.schemaVersion
        );
        
        for (const evId of fact.evidenceIds) {
          linkStmt.run(fact.id, evId);
        }
      }
    })();
  }

  findEvidenceForOpportunity(opportunityId: string): Evidence[] {
    const rows = this.db.prepare(`
      SELECT e.* 
      FROM evidence e
      JOIN source_listings sl ON e.source_listing_id = sl.id
      WHERE sl.opportunity_id = ?
    `).all(opportunityId) as any[];

    return rows.map(row => ({
      id: row.id,
      sourceListingId: row.source_listing_id,
      text: row.text,
      sourceType: row.source_type,
      qualityScore: row.quality_score,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: {
        schemaVersion: row.meta_schema_version
      }
    }));
  }

  findFactsForOpportunity(opportunityId: string): Fact[] {
    const rows = this.db.prepare(`
      SELECT f.*, group_concat(fe.evidence_id) as evidence_ids
      FROM facts f
      LEFT JOIN fact_evidence fe ON f.id = fe.fact_id
      WHERE f.opportunity_id = ?
      GROUP BY f.id
    `).all(opportunityId) as any[];

    return rows.map(row => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      attribute: row.attribute,
      value: JSON.parse(row.value),
      evidenceIds: row.evidence_ids ? row.evidence_ids.split(",") : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: {
        schemaVersion: row.meta_schema_version
      }
    }));
  }
}
