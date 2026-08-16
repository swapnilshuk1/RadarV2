import type { DatabaseAdapter } from "../../database/adapter";
import type { OpportunityStore } from "../../../domain/repositories";
import type { Opportunity } from "../../../domain/entities";
import type { OpportunitySource } from "../../../data/opportunity-fixtures";

export class SqliteOpportunityStore implements OpportunityStore {
  constructor(private db: DatabaseAdapter) {}

  async mergeOpportunity(opportunity: Opportunity): Promise<void> {
    await this.db.execute(
      `
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
      `,
      [
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
      ]
    );
  }

  async getOpportunity(id: string): Promise<Opportunity | undefined> {
    const row = await this.db.one<any>(`SELECT * FROM opportunities WHERE id = ?`, [id]);
    if (!row) return undefined;
    return this.mapRow(row);
  }

  async listActiveOpportunities(): Promise<Opportunity[]> {
    const rows = await this.db.many<any>(`SELECT * FROM opportunities WHERE lifecycle != 'Archived'`);
    return rows.map(r => this.mapRow(r));
  }

  async getQueueOpportunities(personId: string, limit = 20): Promise<Opportunity[]> {
    const sql = `
      SELECT o.*
      FROM opportunities o
      LEFT JOIN decisions d ON d.opportunity_id = o.fingerprint AND d.person_id = ?
      WHERE o.lifecycle != 'Archived' AND (d.action IS NULL OR d.action != 'PASS')
      ORDER BY o.created_at DESC
      LIMIT ?
    `;
    try {
      const rows = await this.db.many<any>(sql, [personId, limit]);
      if (!rows || rows.length === 0) {
        return this.listActiveOpportunities();
      }
      return rows.map(r => this.mapRow(r));
    } catch (err: any) {
      console.error("⚠️ [SqliteOpportunityStore] getQueueOpportunities failed:", err.message);
      return this.listActiveOpportunities();
    }
  }

  async findOpportunities(criteria: { companyId?: string; lifecycle?: string; }): Promise<Opportunity[]> {
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
    const rows = await this.db.many<any>(sql, params);
    return rows.map(r => this.mapRow(r));
  }

  async listOpportunitySources(): Promise<OpportunitySource[]> {
    const sql = `
      WITH RankedOpps AS (
        SELECT o.rowid as rid, o.id as id, o.canonical_title as canonical_title, o.location as location,
               c.name as company_name, d.content as doc_content,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(json_extract(d.content, '$.jobHash'), o.id)
                 ORDER BY 
                   CASE WHEN d.content IS NOT NULL AND json_extract(d.content, '$.normalizedText') IS NOT NULL AND length(json_extract(d.content, '$.normalizedText')) > 0 THEN 0 ELSE 1 END,
                   o.rowid ASC
               ) as rn
        FROM opportunities o
        LEFT JOIN companies c ON o.company_id = c.id
        LEFT JOIN documents d ON d.opportunity_id = o.id
        WHERE o.lifecycle != 'Archived'
      )
      SELECT id, canonical_title, location, company_name, doc_content
      FROM RankedOpps
      WHERE rn = 1
    `;
    const rows = await this.db.many<any>(sql);
    const jobHashMap = new Map<string, OpportunitySource>();

    for (const r of rows) {
      let contentObj: any = {};
      if (r.doc_content) {
        try {
          contentObj = typeof r.doc_content === "string" ? JSON.parse(r.doc_content) : r.doc_content;
        } catch {}
      }

      const jobHash = contentObj.jobHash || r.id;
      const oppSource: OpportunitySource = {
        jobHash,
        role: r.canonical_title || contentObj.role || "Executive Role",
        company: r.company_name || contentObj.company || "Target Company",
        location: r.location || contentObj.location || "Remote",
        scrapedFrom: contentObj.scrapedFrom || "LinkedIn",
        postedRelative: contentObj.postedRelative || "Recently Ingested",
        rawText: contentObj.normalizedText || contentObj.rawText || contentObj.rawDescription || "",
        dimensions: Array.isArray(contentObj.dimensions) ? contentObj.dimensions : [],
        primaryConcern: contentObj.primaryConcern || null,
        whyNow: contentObj.whyNow,
        positioning: Array.isArray(contentObj.positioning) ? contentObj.positioning : [],
        applyUrl: contentObj.applyUrl || contentObj.url,
        primaryProof: contentObj.primaryProof,
        headspaceInvestment: contentObj.headspaceInvestment,
        hiringRisk: contentObj.hiringRisk,
        alternativePath: contentObj.alternativePath,
      };

      const existing = jobHashMap.get(jobHash);
      if (!existing || (!existing.rawText && oppSource.rawText)) {
        jobHashMap.set(jobHash, oppSource);
      }
    }

    return Array.from(jobHashMap.values());
  }

  async getOpportunitySource(jobHash: string): Promise<OpportunitySource | undefined> {
    const sql = `
      SELECT o.id as id, o.canonical_title as canonical_title, o.location as location,
             c.name as company_name, d.content as doc_content
      FROM opportunities o
      LEFT JOIN companies c ON o.company_id = c.id
      LEFT JOIN documents d ON d.opportunity_id = o.id
      WHERE o.id = ? OR d.content LIKE ?
      LIMIT 1
    `;
    const row = await this.db.one<any>(sql, [jobHash, `%"jobHash":"${jobHash}"%`]);
    if (!row) return undefined;

    let contentObj: any = {};
    if (row.doc_content) {
      try {
        contentObj = typeof row.doc_content === "string" ? JSON.parse(row.doc_content) : row.doc_content;
      } catch {}
    }

    return {
      jobHash: contentObj.jobHash || row.id,
      role: row.canonical_title || contentObj.role || "Executive Role",
      company: row.company_name || contentObj.company || "Target Company",
      location: row.location || contentObj.location || "Remote",
      scrapedFrom: contentObj.scrapedFrom || "LinkedIn",
      postedRelative: contentObj.postedRelative || "Recently Ingested",
      rawText: contentObj.normalizedText || contentObj.rawText || contentObj.rawDescription || "",
      dimensions: Array.isArray(contentObj.dimensions) ? contentObj.dimensions : [],
      primaryConcern: contentObj.primaryConcern || null,
      whyNow: contentObj.whyNow,
      positioning: Array.isArray(contentObj.positioning) ? contentObj.positioning : [],
      applyUrl: contentObj.applyUrl || contentObj.url,
      primaryProof: contentObj.primaryProof,
      headspaceInvestment: contentObj.headspaceInvestment,
      hiringRisk: contentObj.hiringRisk,
      alternativePath: contentObj.alternativePath,
    };
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
