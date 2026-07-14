import type { Database } from "better-sqlite3";
import type { DecisionSupportStore } from "../../../domain/repositories";
import type { Match, Recommendation } from "../../../domain/entities";

export class SqliteDecisionSupportStore implements DecisionSupportStore {
  constructor(private db: Database) {}

  recordMatch(match: Match): void {
    const stmt = this.db.prepare(`
      INSERT INTO matches (
        id, person_id, opportunity_id, capability_score, career_progression_score, strategic_value_score, lifestyle_score, overall_confidence,
        created_at, updated_at, meta_schema_version, meta_prompt_version, meta_model
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        capability_score = excluded.capability_score,
        career_progression_score = excluded.career_progression_score,
        strategic_value_score = excluded.strategic_value_score,
        lifestyle_score = excluded.lifestyle_score,
        overall_confidence = excluded.overall_confidence,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      match.id,
      match.personId,
      match.opportunityId,
      match.capabilityScore,
      match.careerProgressionScore,
      match.strategicValueScore,
      match.lifestyleScore,
      match.overallConfidence,
      match.createdAt,
      match.updatedAt,
      match._meta.schemaVersion,
      match._meta.promptVersion ?? null,
      match._meta.model ?? null
    );
  }

  findMatches(personId: string, opportunityId?: string): Match[] {
    let sql = `SELECT * FROM matches WHERE person_id = ?`;
    const params: any[] = [personId];
    
    if (opportunityId) {
      sql += ` AND opportunity_id = ?`;
      params.push(opportunityId);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      personId: row.person_id,
      opportunityId: row.opportunity_id,
      capabilityScore: row.capability_score,
      careerProgressionScore: row.career_progression_score,
      strategicValueScore: row.strategic_value_score,
      lifestyleScore: row.lifestyle_score,
      overallConfidence: row.overall_confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      _meta: {
        schemaVersion: row.meta_schema_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model
      }
    }));
  }

  recordRecommendation(recommendation: Recommendation): void {
    const stmt = this.db.prepare(`
      INSERT INTO recommendations (
        id, person_id, opportunity_id, match_id, summary, reasons, risks, unknowns, supporting_claims,
        created_at, updated_at, meta_schema_version, meta_prompt_version, meta_model
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      recommendation.id,
      recommendation.personId,
      recommendation.opportunityId,
      recommendation.matchId,
      recommendation.summary,
      JSON.stringify(recommendation.reasons),
      JSON.stringify(recommendation.risks),
      JSON.stringify(recommendation.unknowns),
      JSON.stringify(recommendation.supportingClaims),
      recommendation.createdAt,
      recommendation.updatedAt,
      recommendation._meta.schemaVersion,
      recommendation.promptVersion,
      recommendation.model
    );
  }

  latestRecommendations(personId: string, limit: number): Recommendation[] {
    const rows = this.db.prepare(`
      SELECT * FROM recommendations WHERE person_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(personId, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      personId: row.person_id,
      opportunityId: row.opportunity_id,
      matchId: row.match_id,
      summary: row.summary,
      reasons: JSON.parse(row.reasons),
      risks: JSON.parse(row.risks),
      unknowns: JSON.parse(row.unknowns),
      supportingClaims: JSON.parse(row.supporting_claims),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      promptVersion: row.meta_prompt_version,
      model: row.meta_model,
      _meta: {
        schemaVersion: row.meta_schema_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model
      }
    }));
  }

  getRecommendationForOpportunity(personId: string, opportunityId: string): Recommendation | undefined {
    const row = this.db.prepare(`
      SELECT * FROM recommendations WHERE person_id = ? AND opportunity_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(personId, opportunityId) as any;
    
    if (!row) return undefined;

    return {
      id: row.id,
      personId: row.person_id,
      opportunityId: row.opportunity_id,
      matchId: row.match_id,
      summary: row.summary,
      reasons: JSON.parse(row.reasons),
      risks: JSON.parse(row.risks),
      unknowns: JSON.parse(row.unknowns),
      supportingClaims: JSON.parse(row.supporting_claims),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      promptVersion: row.meta_prompt_version,
      model: row.meta_model,
      _meta: {
        schemaVersion: row.meta_schema_version,
        promptVersion: row.meta_prompt_version,
        model: row.meta_model
      }
    };
  }
}
