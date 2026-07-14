import type { Database } from "better-sqlite3";
import type { OpportunityStore } from "../../../domain/repositories";
import type { Opportunity, SourceListing } from "../../../domain/entities";

export class SqliteOpportunityStore implements OpportunityStore {
  constructor(private db: Database) {}

  mergeOpportunity(opportunity: Opportunity): void {
    const stmt = this.db.prepare(`
      INSERT INTO opportunities (
        id, company_id, canonical_role, status, created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_benchmark_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        company_id = excluded.company_id,
        canonical_role = excluded.canonical_role,
        status = excluded.status,
        updated_at = excluded.updated_at,
        meta_schema_version = excluded.meta_schema_version,
        meta_extractor_version = excluded.meta_extractor_version,
        meta_prompt_version = excluded.meta_prompt_version,
        meta_model = excluded.meta_model,
        meta_benchmark_version = excluded.meta_benchmark_version
    `);

    stmt.run(
      opportunity.id,
      opportunity.companyId,
      opportunity.canonicalRole,
      opportunity.status,
      opportunity.createdAt,
      opportunity.updatedAt,
      opportunity._meta.schemaVersion,
      opportunity._meta.extractorVersion ?? null,
      opportunity._meta.promptVersion ?? null,
      opportunity._meta.model ?? null,
      opportunity._meta.benchmarkVersion ?? null
    );
  }

  recordListing(listing: SourceListing): void {
    const stmt = this.db.prepare(`
      INSERT INTO source_listings (
        id, opportunity_id, portal, url, posted_at, recruiter, salary_metadata, raw_html_path,
        created_at, updated_at, meta_schema_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        opportunity_id = excluded.opportunity_id,
        portal = excluded.portal,
        url = excluded.url,
        posted_at = excluded.posted_at,
        recruiter = excluded.recruiter,
        salary_metadata = excluded.salary_metadata,
        raw_html_path = excluded.raw_html_path,
        updated_at = excluded.updated_at,
        meta_schema_version = excluded.meta_schema_version
    `);

    stmt.run(
      listing.id,
      listing.opportunityId,
      listing.portal,
      listing.url,
      listing.postedAt ?? null,
      listing.recruiter ?? null,
      listing.salaryMetadata ?? null,
      listing.rawHtmlPath ?? null,
      listing.createdAt,
      listing.updatedAt,
      listing._meta.schemaVersion
    );
  }

  getOpportunity(id: string): Opportunity | undefined {
    const row = this.db.prepare(`SELECT * FROM opportunities WHERE id = ?`).get(id) as any;
    if (!row) return undefined;

    return {
      id: row.id,
      companyId: row.company_id,
      canonicalRole: row.canonical_role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: {
        schemaVersion: row.meta_schema_version,
        extractorVersion: row.meta_extractor_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model,
        benchmarkVersion: row.meta_benchmark_version
      }
    };
  }

  listActiveOpportunities(): Opportunity[] {
    const rows = this.db.prepare(`SELECT * FROM opportunities WHERE status = 'Active'`).all() as any[];
    return rows.map(row => ({
      id: row.id,
      companyId: row.company_id,
      canonicalRole: row.canonical_role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: {
        schemaVersion: row.meta_schema_version,
        extractorVersion: row.meta_extractor_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model,
        benchmarkVersion: row.meta_benchmark_version
      }
    }));
  }

  findOpportunities(criteria: { level?: string; industry?: string; minScore?: number; status?: string; }): Opportunity[] {
    // A simplified query for now. Sprint 4 (Search Planner) will expand this.
    let sql = `SELECT * FROM opportunities WHERE 1=1`;
    const params: any[] = [];

    if (criteria.status) {
      sql += ` AND status = ?`;
      params.push(criteria.status);
    }
    
    // In a real execution, we'd JOIN matches, companies, etc. depending on criteria.

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      companyId: row.company_id,
      canonicalRole: row.canonical_role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: {
        schemaVersion: row.meta_schema_version,
        extractorVersion: row.meta_extractor_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model,
        benchmarkVersion: row.meta_benchmark_version
      }
    }));
  }
}
