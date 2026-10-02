/** Isolated acceptance only: validated semantic fixtures replace live model calls. */
import type { DatabaseAdapter } from "../../src/data/database/adapter";
import { EvaluationWorkScheduler } from "../../src/evaluation/work-scheduler";
import { EvaluationWorker } from "../../src/evaluation/worker";
import { SqliteStagedEvaluationStore } from "../../src/data/sqlite/repositories/SqliteStagedEvaluationStore";
import { SqliteDossierReviewQueue } from "../../src/data/sqlite/repositories/SqliteDossierReviewQueue";
import { DossierCompositionWorker } from "../../src/dossier/runtime/composition-worker";
import { DossierReviewWorker } from "../../src/dossier/runtime/review-worker";
import { ProductionStagedDossierService } from "../../src/dossier/runtime/service";
import { createStagedEvaluationFingerprint } from "../../src/dossier/staged-decision-integrity";
import { dossier, stagedEvaluation } from "../../tests/fixtures/staged-rich-dossier";
import type { ProductionStagedIdentity } from "../../src/evaluation/contracts";

export async function seedOperationalEvaluation(
  db: DatabaseAdapter,
  identity: ProductionStagedIdentity,
  planId: string,
) {
  await db.execute(
    "UPDATE opportunity_versions SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE' WHERE id=? AND canonical_job_id=?",
    [identity.opportunityVersion, identity.canonicalJobId],
  );
  await db.execute(
    "INSERT INTO enrichment_jobs(id,job_hash,canonical_job_id,opportunity_version,pipeline_version,status) VALUES(?,?,?,?,'1.0.0','COMPLETE')",
    [
      `ops-enrich-${identity.canonicalJobId}`,
      identity.canonicalJobId,
      identity.canonicalJobId,
      identity.opportunityVersion,
    ],
  );
  await db.execute(
    "INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision,eligibility) VALUES(?,?,?,?,?,'CANDIDATE','ELIGIBLE') ON CONFLICT DO NOTHING",
    [
      identity.tenantId,
      identity.personId,
      planId,
      identity.canonicalJobId,
      identity.opportunityVersion,
    ],
  );
  await db.execute(
    "INSERT INTO evaluation_runtime_control(tenant_id,person_id,desired_state,updated_at,updated_by) VALUES(?,?,'RUNNING',?,'acceptance') ON CONFLICT(tenant_id,person_id) DO UPDATE SET desired_state='RUNNING'",
    [identity.tenantId, identity.personId, Date.now()],
  );
  const queued = await new EvaluationWorkScheduler(db).ensureWork({
    ...identity,
    searchPlanId: planId,
  });
  if (!queued.jobId) throw new Error("ACCEPTANCE_QUEUE_REQUIRED");
  return {
    pipeline: "evaluation" as const,
    jobId: queued.jobId,
    tenantId: identity.tenantId,
    personId: identity.personId,
    canonicalJobId: identity.canonicalJobId,
    opportunityVersion: identity.opportunityVersion,
    contextFingerprint: identity.evaluationContextFingerprint,
  };
}
export async function completeOperationalMemo(
  db: DatabaseAdapter,
  identity: ProductionStagedIdentity,
  expectedJobId: string,
) {
  // The persisted fixture is a successful evaluation checkpoint. Real queue,
  // lease, review-store and publication boundaries execute below.
  await new SqliteStagedEvaluationStore(db).save({
    ...identity,
    jobHash: identity.canonicalJobId,
    policyVersion: "staged-v8",
    ontologyVersion: "v1",
    ontologyFingerprint: "hash_ontology",
    inputFingerprint: "input",
    sourceFingerprints: ["jd"],
    modelId: "fixture",
    modelVersion: "fixture",
    contractVersion: "staged-decision-v8",
    evaluationState: "COMPLETED",
    decision: "PURSUE",
    screeningViability: "PLAUSIBLE",
    evaluation: stagedEvaluation,
    evaluatedAt: new Date().toISOString(),
  });
  const fingerprint = createStagedEvaluationFingerprint({
    evaluationContextFingerprint: identity.evaluationContextFingerprint,
    inputFingerprint: "input",
    evaluation: stagedEvaluation,
  });
  const reviewed = dossier();
  reviewed.opportunity.id = identity.canonicalJobId;
  reviewed.sourceEvaluationFingerprint = fingerprint;
  const draft = structuredClone(reviewed);
  delete draft.generation.factualReviewer;
  delete draft.generation.factualReviews;
  const worker = new EvaluationWorker("acceptance-evaluation", { adapter: db });
  const job = await worker.claimNextJob(identity.evaluationContextFingerprint);
  if (job?.id !== expectedJobId) throw new Error("ACCEPTANCE_EXACT_CLAIM_REQUIRED");
  if ((await worker.processJob(job)).status !== "completed")
    throw new Error("ACCEPTANCE_EVALUATION_FAILED");
  const original = ProductionStagedDossierService.prototype.compose;
  ProductionStagedDossierService.prototype.compose = async function (i, _stage, options) {
    if (i.canonicalJobId !== identity.canonicalJobId) throw new Error("ACCEPTANCE_SEMANTIC_SCOPE");
    if (options?.draftOnly) {
      await new SqliteDossierReviewQueue(db).enqueue(identity, fingerprint, draft);
      return draft;
    }
    return reviewed;
  };
  const model = () => ({ id: "fixture", version: "fixture", generate: async () => ({}) });
  try {
    const composition = await new DossierCompositionWorker(db, model).pollOnce();
    if (composition?.status !== "completed") throw new Error("ACCEPTANCE_COMPOSITION_FAILED");
    const review = await new DossierReviewWorker(db, model, model).pollOnce();
    if (review?.status !== "completed") throw new Error("ACCEPTANCE_REVIEW_FAILED");
  } finally {
    ProductionStagedDossierService.prototype.compose = original;
  }
  return { fingerprint, reviewed };
}
