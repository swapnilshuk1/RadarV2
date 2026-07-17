import type { Database } from "better-sqlite3";
import type { CompanyStore } from "../../../domain/repositories";
import type { Company } from "../../../domain/entities";

export class SqliteCompanyStore implements CompanyStore {
  constructor(private db: Database) {}

  registerCompany(company: Company): void {
    const stmt = this.db.prepare(`
      INSERT INTO companies (
        id, name, industry, hq, size, tech_stack, hiring_velocity, growth_signal,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        industry = excluded.industry,
        hq = excluded.hq,
        size = excluded.size,
        tech_stack = excluded.tech_stack,
        hiring_velocity = excluded.hiring_velocity,
        growth_signal = excluded.growth_signal,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      company.id,
      company.name,
      company.industry ?? null,
      company.hq ?? null,
      company.size ?? null,
      company.techStack ? JSON.stringify(company.techStack) : null,
      company.hiringVelocity ?? null,
      company.growthSignal ?? null,
      company.createdAt,
      company.updatedAt,
      company.provenance.schemaVersion,
      company.provenance.extractorVersion ?? null,
      company.provenance.promptVersion ?? null,
      company.provenance.model ?? null,
      company.provenance.runId ?? null,
      company.provenance.timestamp
    );
  }

  findByName(name: string): Company | undefined {
    const row = this.db.prepare(`SELECT * FROM companies WHERE name = ? COLLATE NOCASE`).get(name) as any;
    if (!row) return undefined;
    return this.mapRow(row);
  }

  private mapRow(row: any): Company {
    return {
      id: row.id,
      name: row.name,
      industry: row.industry,
      hq: row.hq,
      size: row.size,
      techStack: row.tech_stack ? JSON.parse(row.tech_stack) : undefined,
      hiringVelocity: row.hiring_velocity,
      growthSignal: row.growth_signal,
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
