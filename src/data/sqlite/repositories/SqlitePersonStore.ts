import type { DatabaseAdapter } from "../../database/adapter";
import type { PersonStore } from "../../../domain/repositories";
import type { Person, ResumeVersion } from "../../../domain/entities";
import { type CandidateProjection, validateCandidateProjection, DEFAULT_CANDIDATE_PROJECTION } from "../../../lib/domain/candidate_projection";

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

  async saveProjection(personId: string, projection: CandidateProjection): Promise<void> {
    const validation = validateCandidateProjection(projection);
    if (!validation.valid) {
      console.warn(
        `[SqlitePersonStore.saveProjection] Warning: saving projection for ${personId} with missing fields: [${validation.missingFields.join(", ")}]`
      );
    }

    const profileId = `profile-${personId}`; // Enforce single active profile per user for now
    const projectionJson = JSON.stringify(projection);
    const now = new Date().toISOString();
    
    // Extract queryable scalar columns from projection
    const currentTitle = "Executive"; // No longer in projection, stored in identity
    const yearsExperience = projection.yearsOfExperience || 0;
    const archetype = projection.executiveThemes?.[0] || "";
    const preferredWorkModel = projection.preferredWorkModel || "ANY";

    await this.db.execute(
      `
      INSERT INTO career_profiles (
        id, person_id, timeline, skills, 
        projection_json, projection_generated_at,
        current_title, years_experience, archetype, preferred_work_model,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        projection_json = excluded.projection_json,
        projection_generated_at = excluded.projection_generated_at,
        current_title = excluded.current_title,
        years_experience = excluded.years_experience,
        archetype = excluded.archetype,
        preferred_work_model = excluded.preferred_work_model,
        updated_at = excluded.updated_at
      `,
      [
        profileId, personId, "[]", "[]", // Dummy timeline/skills for NOT NULL constraints
        projectionJson, now,
        currentTitle, yearsExperience, archetype, preferredWorkModel,
        now, now
      ]
    );
  }
  
  async saveResumeVersion(version: ResumeVersion): Promise<void> {
    throw new Error("Method not implemented.");
  }

  async getLatestProjection(personId: string): Promise<CandidateProjection | undefined> {
    const row = await this.db.one<{ projection_json: string }>(
      `SELECT projection_json FROM career_profiles WHERE person_id = ? ORDER BY created_at DESC LIMIT 1`,
      [personId]
    );
    if (!row || !row.projection_json) {
      return DEFAULT_CANDIDATE_PROJECTION;
    }
    
    try {
      const parsed = JSON.parse(row.projection_json) as CandidateProjection;
      const validation = validateCandidateProjection(parsed);
      if (!validation.valid) {
        console.error(
          `[SqlitePersonStore] Stored projection for user '${personId}' failed integrity check: missing [${validation.missingFields.join(", ")}]. Stored projection is invalid/incomplete.`
        );
        return undefined;
      }
      return parsed;
    } catch (e) {
      console.error("[SqlitePersonStore] Failed to parse projection_json:", personId);
      return undefined;
    }
  }

  
  async getResumeVersions(candidateProfileId: string): Promise<ResumeVersion[]> {
    throw new Error("Method not implemented.");
  }
}
