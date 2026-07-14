import type { Database } from "better-sqlite3";
import type { CompanyStore } from "../../../domain/repositories";
import type { Company } from "../../../domain/entities";

export class SqliteCompanyStore implements CompanyStore {
  constructor(private db: Database) {}

  registerCompany(company: Company): void {
    const stmt = this.db.prepare(`
      INSERT INTO companies (
        id, name, industry, hq, size, tech_stack,
        hiring_velocity, growth_signal, leadership_changes, technology_adoption, executive_turnover,
        created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_benchmark_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        industry = excluded.industry,
        hq = excluded.hq,
        size = excluded.size,
        tech_stack = excluded.tech_stack,
        updated_at = excluded.updated_at,
        meta_schema_version = excluded.meta_schema_version
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
      company.leadershipChanges ?? null,
      company.technologyAdoption ?? null,
      company.executiveTurnover ?? null,
      company.createdAt,
      company.updatedAt,
      company._meta.schemaVersion,
      company._meta.extractorVersion ?? null,
      company._meta.promptVersion ?? null,
      company._meta.model ?? null,
      company._meta.benchmarkVersion ?? null
    );
  }

  findByName(name: string): Company | undefined {
    // Case-insensitive search on company name
    const row = this.db.prepare(`SELECT * FROM companies WHERE LOWER(name) = LOWER(?)`).get(name) as any;
    if (!row) return undefined;

    return {
      id: row.id,
      name: row.name,
      industry: row.industry,
      hq: row.hq,
      size: row.size,
      techStack: row.tech_stack ? JSON.parse(row.tech_stack) : undefined,
      hiringVelocity: row.hiring_velocity,
      growthSignal: row.growth_signal,
      leadershipChanges: row.leadership_changes,
      technologyAdoption: row.technology_adoption,
      executiveTurnover: row.executive_turnover,
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

  updateIntelligenceSignals(id: string, signals: Partial<Company>): void {
    const sets: string[] = [];
    const params: any[] = [];
    
    if (signals.hiringVelocity !== undefined) { sets.push("hiring_velocity = ?"); params.push(signals.hiringVelocity); }
    if (signals.growthSignal !== undefined) { sets.push("growth_signal = ?"); params.push(signals.growthSignal); }
    if (signals.leadershipChanges !== undefined) { sets.push("leadership_changes = ?"); params.push(signals.leadershipChanges); }
    if (signals.technologyAdoption !== undefined) { sets.push("technology_adoption = ?"); params.push(signals.technologyAdoption); }
    if (signals.executiveTurnover !== undefined) { sets.push("executive_turnover = ?"); params.push(signals.executiveTurnover); }
    
    if (sets.length === 0) return;
    
    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);
    
    this.db.prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }
}
