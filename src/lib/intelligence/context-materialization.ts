import { getDatabaseAdapter } from "../../data/database";
import type { DatabaseAdapter } from "../../data/database/adapter";
import type { AuthorizedPersonScope } from "../security/auth";
import type { ActivatedSearchPlan } from "../../data/sqlite/repositories/SqliteEvaluationContextStore";
import { evaluateAttentionGate } from "./AttentionGate";
import { runEngineSingleIntrinsic } from "./engine";
import { validateEvaluationConsistency } from "../domain/evaluation_fingerprint";
import { buildCanonicalEvaluatedPayload, buildCanonicalUnavailablePayload, materializeCanonicalPayload, resolveArtifactEvaluationState } from "./evaluation/PayloadMapper";
import type { MaterializedEvaluation } from "../domain/evaluation_context";
import { resolveExactCandidateProjectionForScope } from "../../data/sqlite/repositories/profile-projection-version";
import { EvaluationWorkScheduler } from "./EvaluationWorkScheduler";
import { supportsStagedPolicy } from "./staged/stagedPolicy";

export interface ContextMaterializationResult {
  examined: number;
  candidates: number;
  materialized: number;
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
  adapter?: DatabaseAdapter
): Promise<ContextMaterializationResult> {
  if (!source.sourceSearchPlanId) {
    throw new Error("[ContextMaterialization] An explicit source search plan is required.");
  }
  const db = adapter || getDatabaseAdapter();
  const sourcePlan = await db.one<{ id: string }>(
    `SELECT id FROM search_plans WHERE id = ? AND tenant_id = ? AND person_id = ?`,
    [source.sourceSearchPlanId, scope.tenantId, scope.personId]
  );
  if (!sourcePlan) {
    throw new Error(
      `[ContextMaterialization] Source search plan '${source.sourceSearchPlanId}' is not owned by the authorized scope.`
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
    [scope.tenantId, scope.personId, source.sourceSearchPlanId]
  );
  const projection = await resolveExactCandidateProjectionForScope(
    db,
    scope,
    prepared.context.profileVersion,
  );
  const candidateRows: Array<[unknown, ...unknown[]]> = [];
  const evaluations: MaterializedEvaluation[] = [];
  const stagedScheduler = supportsStagedPolicy(prepared.context.policyVersion)
    ? new EvaluationWorkScheduler(db)
    : null;
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
    const gate = evaluateAttentionGate({
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
    }, prepared.plan.criteria);
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

    if (stagedScheduler) {
      // The requirement has a foreign-key relationship to this plan's
      // candidate association. Persist the association below before adding
      // durable staged work; otherwise profile activation fails for a valid
      // saved intent with a SQLite FK error.
      stagedWork.push({
        tenantId: scope.tenantId,
        personId: scope.personId,
        searchPlanId: prepared.plan.id,
        canonicalJobId: row.canonical_job_id,
        opportunityVersion: row.opportunity_version,
        evaluationContextFingerprint: prepared.context.contextFingerprint,
      });
      continue;
    }

    const isAcquired = row.acquisition_status === "ACQUIRED";
    const isLifecycleActive = row.lifecycle_state === "ACTIVE";
    if (!isAcquired || !isLifecycleActive) {
      const evaluationState = row.lifecycle_state === "EXPIRED" || row.lifecycle_state === "REMOVED_404"
        ? "EXPIRED"
        : row.acquisition_status === "CAPTURE_FAILED" || row.acquisition_status === "RECOVERY_FAILED"
          ? "ACQUISITION_FAILED"
          : "ACQUISITION_PENDING";
      const evaluatedAt = new Date().toISOString();
      evaluations.push(materializeCanonicalPayload(buildCanonicalUnavailablePayload(
        row.canonical_job_id, evaluationState, prepared.context, row.canonical_job_id,
        row.opportunity_version, evaluatedAt,
      )));
      // Untrusted and inactive source states deliberately have no V2 dossier.
      continue;
    }

    let source: any;
    try {
      source = JSON.parse(row.raw_content);
    } catch {
      source = {
        jobHash: row.canonical_job_id,
        role: row.job_title,
        company: row.company_name,
        location: row.location,
        rawDescription: row.raw_content,
      };
    }
    // The engine indexes the supplied corpus by its source jobHash, while the
    // persistence identity is the canonical job id. Preserve that distinction
    // so backfill evaluates scraped records whose source hash differs from the
    // canonical opportunity key.
    source.jobHash ||= row.canonical_job_id;
    source.opportunityVersion = row.opportunity_version;
    if (!projection) {
      const evaluatedAt = new Date().toISOString();
      const evaluation = materializeCanonicalPayload(buildCanonicalUnavailablePayload(
        source.jobHash,
        "NOT_EVALUABLE",
        prepared.context,
        row.canonical_job_id,
        row.opportunity_version,
        evaluatedAt,
      ));
      validateEvaluationConsistency(evaluation);
      evaluations.push(evaluation);

      continue;
    }
    const artifact = runEngineSingleIntrinsic(source.jobHash, projection, 0, [source]);
    if (!artifact) {
      throw new Error(`[ContextMaterialization] Intrinsic evaluation artifact missing for ${row.canonical_job_id}`);
    }
    const isGenuinelySparse = artifact.record?.verb === "SPARSE_SPEC"
      || (row.evidence_state === "GENUINELY_SPARSE" && isAcquired && row.acquisition_quality === "COMPLETE");
    const evaluationState = isGenuinelySparse
      ? "SPARSE_SPEC"
      : resolveArtifactEvaluationState(artifact);
    const evaluatedAt = new Date().toISOString();
    const canonicalPayload = evaluationState === "EVALUATED"
      ? buildCanonicalEvaluatedPayload(
          artifact,
          prepared.context,
          row.canonical_job_id,
          row.opportunity_version,
          evaluatedAt,
          projection,
        )
      : buildCanonicalUnavailablePayload(
          source.jobHash,
          evaluationState,
          prepared.context,
          row.canonical_job_id,
          row.opportunity_version,
          evaluatedAt,
        );
    const evaluation: MaterializedEvaluation = materializeCanonicalPayload(canonicalPayload);
    evaluation.evaluationFingerprint = evaluationState === "EVALUATED"
      ? canonicalPayload.evaluationInputHash
      : null;
    validateEvaluationConsistency(evaluation);
    evaluations.push(evaluation);

  }

  await db.transaction(async (tx) => {
    for (let offset = 0; offset < candidateRows.length; offset += 100) {
      const chunk = candidateRows.slice(offset, offset + 100);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)").join(",");
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
        chunk.flat()
      );
    }

    for (let offset = 0; offset < evaluations.length; offset += 50) {
      const chunk = evaluations.slice(offset, offset + 50);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const params = chunk.flatMap((evaluation) => [
        evaluation.id,
        evaluation.tenantId,
        evaluation.personId,
        evaluation.canonicalJobId,
        evaluation.opportunityVersion,
        evaluation.evaluationContextFingerprint,
        evaluation.evaluationFingerprint ?? null,
        evaluation.evaluationState,
        evaluation.decision,
        evaluation.qualityScore,
        evaluation.rationale,
        JSON.stringify(evaluation.evidenceIds || []),
        evaluation.evaluationJson,
        0,
        evaluation.materializedAt,
      ]);
      await tx.execute(
        `INSERT INTO materialized_evaluations (
           id, tenant_id, person_id, canonical_job_id, opportunity_version,
           evaluation_context_fingerprint, evaluation_fingerprint, evaluation_state, decision, quality_score,
           rationale, evidence_ids, evaluation_json, vetoed, materialized_at
         ) VALUES ${placeholders}
         ON CONFLICT(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
         DO UPDATE SET evaluation_state = excluded.evaluation_state,
                       evaluation_fingerprint = excluded.evaluation_fingerprint,
                       decision = excluded.decision,
                       quality_score = excluded.quality_score,
                       rationale = excluded.rationale,
                       evidence_ids = excluded.evidence_ids,
                       evaluation_json = excluded.evaluation_json,
                       vetoed = excluded.vetoed`,
        params
      );
    }

  });

  // Queue only after the candidate rows commit. New captured opportunities use
  // the same scheduler in ingestion/reconciliation, so the staged GLM →
  // dossier → Gemini sequence is now durable for both activation backfills
  // and fresh scrape arrivals.
  for (const work of stagedWork) await stagedScheduler!.ensureWork(work);

  return { examined: rows.length, candidates: eligibleCandidates, materialized: stagedScheduler ? eligibleCandidates : evaluations.length };
}
