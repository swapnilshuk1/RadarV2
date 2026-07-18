import type { Database } from "better-sqlite3";
import type { PersonStore } from "../../../domain/repositories";
import type { Person, CandidateProfile, ResumeVersion } from "../../../domain/entities";

export class SqlitePersonStore implements PersonStore {
  constructor(private db: Database) {}

  registerPerson(person: Person): void {
    const stmt = this.db.prepare(`
      INSERT INTO people (
        id, email, created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        updated_at = excluded.updated_at
    `);
    
    stmt.run(
      person.id,
      person.email,
      person.createdAt,
      person.updatedAt,
      person.provenance.schemaVersion,
      person.provenance.extractorVersion ?? null,
      person.provenance.promptVersion ?? null,
      person.provenance.model ?? null,
      person.provenance.runId ?? null,
      person.provenance.timestamp
    );
  }

  getPersonByEmail(email: string): Person | undefined {
    const row = this.db.prepare(`SELECT * FROM people WHERE email = ?`).get(email) as any;
    if (!row) return undefined;
    
    return {
      id: row.id,
      email: row.email,
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

  saveCandidateProfile(profile: CandidateProfile): void {
    throw new Error("Method not implemented.");
  }
  
  saveResumeVersion(version: ResumeVersion): void {
    throw new Error("Method not implemented.");
  }

  getCandidateProfile(personId: string, version: string): CandidateProfile | undefined {
    throw new Error("Method not implemented.");
  }
  
  getLatestCandidateProfile(personId: string): CandidateProfile | undefined {
    throw new Error("Method not implemented.");
  }
  
  getResumeVersions(candidateProfileId: string): ResumeVersion[] {
    throw new Error("Method not implemented.");
  }
}
