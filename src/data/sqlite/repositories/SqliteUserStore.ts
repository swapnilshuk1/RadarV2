import type { Database } from "better-sqlite3";
import type { UserOutcomeStore } from "../../../domain/repositories";
import type { Decision, Outcome } from "../../../domain/entities";

export class SqliteUserOutcomeStore implements UserOutcomeStore {
  constructor(private db: Database) {}

  recordDecision(decision: Decision): void {
    const stmt = this.db.prepare(`
      INSERT INTO decisions (
        id, person_id, opportunity_id, recommendation_id, action, reason,
        created_at, updated_at, meta_schema_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        action = excluded.action,
        reason = excluded.reason,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      decision.id,
      decision.personId,
      decision.opportunityId,
      decision.recommendationId ?? null,
      decision.action,
      decision.reason ?? null,
      decision.createdAt,
      decision.updatedAt,
      decision._meta.schemaVersion
    );
  }

  recordOutcome(outcome: Outcome): void {
    const stmt = this.db.prepare(`
      INSERT INTO outcomes (
        id, person_id, opportunity_id, decision_id, result, learned_reason,
        created_at, updated_at, meta_schema_version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        result = excluded.result,
        learned_reason = excluded.learned_reason,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      outcome.id,
      outcome.personId,
      outcome.opportunityId,
      outcome.decisionId,
      outcome.result,
      outcome.learnedReason ?? null,
      outcome.createdAt,
      outcome.updatedAt,
      outcome._meta.schemaVersion
    );
  }
}
