import type { Database } from "better-sqlite3";
import type { OpportunityStore } from "../../../domain/repositories";
import type { Opportunity } from "../../../domain/entities";

export class SqliteOpportunityStore implements OpportunityStore {
  constructor(private db: Database) {}

  mergeOpportunity(opportunity: Opportunity): void {
    const stmt = this.db.prepare(`
      INSERT INTO opportunities (
        id, company_id, canonical_title, location, employment_type, posting_window, fingerprint, lifecycle,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        canonical_title = excluded.canonical_title,
        location = excluded.location,
        employment_type = excluded.employment_type,
        posting_window = excluded.posting_window,
        lifecycle = excluded.lifecycle,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      opportunity.id,
      opportunity.companyId,
      opportunity.canonicalTitle,
      opportunity.location ?? null,
      opportunity.employmentType ?? null,
      opportunity.postingWindow ?? null,
      opportunity.fingerprint,
      opportunity.lifecycle,
      opportunity.createdAt,
      opportunity.updatedAt,
      opportunity.provenance.schemaVersion,
      opportunity.provenance.extractorVersion ?? null,
      opportunity.provenance.promptVersion ?? null,
      opportunity.provenance.model ?? null,
      opportunity.provenance.runId ?? null,
      opportunity.provenance.timestamp
    );
  }

  getOpportunity(id: string): Opportunity | undefined {
    const row = this.db.prepare(`SELECT * FROM opportunities WHERE id = ?`).get(id) as any;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  listActiveOpportunities(): Opportunity[] {
    const rows = this.db.prepare(`SELECT * FROM opportunities WHERE lifecycle != 'Archived'`).all() as any[];
    return rows.map(r => this.mapRow(r));
  }

  findOpportunities(criteria: { companyId?: string; lifecycle?: string; }): Opportunity[] {
    let sql = `SELECT * FROM opportunities WHERE 1=1`;
    const params: any[] = [];
    if (criteria.companyId) {
      sql += ` AND company_id = ?`;
      params.push(criteria.companyId);
    }
    if (criteria.lifecycle) {
      sql += ` AND lifecycle = ?`;
      params.push(criteria.lifecycle);
    }
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.mapRow(r));
  }

  private mapRow(row: any): Opportunity {
    return {
      id: row.id,
      companyId: row.company_id,
      canonicalTitle: row.canonical_title,
      location: row.location,
      employmentType: row.employment_type,
      postingWindow: row.posting_window,
      fingerprint: row.fingerprint,
      lifecycle: row.lifecycle,
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
