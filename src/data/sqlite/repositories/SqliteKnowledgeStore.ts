import type { Database } from "better-sqlite3";
import type { KnowledgeStore } from "../../../domain/repositories";
import type { Evidence, Fact } from "../../../domain/entities";

export class SqliteKnowledgeStore implements KnowledgeStore {
  constructor(private db: Database) {}

  recordEvidence(evidenceList: Evidence[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO evidence (
        id, document_id, text, section, quality_score,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        section = excluded.section,
        quality_score = excluded.quality_score,
        updated_at = excluded.updated_at
    `);

    this.db.transaction(() => {
      for (const ev of evidenceList) {
        stmt.run(
          ev.id,
          ev.documentId,
          ev.text,
          ev.section ?? null,
          ev.qualityScore,
          ev.createdAt,
          ev.updatedAt,
          ev.provenance.schemaVersion,
          ev.provenance.extractorVersion ?? null,
          ev.provenance.promptVersion ?? null,
          ev.provenance.model ?? null,
          ev.provenance.runId ?? null,
          ev.provenance.timestamp
        );
      }
    })();
  }

  recordFacts(facts: Fact[]): void {
    const factStmt = this.db.prepare(`
      INSERT INTO facts (
        id, opportunity_id, attribute, value,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      -- Facts are Immutable
      ON CONFLICT(id) DO NOTHING
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
          fact.provenance.schemaVersion,
          fact.provenance.extractorVersion ?? null,
          fact.provenance.promptVersion ?? null,
          fact.provenance.model ?? null,
          fact.provenance.runId ?? null,
          fact.provenance.timestamp
        );

        for (const evId of fact.evidenceIds) {
          linkStmt.run(fact.id, evId);
        }
      }
    })();
  }

  findEvidenceForDocument(documentId: string): Evidence[] {
    const rows = this.db.prepare(`SELECT * FROM evidence WHERE document_id = ?`).all(documentId) as any[];
    return rows.map(r => this.mapEvidenceRow(r));
  }

  findFactsForOpportunity(opportunityId: string): Fact[] {
    const rows = this.db.prepare(`
      SELECT f.*, group_concat(fe.evidence_id) as evidence_ids
      FROM facts f
      LEFT JOIN fact_evidence fe ON f.id = fe.fact_id
      WHERE f.opportunity_id = ?
      GROUP BY f.id
    `).all(opportunityId) as any[];

    return rows.map(r => ({
      id: r.id,
      opportunityId: r.opportunity_id,
      attribute: r.attribute,
      value: JSON.parse(r.value),
      evidenceIds: r.evidence_ids ? r.evidence_ids.split(",") : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      provenance: {
        schemaVersion: r.meta_schema_version,
        extractorVersion: r.meta_extractor_version,
        promptVersion: r.meta_prompt_version,
        model: r.meta_model,
        runId: r.meta_run_id,
        timestamp: r.meta_timestamp
      }
    }));
  }

  private mapEvidenceRow(row: any): Evidence {
    return {
      id: row.id,
      documentId: row.document_id,
      text: row.text,
      section: row.section,
      qualityScore: row.quality_score,
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
