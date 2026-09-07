/**
 * SqliteMaterializedEvaluationStore.ts
 *
 * Phase M3: Tenant-Scoped Materialized Evaluation Read Store.
 *
 * Invariants:
 * 1. Scope Enforcement: All operations require AuthorizedPersonScope.
 * 2. SQL Boundary: Queries enforce `tenant_id = scope.tenantId AND person_id = scope.personId`.
 * 3. Idempotency: Insertion on (canonical_job_id, opportunity_version, evaluation_context_fingerprint)
 *    is strictly idempotent.
 * 4. Immutability: Historical evaluations are never overwritten by new contexts.
 * 5. Consistency: Relational columns must match evaluationJson payload.
 */

import type { DatabaseAdapter } from "@/data/database/adapter";
import type { AuthorizedPersonScope } from "../../../lib/security/auth";
import type {
  MaterializedEvaluation,
  EvaluationDecision,
} from "@/lib/domain/evaluation_context";
import {
  computeEvaluationIdentity,
  validateEvaluationConsistency,
} from "@/lib/domain/evaluation_fingerprint";

export class SqliteMaterializedEvaluationStore {
  constructor(private db: DatabaseAdapter) {}

  /**
   * Materializes an evaluation record for the authorized scope.
   * Enforces data consistency and idempotency.
   */
  async materializeEvaluation(
    scope: AuthorizedPersonScope,
    evaluation: MaterializedEvaluation
  ): Promise<void> {
    // 1. Verify that evaluation scope matches caller's AuthorizedPersonScope
    if (evaluation.tenantId !== scope.tenantId || evaluation.personId !== scope.personId) {
      throw new Error(
        `Evaluation tenant/person mismatch: expected (${scope.tenantId}, ${scope.personId}), got (${evaluation.tenantId}, ${evaluation.personId})`
      );
    }

    // 2. Validate consistency between relational columns and evaluationJson
    validateEvaluationConsistency(evaluation);

    // 3. Ensure evaluation ID equals canonical idempotencyKey
    const identity = computeEvaluationIdentity(
      evaluation.canonicalJobId,
      evaluation.opportunityVersion,
      evaluation.evaluationContextFingerprint
    );

    const evaluationId = evaluation.id || `mat_${crypto.randomUUID()}`;
    const evidenceIdsJson = JSON.stringify(evaluation.evidenceIds || []);
    const now = evaluation.materializedAt || new Date().toISOString();

    let vetoed = 0;
    if ((evaluation as any).vetoed !== undefined) {
      vetoed = (evaluation as any).vetoed ? 1 : 0;
    } else if (evaluation.evaluationJson) {
      try {
        const p = JSON.parse(evaluation.evaluationJson);
        const rec = p.record || p.engineRecommendation || p;
        vetoed = Boolean(p.vetoed ?? rec.vetoed) ? 1 : 0;
      } catch {
        vetoed = 0;
      }
    }

    // 4. Idempotently insert into materialized_evaluations
    await this.db.execute(
      `INSERT INTO materialized_evaluations (
         id, tenant_id, person_id, canonical_job_id, opportunity_version,
         evaluation_context_fingerprint, evaluation_fingerprint, evaluation_state, decision, quality_score, rationale,
         evidence_ids, evaluation_json, vetoed, materialized_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint) DO UPDATE SET
         evaluation_state = EXCLUDED.evaluation_state,
         evaluation_fingerprint = EXCLUDED.evaluation_fingerprint,
         quality_score = EXCLUDED.quality_score,
         decision = EXCLUDED.decision,
         rationale = EXCLUDED.rationale,
         evidence_ids = EXCLUDED.evidence_ids,
         evaluation_json = EXCLUDED.evaluation_json,
         vetoed = EXCLUDED.vetoed`,
      [
        evaluationId,
        scope.tenantId,
        scope.personId,
        evaluation.canonicalJobId,
        evaluation.opportunityVersion,
        evaluation.evaluationContextFingerprint,
        evaluation.evaluationFingerprint ?? null,
        evaluation.evaluationState || 'UNKNOWN',
        evaluation.decision,
        evaluation.qualityScore,
        evaluation.rationale,
        evidenceIdsJson,
        evaluation.evaluationJson,
        vetoed,
        now,
      ]
    );
  }

  /**
   * Retrieves a specific materialized evaluation by job ID and context fingerprint.
   */
  async getEvaluation(
    scope: AuthorizedPersonScope,
    canonicalJobId: string,
    contextFingerprint: string
  ): Promise<MaterializedEvaluation | undefined> {
    const row = await this.db.one<any>(
      `SELECT id, tenant_id, person_id, canonical_job_id, opportunity_version,
              evaluation_context_fingerprint, evaluation_fingerprint, evaluation_state, decision, quality_score, rationale,
              evidence_ids, evaluation_json, materialized_at
        FROM materialized_evaluations
        WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?
          AND tenant_id = ? AND person_id = ?`,
      [canonicalJobId, contextFingerprint, scope.tenantId, scope.personId]
    );

    if (!row) return undefined;

    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      canonicalJobId: row.canonical_job_id,
      opportunityVersion: row.opportunity_version,
      evaluationContextFingerprint: row.evaluation_context_fingerprint,
      evaluationFingerprint: row.evaluation_fingerprint,
      evaluationState: row.evaluation_state || 'UNKNOWN',
      decision: row.decision,
      qualityScore: row.quality_score,
      rationale: row.rationale,
      evidenceIds: JSON.parse(row.evidence_ids || "[]"),
      evaluationJson: row.evaluation_json,
      materializedAt: row.materialized_at,
    };
  }

  /**
   * Lists materialized evaluations for the authorized scope, optionally filtered by decision.
   */
  async listEvaluations(
    scope: AuthorizedPersonScope,
    filter?: {
      decision?: EvaluationDecision;
      evaluationState?: string;
      contextFingerprint?: string;
      limit?: number;
    }
  ): Promise<MaterializedEvaluation[]> {
    let sql = `
      SELECT id, tenant_id, person_id, canonical_job_id, opportunity_version,
             evaluation_context_fingerprint, evaluation_fingerprint, evaluation_state, decision, quality_score, rationale,
             evidence_ids, evaluation_json, materialized_at
      FROM materialized_evaluations
      WHERE tenant_id = ? AND person_id = ?
    `;
    const params: any[] = [scope.tenantId, scope.personId];

    if (filter?.decision) {
      sql += ` AND decision = ?`;
      params.push(filter.decision);
    }

    if (filter?.evaluationState) {
      sql += ` AND evaluation_state = ?`;
      params.push(filter.evaluationState);
    }

    if (filter?.contextFingerprint) {
      sql += ` AND evaluation_context_fingerprint = ?`;
      params.push(filter.contextFingerprint);
    }

    sql += ` ORDER BY quality_score DESC, materialized_at DESC`;

    if (filter?.limit) {
      sql += ` LIMIT ?`;
      params.push(filter.limit);
    }

    const rows = await this.db.many<any>(sql, params);

    return rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      canonicalJobId: row.canonical_job_id,
      opportunityVersion: row.opportunity_version,
      evaluationContextFingerprint: row.evaluation_context_fingerprint,
      evaluationFingerprint: row.evaluation_fingerprint,
      evaluationState: row.evaluation_state || 'UNKNOWN',
      decision: row.decision,
      qualityScore: row.quality_score,
      rationale: row.rationale,
      evidenceIds: JSON.parse(row.evidence_ids || "[]"),
      evaluationJson: row.evaluation_json,
      materializedAt: row.materialized_at,
    }));
  }

  /**
   * Counts total materialized evaluations in scope.
   */
  async countEvaluations(scope: AuthorizedPersonScope): Promise<number> {
    const row = await this.db.one<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM materialized_evaluations
       WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );

    return row?.count || 0;
  }
}
