/**
 * cip.ts (Candidate Intelligence Pipeline)
 *
 * Implements Phase 3 (Candidate Intelligence Pipeline).
 * Ingests raw candidate portfolio/CV signals, projects the CandidateProjection
 * (with embedded claims referencing evidence), and stores them inside SQLite or Turso.
 */

import { getDatabase } from "../../data/sqlite/provider";
import type { CandidateProjection, Claim, Evidence } from "../domain/candidate";
import type { CandidateIntent } from "../domain/intent";
import rawProfile from "../../data/candidate-profile.json";

let cachedDossier: {
  projection: CandidateProjection;
  intent: CandidateIntent;
} | null = null;

export function invalidateCandidateDossierCache() {
  cachedDossier = null;
}

export class CandidateIntelligencePipeline {
  private db = getDatabase();

  /**
   * Run compilation on raw candidate-profile to generate the Projection and Intent.
   */
  public compile(profilePath?: string, providedProfile?: any): {
    projection: CandidateProjection;
    intent: CandidateIntent;
  } {
    if (cachedDossier && !profilePath && !providedProfile) {
      return cachedDossier;
    }
    let raw: any = providedProfile || rawProfile;

    if (!providedProfile && typeof window === "undefined") {
      try {
        const req = typeof require !== "undefined" ? require : null;
        if (req) {
          const fs = req("fs");
          const path = req("path");
          const targetPath = profilePath || path.resolve(process.cwd(), "src/data/candidate-profile.json");
          if (fs.existsSync(targetPath)) {
            raw = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
          }
        }
      } catch (err) {
        // Fallback to static rawProfile
      }
    }

    const candidateId = raw.userId || raw.session?.userId || "guest-user";
    const personId = candidateId;
    const email = raw.email || raw.session?.email || "guest@radar.advisory";

    // 1. Compile Evidence array from achievements and evidence array
    const evidenceList: Evidence[] = [];
    
    // Convert raw evidence array
    const rawEvidence = raw.evidence || [];
    for (let i = 0; i < rawEvidence.length; i++) {
      const e = rawEvidence[i];
      evidenceList.push({
        id: `ev_raw_${i}`,
        sourceId: "candidate-profile-json",
        text: e.proof,
        section: e.type,
        qualityScore: 0.95,
        createdAt: new Date().toISOString()
      });
    }

    // Convert achievements
    const achievements = raw.experience?.achievements || [];
    for (let i = 0; i < achievements.length; i++) {
      const ach = achievements[i];
      evidenceList.push({
        id: `ev_ach_${i}`,
        sourceId: "candidate-profile-json",
        text: ach,
        section: "Achievements",
        qualityScore: 0.90,
        createdAt: new Date().toISOString()
      });
    }

    // 2. Compile Embedded Claims referencing Evidence IDs
    const claims: Claim[] = [];
    
    // Derive claims based on matched categories or keywords
    const rawCapabilities = raw.capabilities || {};
    for (const [category, skills] of Object.entries(rawCapabilities)) {
      const skillsArray = skills as string[];
      for (const skill of skillsArray) {
        // Find matching evidence for this skill/capability via simple regex lookup
        const matchingEv = evidenceList
          .filter(ev => ev.text.toLowerCase().includes(skill.toLowerCase()))
          .map(ev => ev.id);

        claims.push({
          statement: `Proven experience and competence in ${skill}`,
          confidence: matchingEv.length > 0 ? 0.95 : 0.80,
          evidenceIds: matchingEv
        });
      }
    }

    // 3. Construct CandidateProjection
    const timeline = [
      {
        id: "exp_1",
        role: raw.identity?.currentTitle || "Executive Leader",
        company: "Executive Portfolio",
        location: "Global",
        startDate: "2018-01-01",
        endDate: undefined,
        description: raw.executiveIdentity?.valueProposition
      }
    ];

    const flatSkills: string[] = [];
    for (const skills of Object.values(rawCapabilities)) {
      flatSkills.push(...(skills as string[]));
    }

    const projection: CandidateProjection = {
      id: candidateId,
      personId,
      timeline,
      skills: Array.from(new Set(flatSkills)),
      claims,
      updatedAt: new Date().toISOString()
    };

    // 4. Construct CandidateIntent
    const intent: CandidateIntent = {
      id: `intent_${candidateId}`,
      candidateId,
      desiredRoles: raw.strategy?.targetTitles || ["Executive Leader"],
      preferredLocations: raw.preferences?.locations || ["Global"],
      salaryBand: {
        min: parseInt(raw.preferences?.targetMinSalary?.replace(/[^0-9]/g, "") || "18000000"),
        max: parseInt(raw.preferences?.targetMinSalary?.replace(/[^0-9]/g, "") || "18000000") * 1.5,
        currency: "INR"
      },
      industries: raw.preferences?.industries || ["Various"],
      updatedAt: new Date().toISOString()
    };

    // 5. Persist to Database asynchronously (fire and forget or background sync)
    this.persist(projection, intent, email).catch(() => {});

    const result = { projection, intent };
    if (!profilePath && !providedProfile) {
      cachedDossier = result;
    }

    return result;
  }

  /**
   * Save compiled projection & intent to database tables.
   */
  private async persist(projection: CandidateProjection, intent: CandidateIntent, email: string): Promise<void> {
    // Upsert people record first to avoid foreign key errors
    await this.db.execute(
      `
      INSERT INTO people (id, email)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      `,
      [projection.id, email]
    );

    // Upsert candidate_projection table
    await this.db.execute(
      `
      INSERT INTO candidate_projection (id, person_id, timeline, skills, claims, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        timeline = excluded.timeline,
        skills = excluded.skills,
        claims = excluded.claims,
        updated_at = excluded.updated_at
      `,
      [
        projection.id,
        projection.personId,
        JSON.stringify(projection.timeline),
        JSON.stringify(projection.skills),
        JSON.stringify(projection.claims),
        projection.updatedAt
      ]
    );

    // Upsert intent table
    await this.db.execute(
      `
      INSERT INTO intent (id, candidate_id, desired_roles, preferred_locations, salary_band, industries, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        desired_roles = excluded.desired_roles,
        preferred_locations = excluded.preferred_locations,
        salary_band = excluded.salary_band,
        industries = excluded.industries,
        updated_at = excluded.updated_at
      `,
      [
        intent.id,
        intent.candidateId,
        JSON.stringify(intent.desiredRoles),
        JSON.stringify(intent.preferredLocations),
        JSON.stringify(intent.salaryBand),
        JSON.stringify(intent.industries),
        intent.updatedAt
      ]
    );
  }

  /**
   * Helper to fetch active projection and intent. Compile on-the-fly to keep cache 100% in-sync.
   */
  public getActiveDossier(profile?: any): {
    projection: CandidateProjection;
    intent: CandidateIntent;
  } {
    return this.compile(undefined, profile);
  }
}
