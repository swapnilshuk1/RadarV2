import type { Database } from "better-sqlite3";
import type { PersonStore } from "../../../domain/repositories";
import type { Person, CareerProfile, PreferenceProfile } from "../../../domain/entities";

export class SqlitePersonStore implements PersonStore {
  constructor(private db: Database) {}

  registerPerson(person: Person): void {
    const stmt = this.db.prepare(`
      INSERT INTO people (id, email, created_at, updated_at, meta_schema_version)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        updated_at = excluded.updated_at
    `);
    
    stmt.run(
      person.id,
      person.email,
      person.createdAt,
      person.updatedAt,
      person._meta.schemaVersion
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
      _meta: { schemaVersion: row.meta_schema_version }
    };
  }

  saveCareerProfile(profile: CareerProfile): void {
    const stmt = this.db.prepare(`
      INSERT INTO career_profiles (
        id, person_id, timeline, skills, achievements, created_at, updated_at, meta_schema_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        timeline = excluded.timeline,
        skills = excluded.skills,
        achievements = excluded.achievements,
        updated_at = excluded.updated_at
    `);
    
    stmt.run(
      profile.id,
      profile.personId,
      JSON.stringify(profile.timeline),
      JSON.stringify(profile.skills),
      JSON.stringify(profile.achievements),
      profile.createdAt,
      profile.updatedAt,
      profile._meta.schemaVersion
    );
  }

  getCareerProfile(personId: string): CareerProfile | undefined {
    const row = this.db.prepare(`SELECT * FROM career_profiles WHERE person_id = ?`).get(personId) as any;
    if (!row) return undefined;
    
    return {
      id: row.id,
      personId: row.person_id,
      timeline: JSON.parse(row.timeline),
      skills: JSON.parse(row.skills),
      achievements: JSON.parse(row.achievements),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: { schemaVersion: row.meta_schema_version }
    };
  }

  savePreferenceProfile(profile: PreferenceProfile): void {
    const stmt = this.db.prepare(`
      INSERT INTO preference_profiles (
        id, person_id, remote, preferred_industries, target_compensation, travel_willingness,
        company_size, international, startups, public_companies, created_at, updated_at, meta_schema_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        remote = excluded.remote,
        preferred_industries = excluded.preferred_industries,
        target_compensation = excluded.target_compensation,
        travel_willingness = excluded.travel_willingness,
        company_size = excluded.company_size,
        international = excluded.international,
        startups = excluded.startups,
        public_companies = excluded.public_companies,
        updated_at = excluded.updated_at
    `);
    
    stmt.run(
      profile.id,
      profile.personId,
      profile.remote ? 1 : 0,
      JSON.stringify(profile.preferredIndustries),
      profile.targetCompensation || null,
      profile.travelWillingness || null,
      profile.companySize ? JSON.stringify(profile.companySize) : null,
      profile.international ? 1 : 0,
      profile.startups ? 1 : 0,
      profile.publicCompanies ? 1 : 0,
      profile.createdAt,
      profile.updatedAt,
      profile._meta.schemaVersion
    );
  }

  getPreferenceProfile(personId: string): PreferenceProfile | undefined {
    const row = this.db.prepare(`SELECT * FROM preference_profiles WHERE person_id = ?`).get(personId) as any;
    if (!row) return undefined;
    
    return {
      id: row.id,
      personId: row.person_id,
      remote: !!row.remote,
      preferredIndustries: JSON.parse(row.preferred_industries),
      targetCompensation: row.target_compensation,
      travelWillingness: row.travel_willingness,
      companySize: row.company_size ? JSON.parse(row.company_size) : undefined,
      international: !!row.international,
      startups: !!row.startups,
      publicCompanies: !!row.public_companies,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: { schemaVersion: row.meta_schema_version }
    };
  }
}
