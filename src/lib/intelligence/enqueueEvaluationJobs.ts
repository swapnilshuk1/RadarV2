/**
 * Sub-Phase M5.2 — Work Enqueuer & Idempotent Projection Sync
 *
 * Transforms eligible M4 SearchPlanCandidate projections (where attention_decision = 'CANDIDATE')
 * into durable evaluation_jobs queue entries.
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. Consumer-Only Context Rule: M5.2 strictly consumes pre-existing, immutable EvaluationContext
 *    records produced by Phase M3. M5.2 NEVER constructs, mutates, or dynamically fabricates contexts.
 * 2. Zero Recalculation Rule: M5.2 NEVER recalculates Attention Gate criteria, canonical_job_id, or opportunity_version.
 * 3. Idempotency Guarantee: Identical (tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
 *    requests are inserted using ON CONFLICT DO NOTHING, ensuring zero duplicate queue entries.
 * 4. AuthContext Isolation Boundary: Enqueuing operates strictly within authorized AuthContext tenant/person scope.
 */

import { createHash } from "crypto";
import { DatabaseAdapter, getDatabaseAdapter } from "@/data/database";
import { AuthContext, authorizePersonScope } from "@/lib/security/auth";

export interface EnqueueOptions {
  /**
   * Optional database adapter instance (for in-memory unit tests or custom transactions).
   */
  adapter?: DatabaseAdapter;
}

export interface EnqueueResult {
  searchPlanId: string;
  tenantId: string;
  personId: string;
  evaluationContextFingerprint: string;
  candidatesProcessed: number;
  enqueuedCount: number;
  skippedCount: number;
  ignoredNotCandidateCount: number;
  jobIds: string[];
}

export async function enqueueEvaluationJobsForPlan(
  authContext: AuthContext,
  personId: string,
  searchPlanId: string,
  options?: EnqueueOptions
): Promise<EnqueueResult> {
  const db = options?.adapter || getDatabaseAdapter();

  // 1. Authorize person scope against active AuthContext
  const scope = await authorizePersonScope(authContext, personId, db);
  const tenantId = scope.tenantId;

  // 2. Verify SearchPlan belongs to active AuthContext tenant & person scope
  const plan = await db.one<{ id: string; tenant_id: string; person_id: string }>(
    `SELECT id, tenant_id, person_id FROM search_plans 
     WHERE id = ? AND tenant_id = ? AND person_id = ?`,
    [searchPlanId, tenantId, personId]
  );

  if (!plan) {
    throw new Error(
      `[enqueueEvaluationJobs] Search plan '${searchPlanId}' not found or unauthorized for tenant '${tenantId}' / person '${personId}'`
    );
  }

  // 3. Fetch latest active EvaluationContext for this tenant/person/plan from M3 store
  const evalContext = await db.one<{ context_fingerprint: string }>(
    `SELECT ec.context_fingerprint 
     FROM evaluation_contexts ec
     JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
     WHERE sps.search_plan_id = ? AND sps.tenant_id = ? AND sps.person_id = ?
     ORDER BY ec.created_at DESC, ec.rowid DESC LIMIT 1`,
    [searchPlanId, tenantId, personId]
  );

  if (!evalContext) {
    throw new Error(
      `[enqueueEvaluationJobs] No pre-existing EvaluationContext found for search plan '${searchPlanId}'. M5.2 consumes existing M3 contexts only.`
    );
  }

  const fingerprint = evalContext.context_fingerprint;

  // 4. Query M4 SearchPlanCandidates for this plan
  const candidates = await db.many<{
    canonical_job_id: string;
    opportunity_version: string;
    attention_decision: string;
  }>(
    `SELECT canonical_job_id, opportunity_version, attention_decision 
     FROM search_plan_candidates 
     WHERE search_plan_id = ? AND tenant_id = ? AND person_id = ?`,
    [searchPlanId, tenantId, personId]
  );

  let enqueuedCount = 0;
  let skippedCount = 0;
  let ignoredNotCandidateCount = 0;
  const jobIds: string[] = [];

  for (const candidate of candidates) {
    if (candidate.attention_decision !== "CANDIDATE") {
      ignoredNotCandidateCount++;
      continue;
    }

    // Deterministic Job ID using fingerprint hash to ensure unique PK across context changes
    const fpHash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 12);
    const jobId = `evaljob_${tenantId}_${searchPlanId}_${candidate.canonical_job_id}_${candidate.opportunity_version}_${fpHash}`;

    const res = await db.execute(
      `INSERT INTO evaluation_jobs (
         id, tenant_id, person_id, search_plan_id,
         canonical_job_id, opportunity_version, evaluation_context_fingerprint,
         status, attempts, max_attempts, next_attempt_at
       ) VALUES (
         ?, ?, ?, ?,
         ?, ?, ?,
         'pending', 0, 3, CURRENT_TIMESTAMP
       ) ON CONFLICT(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint) DO NOTHING`,
      [
        jobId,
        tenantId,
        personId,
        searchPlanId,
        candidate.canonical_job_id,
        candidate.opportunity_version,
        fingerprint
      ]
    );

    if (res.rowsAffected > 0) {
      enqueuedCount++;
      jobIds.push(jobId);
    } else {
      skippedCount++;
    }
  }

  return {
    searchPlanId,
    tenantId,
    personId,
    evaluationContextFingerprint: fingerprint,
    candidatesProcessed: candidates.length,
    enqueuedCount,
    skippedCount,
    ignoredNotCandidateCount,
    jobIds,
  };
}
