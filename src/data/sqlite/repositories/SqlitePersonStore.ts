import type { DatabaseAdapter } from "../../database/adapter";
import type { PersonStore } from "../../../domain/repositories";
import type { Person, CandidateProfile, ResumeVersion } from "../../../domain/entities";

export class SqlitePersonStore implements PersonStore {
  constructor(private db: DatabaseAdapter) {}

  async registerPerson(person: Person): Promise<void> {
    await this.db.execute(
      `
      INSERT INTO people (
        id, email, created_at, updated_at,
        meta_schema_version, meta_extractor_version, meta_prompt_version, meta_model, meta_run_id, meta_timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        updated_at = excluded.updated_at
      `,
      [
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
      ]
    );
  }

  async getPersonByEmail(email: string): Promise<Person | undefined> {
    const row = await this.db.one<any>(`SELECT * FROM people WHERE email = ?`, [email]);
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

  async getCandidateState(personId: string): Promise<any | undefined> {
    const row = await this.db.one<{ candidate_state: string }>(
      `SELECT candidate_state FROM people WHERE id = ?`,
      [personId]
    );
    if (!row || !row.candidate_state) return undefined;
    try {
      return JSON.parse(row.candidate_state);
    } catch (e) {
      console.error("[SqlitePersonStore] Failed to parse candidate_state JSON for user:", personId);
      return undefined;
    }
  }

  async saveCandidateState(personId: string, state: any): Promise<void> {
    const stateStr = JSON.stringify(state);
    await this.db.execute(
      `UPDATE people SET candidate_state = ? WHERE id = ?`,
      [stateStr, personId]
    );
  }

  async saveCandidateProfile(profile: CandidateProfile): Promise<void> {
    throw new Error("Method not implemented.");
  }
  
  async saveResumeVersion(version: ResumeVersion): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async getCandidateProfile(personId: string, version: string): Promise<CandidateProfile | undefined> {
    throw new Error("Method not implemented.");
  }
  
  async getLatestCandidateProfile(personId: string): Promise<CandidateProfile | undefined> {
    throw new Error("Method not implemented.");
  }
  
  async getResumeVersions(candidateProfileId: string): Promise<ResumeVersion[]> {
    throw new Error("Method not implemented.");
  }
}
