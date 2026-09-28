import { createServerFn } from "@tanstack/react-start";
import { OpportunityService } from "./opportunity-service";
import { requireAuthUser } from "../auth/guard";
import { getDatabaseAdapter } from "@/data/database";
import { resolveServingScope } from "../security/scope-resolver";
import { EvaluationWorkScheduler } from "./EvaluationWorkScheduler";
import { supportsStagedPolicy } from "./staged/stagedPolicy";
import { SqliteStagedEvaluationStore } from "@/data/sqlite/repositories/SqliteStagedEvaluationStore";
import { SqliteDossierCompositionQueue } from "@/data/sqlite/repositories/SqliteDossierCompositionQueue";
import { SqliteDossierReviewQueue } from "@/data/sqlite/repositories/SqliteDossierReviewQueue";
import { createStagedEvaluationFingerprint, parseCanonicalStagedDecisionResult } from "@/dossier/staged-decision-integrity";

type CandidateScopeRequest = { tenantId?: string; personId?: string };
function candidateScope(data?: CandidateScopeRequest) {
  if (Boolean(data?.tenantId) !== Boolean(data?.personId)) throw new Error("CANDIDATE_SCOPE_INCOMPLETE");
  return data;
}

export const getOpportunitiesFn = createServerFn({ method: "GET" })
  .validator((d?: { categoryId?: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.listForUser(user.id, { categoryId: data?.categoryId }, scope?.tenantId, scope?.personId);
  });

export const getFeedFn = createServerFn({ method: "GET" })
  .validator(
    (d?: {
      cursor?: string;
      categoryId?: string;
      decisionFilter?: "all" | "unreviewed" | "decided";
      pageSize?: number;
    } & CandidateScopeRequest) => d
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    return OpportunityService.getFeedForUser(
      user.id,
      data?.cursor as any,
      {
        categoryId: data?.categoryId as any,
        decisionFilter: data?.decisionFilter,
      },
      data?.pageSize,
      candidateScope(data)?.tenantId,
      candidateScope(data)?.personId,
    );
  });

export const getShortlistMetricsFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.getMetricsForUser(user.id, scope?.tenantId, scope?.personId);
  });

export const getDecidedOpportunitiesFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.listDecidedForUser(user.id, scope?.tenantId, scope?.personId);
  });

export const getOpportunityFn = createServerFn({ method: "GET" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.getForUser(user.id, data.jobHash, undefined, scope?.tenantId, scope?.personId);
  });

export const getQueueMetricsFn = createServerFn({ method: "GET" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    const adj = await OpportunityService.getAdjacentInfo(user.id, data.jobHash, scope?.tenantId, scope?.personId);
    return {
      currentIndex: adj.currentIndex,
      totalCount: adj.totalCount,
    };
  });

export const getNeighboursFn = createServerFn({ method: "GET" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.neighboursForUser(user.id, data.jobHash, undefined, scope?.tenantId, scope?.personId);
  });

export const getOpportunityDetailsFn = createServerFn({ method: "GET" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = candidateScope(data);
    return OpportunityService.getDetailsForUser(user.id, data.jobHash, undefined, scope?.tenantId, scope?.personId);
  });

/**
 * Idempotent recovery action for one opportunity. Normal ingestion schedules
 * these stages automatically; this only repairs a missing or interrupted job.
 */
export const requestDetailedDossierFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const requested = candidateScope(data);
    const db = getDatabaseAdapter();
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, db, requested?.personId);
    const membership = await db.one<{ role: string }>(
      "SELECT role FROM memberships WHERE user_id=? AND tenant_id=? AND status='active' AND revoked_at IS NULL",
      [user.id, scope.tenantId],
    );
    if (membership?.role !== "admin") throw new Error("FORBIDDEN: Tenant administrator privileges required");
    const row = await db.one<{
      canonical_job_id: string; opportunity_version: string; search_plan_id: string;
      context_fingerprint: string; profile_version: string; policy_version: string;
    }>(`SELECT spc.canonical_job_id,spc.opportunity_version,spc.search_plan_id,
                aec.context_fingerprint,ec.profile_version,ec.policy_version
         FROM search_plan_candidates spc
         JOIN active_evaluation_contexts aec ON aec.tenant_id=spc.tenant_id AND aec.person_id=spc.person_id AND aec.search_plan_id=spc.search_plan_id
         JOIN evaluation_contexts ec ON ec.context_fingerprint=aec.context_fingerprint
         JOIN canonical_opportunities co ON co.id=spc.canonical_job_id
         WHERE spc.tenant_id=? AND spc.person_id=? AND (co.source_job_id=? OR co.id=?) LIMIT 1`,
      [scope.tenantId, scope.personId, data.jobHash, data.jobHash],
    );
    if (!row) throw new Error("OPPORTUNITY_NOT_IN_ACTIVE_SCOPE");
    if (!supportsStagedPolicy(row.policy_version)) {
      throw new Error("CURRENT_CONTEXT_REQUIRES_STAGED_REACTIVATION");
    }
    const identity = {
      tenantId: scope.tenantId, personId: scope.personId, searchPlanId: row.search_plan_id,
      canonicalJobId: row.canonical_job_id, opportunityVersion: row.opportunity_version,
      evaluationContextFingerprint: row.context_fingerprint,
    };
    const staged = await new SqliteStagedEvaluationStore(db).get(identity);
    if (!staged || staged.evaluationState !== "COMPLETED") {
      const work = await new EvaluationWorkScheduler(db).ensureWork(identity);
      if (work.requirementStatus === "NO_ENRICHMENT") {
        return { state: "ENRICHMENT_REQUIRED" as const, jobId: null };
      }
      return { state: "QUEUED_EVALUATION" as const, jobId: work.jobId };
    }
    if (staged.decision === "PASS") return { state: "PASS_NO_DOSSIER" as const, jobId: null };
    const evaluation = parseCanonicalStagedDecisionResult(staged.evaluation);
    const fingerprint = createStagedEvaluationFingerprint({ evaluationContextFingerprint: staged.evaluationContextFingerprint, inputFingerprint: staged.inputFingerprint, evaluation });
    const reviewQueue = new SqliteDossierReviewQueue(db);
    const review = await reviewQueue.find(identity, fingerprint);
    if (review?.status === "completed") return { state: "ALREADY_COMPLETED" as const, jobId: review.id };
    if (review?.status === "needs_attention") {
      await reviewQueue.retryAttention(identity, fingerprint);
      return { state: "QUEUED_GEMINI_REVIEW" as const, jobId: review.id };
    }
    if (review) return { state: "QUEUED_GEMINI_REVIEW" as const, jobId: review.id };

    const compositionQueue = new SqliteDossierCompositionQueue(db);
    const existingComposition = await compositionQueue.find(identity, fingerprint);
    if (existingComposition?.status === "needs_attention") {
      await compositionQueue.retryAttention(identity, fingerprint);
      return { state: "QUEUED_DOSSIER" as const, jobId: existingComposition.id };
    }
    if (existingComposition) {
      return { state: "QUEUED_DOSSIER" as const, jobId: existingComposition.id };
    }
    const jobId = await compositionQueue.enqueue(
      { ...identity, profileVersion: row.profile_version },
      fingerprint,
    );
    return { state: "QUEUED_DOSSIER" as const, jobId };
  });

/** A dedicated, auditable recovery action for the Gemini review stage. The
 * detailed-dossier action resolves the exact scoped draft and durable queue. */
export const requestFactualVerificationFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => requestDetailedDossierFn({ data }));


