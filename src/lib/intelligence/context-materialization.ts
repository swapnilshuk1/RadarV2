import { getDatabaseAdapter } from "../../data/database";
import type { DatabaseAdapter } from "../../data/database/adapter";
import type { AuthorizedPersonScope } from "../security/auth";
import type { ActivatedSearchPlan } from "../../data/sqlite/repositories/SqliteEvaluationContextStore";
import { evaluateAttentionGate } from "./AttentionGate";
import { EvaluationWorkScheduler } from "./EvaluationWorkScheduler";
import { supportsStagedPolicy } from "./staged/stagedPolicy";

export interface ContextMaterializationResult {
  examined: number;
  candidates: number;
  materialized: number;
  queued?: number;
}

/**
 * The immutable lineage that supplies records for a prepared context.
 *
 * Tenant/person scope authorizes the operation; it must never implicitly
 * select the source market population.  A plan id is the durable identity of
 * the candidate-association cohort being re-evaluated.
 */
export interface MaterializationSourceBoundary {
  sourceSearchPlanId: string;
}

/**
 * Re-evaluates one explicit canonical candidate cohort for a prepared context.
 * The source plan may be archived, but it must belong to the authorized scope.
 * A scrape/run identifier never participates in serving identity.
 */
export async function materializeExistingCanonicalPool(
  scope: AuthorizedPersonScope,
  prepared: ActivatedSearchPlan,
  source: MaterializationSourceBoundary,
  adapter?: DatabaseAdapter,
): Promise<ContextMaterializationResult> {
  if (!source.sourceSearchPlanId) {
    throw new Error("[ContextMaterialization] An explicit source search plan is required.");
  }
  if (!supportsStagedPolicy(prepared.context.policyVersion)) {
    throw new Error(`UNSUPPORTED_EVALUATION_POLICY:${prepared.context.policyVersion}`);
  }

  const db = adapter || getDatabaseAdapter();
  const sourcePlan = await db.one<{ id: string }>(
    `SELECT id FROM search_plans WHERE id = ? AND tenant_id = ? AND person_id = ?`,
    [source.sourceSearchPlanId, scope.tenantId, scope.personId],
  );
  if (!sourcePlan) {
    throw new Error(
      `[ContextMaterialization] Source search plan '${source.sourceSearchPlanId}' is not owned by the authorized scope.`,
    );
  }

  const rows = await db.many<any>(
    `SELECT DISTINCT spc.canonical_job_id, spc.opportunity_version,
            ov.id, ov.job_title, ov.company_name, ov.location, ov.employment_type,
            ov.raw_content, ov.acquisition_status, ov.acquisition_quality,
            ov.failure_class, ov.lifecycle_state, ov.evidence_state
     FROM search_plan_candidates spc
     JOIN opportunity_versions ov
       ON ov.canonical_job_id = spc.canonical_job_id AND ov.id = spc.opportunity_version
     JOIN search_plans source_plan
       ON source_plan.id = spc.search_plan_id
      AND source_plan.tenant_id = spc.tenant_id
      AND source_plan.person_id = spc.person_id
     WHERE spc.tenant_id = ? AND spc.person_id = ? AND spc.search_plan_id = ?`,
    [scope.tenantId, scope.personId, source.sourceSearchPlanId],
  );

  const candidateRows: Array<[unknown, ...unknown[]]> = [];
  const stagedWork: Array<{
    tenantId: string;
    personId: string;
    searchPlanId: string;
    canonicalJobId: string;
    opportunityVersion: string;
    evaluationContextFingerprint: string;
  }> = [];
  let eligibleCandidates = 0;

  for (const row of rows) {
    const gate = evaluateAttentionGate(
      {
        id: row.id,
        canonicalJobId: row.canonical_job_id,
        contentHash: "context-backfill",
        jobTitle: row.job_title,
        companyName: row.company_name,
        location: row.location,
        employmentType: row.employment_type,
        rawContent: row.raw_content,
        acquisitionStatus: row.acquisition_status,
        acquisitionQuality: row.acquisition_quality,
        failureClass: row.failure_class,
        lifecycleState: row.lifecycle_state,
        evidenceState: row.evidence_state,
        createdAt: new Date().toISOString(),
      },
      prepared.plan.criteria,
    );

    candidateRows.push([
      scope.tenantId,
      scope.personId,
      prepared.plan.id,
      row.canonical_job_id,
      row.opportunity_version,
      gate.decision,
      gate.eligibility,
      JSON.stringify(gate.reasonCodes),
      gate.locationPolicy ?? null,
      gate.locationEvidence ?? null,
    ]);

    if (gate.decision !== "CANDIDATE") continue;
    eligibleCandidates++;


    stagedWork.push({
      tenantId: scope.tenantId,
      personId: scope.personId,
      searchPlanId: prepared.plan.id,
      canonicalJobId: row.canonical_job_id,
      opportunityVersion: row.opportunity_version,
      evaluationContextFingerprint: prepared.context.contextFingerprint,
    });
  }

  await db.transaction(async (tx) => {
    for (let offset = 0; offset < candidateRows.length; offset += 100) {
      const chunk = candidateRows.slice(offset, offset + 100);
      const placeholders = chunk
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
        .join(",");
      await tx.execute(
        `INSERT INTO search_plan_candidates (
           tenant_id, person_id, search_plan_id, canonical_job_id,
           opportunity_version, attention_decision, eligibility,
           eligibility_reason_codes_json, location_policy, location_evidence,
           created_at
         ) VALUES ${placeholders}
         ON CONFLICT(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
         DO UPDATE SET attention_decision = excluded.attention_decision,
                       eligibility = excluded.eligibility,
                       eligibility_reason_codes_json = excluded.eligibility_reason_codes_json,
                       location_policy = excluded.location_policy,
                       location_evidence = excluded.location_evidence`,
        chunk.flat(),
      );
    }
  });

  const scheduler = new EvaluationWorkScheduler(db);
  for (const work of stagedWork) await scheduler.ensureWork(work);

  return {
    examined: rows.length,
    candidates: eligibleCandidates,
    materialized: eligibleCandidates,
    queued: stagedWork.length,
  };
}
