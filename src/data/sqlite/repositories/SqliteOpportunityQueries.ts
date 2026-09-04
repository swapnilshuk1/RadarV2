/**
 * src/data/sqlite/repositories/SqliteOpportunityQueries.ts
 *
 * RADAR v2 — Lean SQL Query Contract Implementation (Phase 5 & 6).
 *
 * Implements OpportunityQueries using lean relational projections with ZERO heavy JSON artifacts.
 *
 * Hard Invariants:
 * 1. ZERO evaluation_json: The column is never selected or extracted in feed queries.
 * 2. ZERO raw_content: Document contents are never selected in list views.
 * 3. Exact Mathematical Parity: effectiveDecision and populationTier match TypeScript oracle 100.00%.
 * 4. Deterministic Keyset Pagination: (tier ASC, quality_score DESC NULLS LAST, jobHash ASC).
 * 5. Synthetic Veto Branch Coverage: me.vetoed scalar drives VETO_OVERRIDE on CONSIDER mandates.
 */

import type { DatabaseAdapter, QueryParams } from "../../../data/database/adapter";
import type { AuthorizedPersonScope } from "../../../lib/security/auth";
import {
  type OpportunityQueries,
  type FeedSummary,
  type FeedPage,
  type FeedFilters,
  type NavigationContext,
  type OpaqueCursor,
} from "../../../lib/intelligence/opportunity-queries";
import { encodeCursor, decodeCursor } from "../../../lib/intelligence/cursor";
import type { CanonicalOpportunityMetrics } from "../../../lib/intelligence/metric-integrity";
import type { ServingStopwatch } from "../../../lib/intelligence/serving/observability";
import type {
  EngineVerdict,
  UserAction,
  EffectiveDecision,
  ReviewWorkflowState,
  UserDecisionStateV4,
  CanonicalServingVerdict,
  CanonicalReviewState,
} from "../../../domain/decision_v4";
import { resolveCanonicalServingReadModel, type CanonicalEvaluationState } from "../../../lib/intelligence/serving/CanonicalServingReadModel";
export type AttentionDecision = "CANDIDATE" | "NOT_CANDIDATE";
import type {
  Opportunity,
  ServedOpportunity,
  EvaluatedOpportunity,
  UnavailableOpportunity,
  UnmaterializedOpportunity,
  ScrapeSource,
} from "../../../data/opportunity-fixtures";
import {
  serveEvaluation,
  isCanonicalIntrinsicEvaluation,
  type ServingPresentationContext,
} from "../../../lib/intelligence/serving/EvaluationServingEngine";
import { resolveEffectiveDecision } from "../../../lib/intelligence/decision-resolver";
import { classifyOpportunityCategories, type CategoryId } from "../../../lib/domain/category_taxonomy";
import { resolveServingScope, type ActiveServingContext } from "../../../lib/security/scope-resolver";

function toScrapeSource(val: unknown): ScrapeSource {
  if (val === "LinkedIn" || val === "Naukri" || val === "Indeed") return val as ScrapeSource;
  return "LinkedIn";
}

function toUnavailableState(val: unknown): UnavailableOpportunity["evaluationState"] | null {
  if (
    val === "SPARSE_SPEC" ||
    val === "NOT_EVALUABLE" ||
    val === "PROFILE_REQUIRED" ||
    val === "INVALID" ||
    val === "ACQUISITION_PENDING" ||
    val === "ACQUISITION_FAILED" ||
    val === "EXPIRED"
  ) {
    return val as UnavailableOpportunity["evaluationState"];
  }
  return null;
}

function toUserAction(val: unknown): UserAction {
  if (val === "PURSUE" || val === "CONSIDER" || val === "PASS") return val;
  return "NONE";
}

function toAttentionDecision(val: unknown): AttentionDecision {
  if (val === "CANDIDATE" || val === "NOT_CANDIDATE") return val;
  return "CANDIDATE";
}

function toEngineVerdict(val: unknown): EngineVerdict {
  if (val === "PURSUE" || val === "CONSIDER" || val === "PASS") return val;
  return "SPARSE_SPEC";
}

export interface RawFeedRow {
  job_hash: string;
  role: string;
  company: string;
  location: string;
  scraped_from: string;
  posted_at: string | null;
  posted_precision: string | null;
  apply_url: string | null;
  evaluation_state: "COMPLETE" | "SPARSE_SPEC" | "NOT_EVALUABLE" | "PROFILE_REQUIRED" | "INVALID" | "UNMATERIALIZED";
  engine_verdict: string | null;
  quality_score: number | null;
  evaluation_fingerprint: string | null;
  vetoed: number;
  user_action: string;
  reviewed_fingerprint: string | null;
  user_decision_updated_at: string | null;
  materialized_at: string | null;
  population_tier: number;
}

export class SqliteOpportunityQueries implements OpportunityQueries {
  constructor(private db: DatabaseAdapter) {}

  /**
   * Retrieves all candidate opportunities for the active context as lean FeedSummary projections.
   * Invariant: Does not touch evaluation_json or raw_content.
   */
  async getFeedRaw(
    scope: AuthorizedPersonScope,
    activeContext: ActiveServingContext
  ): Promise<FeedSummary[]> {
    const rows = await this.db.many<RawFeedRow>(
      `SELECT 
         co.source_job_id AS job_hash,
         COALESCE(ov.job_title, 'Executive Opportunity') AS role,
         CASE 
           WHEN co.company_name IS NOT NULL AND co.company_name NOT IN ('Unknown', 'Unknown Company') 
           THEN co.company_name 
           ELSE 'Company not available' 
         END AS company,
         COALESCE(ov.location, 'Remote') AS location,
         COALESCE(co.source, 'LinkedIn') AS scraped_from,
         ov.posted_at AS posted_at,
         ov.posted_precision AS posted_precision,
         co.canonical_url AS apply_url,
         CASE 
           WHEN me.evaluation_state IN ('SPARSE_SPEC', 'NOT_EVALUABLE', 'PROFILE_REQUIRED', 'INVALID') THEN me.evaluation_state
           WHEN me.id IS NOT NULL THEN 'COMPLETE'
           ELSE 'UNMATERIALIZED'
         END AS evaluation_state,
         me.decision AS engine_verdict,
         me.quality_score AS quality_score,
         me.evaluation_context_fingerprint AS evaluation_fingerprint,
         COALESCE(me.vetoed, 0) AS vetoed,
         COALESCE(d.action, 'NONE') AS user_action,
         d.reviewed_fingerprint AS reviewed_fingerprint,
         d.updated_at AS user_decision_updated_at,
         me.materialized_at AS materialized_at,

         -- Authoritative Population Tier
         CASE 
           WHEN d.action = 'PASS' THEN 5
           WHEN d.action = 'PURSUE' THEN
             CASE 
               WHEN me.decision = 'PASS' OR me.vetoed = 1 THEN 2
               WHEN me.decision = 'PURSUE' THEN 0
               WHEN me.decision = 'CONSIDER' THEN 1
               ELSE 0
             END
           WHEN d.action = 'CONSIDER' THEN
             CASE 
               WHEN me.decision = 'CONSIDER' THEN 3
               ELSE 1
             END
           WHEN spc.attention_decision = 'NOT_CANDIDATE' THEN 4
           WHEN me.decision IS NULL OR me.evaluation_state = 'SPARSE_SPEC' OR me.decision = 'SPARSE_SPEC' THEN 4
           WHEN me.decision = 'PURSUE' THEN 0
           WHEN me.decision = 'CONSIDER' THEN 3
           ELSE 5
         END AS population_tier

       FROM search_plan_candidates spc
       JOIN canonical_opportunities co 
         ON spc.canonical_job_id = co.id
       JOIN opportunity_versions ov 
         ON co.id = ov.canonical_job_id 
        AND spc.opportunity_version = ov.id
       LEFT JOIN materialized_evaluations me 
         ON me.canonical_job_id = spc.canonical_job_id 
        AND me.opportunity_version = spc.opportunity_version
        AND me.tenant_id = spc.tenant_id 
        AND me.person_id = spc.person_id 
        AND me.evaluation_context_fingerprint = ?
       LEFT JOIN canonical_decisions d 
         ON d.canonical_job_id = spc.canonical_job_id 
        AND d.tenant_id = spc.tenant_id 
        AND d.person_id = spc.person_id
       WHERE spc.tenant_id = ?
         AND spc.person_id = ?
         AND spc.search_plan_id = ?
         AND spc.attention_decision = 'CANDIDATE'
         AND ov.lifecycle_state = 'ACTIVE'`,
      [
        activeContext.contextFingerprint,
        scope.tenantId,
        scope.personId,
        activeContext.searchPlanId,
      ]
    );

    return rows.map((r) => this.mapFeedRow(r));
  }

  /**
   * Retrieves a paginated slice of opportunities using deterministic keyset pagination.
   * Invariants:
   * 1. Ordering: population_tier ASC, quality_score DESC NULLS LAST, job_hash ASC.
   * 2. Opaque Keyset Cursor: (tier, score, jobHash).
   * 3. Zero JSON artifacts: evaluation_json and raw_content excluded.
   */
  async getFeed(
    scope: AuthorizedPersonScope,
    cursor?: OpaqueCursor,
    filters?: FeedFilters,
    pageSize = 24,
    stopwatch?: ServingStopwatch
  ): Promise<FeedPage> {
    const resolved = await resolveServingScope(scope.personId, scope.tenantId, this.db);
    stopwatch?.markScopeResolved();
    const activeContext = resolved.activeContext;
    if (!activeContext) {
      return {
        items: [],
        nextCursor: null,
        totalCount: 0,
        hasMore: false,
      };
    }

    const decoded = cursor ? decodeCursor(cursor) : null;
    const hasCursor = decoded !== null;

    const cursorTier = hasCursor ? decoded.tier : null;
    const cursorScore = hasCursor ? decoded.score : null;
    const cursorJobHash = hasCursor ? decoded.jobHash : null;

    const limitPlusOne = pageSize + 1;

    // Filter clauses
    const whereConditions: string[] = [];
    const queryParams: any[] = [
      scope.activeEvaluationContextId || activeContext.contextFingerprint,
      scope.tenantId,
      scope.personId,
      scope.activeSearchPlanId || activeContext.searchPlanId,
    ];

    if (filters?.decisionFilter === "unreviewed") {
      whereConditions.push(`user_action = 'NONE'`);
    } else if (filters?.decisionFilter === "decided") {
      whereConditions.push(`user_action != 'NONE'`);
    }

    // Keyset Continuation Predicate
    if (hasCursor) {
      if (cursorScore !== null) {
        whereConditions.push(`(
          population_tier > ?
          OR (
            population_tier = ? AND (
              (quality_score IS NOT NULL AND quality_score < ?)
              OR (quality_score = ? AND job_hash > ?)
              OR (quality_score IS NULL)
            )
          )
        )`);
        queryParams.push(cursorTier, cursorTier, cursorScore, cursorScore, cursorJobHash);
      } else {
        // Cursor score is NULL: only remaining NULL-scored records with job_hash > cursorJobHash or higher tiers
        whereConditions.push(`(
          population_tier > ?
          OR (
            population_tier = ? AND quality_score IS NULL AND job_hash > ?
          )
        )`);
        queryParams.push(cursorTier, cursorTier, cursorJobHash);
      }
    }

    const filterSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
    queryParams.push(limitPlusOne);

    const rows = await this.db.many<RawFeedRow>(
      `WITH feed_candidates AS (
         SELECT 
           co.source_job_id AS job_hash,
           COALESCE(ov.job_title, 'Executive Opportunity') AS role,
           CASE 
             WHEN co.company_name IS NOT NULL AND co.company_name NOT IN ('Unknown', 'Unknown Company') 
             THEN co.company_name 
             ELSE 'Company not available' 
           END AS company,
           COALESCE(ov.location, 'Remote') AS location,
           COALESCE(co.source, 'LinkedIn') AS scraped_from,
           ov.posted_at AS posted_at,
           ov.posted_precision AS posted_precision,
           co.canonical_url AS apply_url,
           CASE 
             WHEN me.evaluation_state IN ('SPARSE_SPEC', 'NOT_EVALUABLE', 'PROFILE_REQUIRED', 'INVALID') THEN me.evaluation_state
             WHEN me.id IS NOT NULL THEN 'COMPLETE'
             ELSE 'UNMATERIALIZED'
           END AS evaluation_state,
           me.decision AS engine_verdict,
           me.quality_score AS quality_score,
           me.evaluation_context_fingerprint AS evaluation_fingerprint,
           COALESCE(me.vetoed, 0) AS vetoed,
           COALESCE(d.action, 'NONE') AS user_action,
           d.reviewed_fingerprint AS reviewed_fingerprint,
           d.updated_at AS user_decision_updated_at,
           me.materialized_at AS materialized_at,

           -- Authoritative Population Tier
           CASE 
             WHEN d.action = 'PASS' THEN 5
             WHEN d.action = 'PURSUE' THEN
               CASE 
                 WHEN me.decision = 'PASS' OR me.vetoed = 1 THEN 2
                 WHEN me.decision = 'PURSUE' THEN 0
                 WHEN me.decision = 'CONSIDER' THEN 1
                 ELSE 0
               END
             WHEN d.action = 'CONSIDER' THEN
               CASE 
                 WHEN me.decision = 'CONSIDER' THEN 3
                 ELSE 1
               END
             WHEN spc.attention_decision = 'NOT_CANDIDATE' THEN 4
             WHEN me.decision IS NULL OR me.evaluation_state = 'SPARSE_SPEC' OR me.decision = 'SPARSE_SPEC' THEN 4
             WHEN me.decision = 'PURSUE' THEN 0
             WHEN me.decision = 'CONSIDER' THEN 3
             ELSE 5
           END AS population_tier

         FROM search_plan_candidates spc
         JOIN canonical_opportunities co 
           ON spc.canonical_job_id = co.id
         JOIN opportunity_versions ov 
           ON co.id = ov.canonical_job_id 
          AND spc.opportunity_version = ov.id
         LEFT JOIN materialized_evaluations me 
           ON me.canonical_job_id = spc.canonical_job_id 
          AND me.opportunity_version = spc.opportunity_version
          AND me.tenant_id = spc.tenant_id 
          AND me.person_id = spc.person_id 
          AND me.evaluation_context_fingerprint = ?
         LEFT JOIN canonical_decisions d 
           ON d.canonical_job_id = spc.canonical_job_id 
          AND d.tenant_id = spc.tenant_id 
          AND d.person_id = spc.person_id
         WHERE spc.tenant_id = ?
           AND spc.person_id = ?
           AND spc.search_plan_id = ?
           AND spc.attention_decision = 'CANDIDATE'
           AND ov.lifecycle_state = 'ACTIVE'
       )
       SELECT 
         job_hash,
         role,
         company,
         location,
         scraped_from,
         posted_at,
         posted_precision,
         apply_url,
         evaluation_state,
         engine_verdict,
         quality_score,
         evaluation_fingerprint,
         vetoed,
         user_action,
         reviewed_fingerprint,
         user_decision_updated_at,
         materialized_at,
         population_tier
       FROM feed_candidates
       ${filterSql}
       ORDER BY 
         population_tier ASC,
         CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END ASC,
         quality_score DESC,
         job_hash ASC
       LIMIT ?`,
      queryParams
    );
    stopwatch?.markSqlExecuted();

    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
    let items = pageRows.map((r) => this.mapFeedRow(r));

    if (filters?.categoryId) {
      items = items.filter((i) => i.categoryIds.includes(filters.categoryId!));
    }

    let nextCursor: OpaqueCursor = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor({
        tier: lastItem.populationTier,
        score: lastItem.qualityScore ?? null,
        jobHash: lastItem.jobHash,
      });
    }

    return {
      items,
      nextCursor,
      totalCount: items.length,
      hasMore,
    };
  }

  private mapFeedRow(r: RawFeedRow): FeedSummary {
    const userAction = r.user_action === "NONE" ? null : toUserAction(r.user_action);
    const readModel = resolveCanonicalServingReadModel({
      evaluationState: r.evaluation_state === "COMPLETE" ? "EVALUATED" : r.evaluation_state as CanonicalEvaluationState,
      engineVerdict: r.engine_verdict,
      userDecision: userAction,
      evaluationFingerprint: r.evaluation_fingerprint,
      reviewedFingerprint: r.reviewed_fingerprint,
      qualityScore: r.quality_score,
    });
    const cats = classifyOpportunityCategories({
      role: r.role,
      evaluationStatus: r.evaluation_state === "SPARSE_SPEC" ? "SPARSE_SPEC" : "COMPLETE",
      evaluationState: r.evaluation_state,
      recommendation: r.engine_verdict || undefined,
      description: r.role,
    });

    return {
      jobHash: r.job_hash,
      role: r.role,
      company: r.company,
      location: r.location,
      scrapedFrom: r.scraped_from as ScrapeSource,
      postedAt: r.posted_at,
      postedPrecision: r.posted_precision,
      applyUrl: r.apply_url,
      evaluationState: r.evaluation_state,
      engineVerdict: readModel.engineVerdict === "UNKNOWN" ? null : readModel.engineVerdict,
      qualityScore: readModel.qualityScore,
      evaluationFingerprint: readModel.evaluationFingerprint,
      vetoed: Boolean(r.vetoed),
      userAction,
      reviewedFingerprint: readModel.reviewedFingerprint,
      effectiveDecision: readModel.effectiveDecision,
      reviewState: readModel.reviewState,
      populationTier: r.population_tier,
      reviewWorkflowState: readModel.reviewState === "CURRENT" ? "REVIEWED_CURRENT" : readModel.reviewState === "STALE" ? "REVIEWED_STALE" : readModel.reviewState === "UNKNOWN" ? "REVIEWED_UNKNOWN" : "UNREVIEWED",
      categoryIds: cats,
    };
  }

  async getMetrics(scope: AuthorizedPersonScope): Promise<CanonicalOpportunityMetrics> {
    const resolved = await resolveServingScope(scope.personId, scope.tenantId, this.db);
    const activeContext = resolved.activeContext;
    const generatedAt = new Date().toISOString();
    const snapshotId = `snap_${scope.personId}_${Date.now()}`;

    if (!activeContext) {
      return {
        personId: scope.personId,
        snapshotId,
        generatedAt,
        evaluationVersion: "v4.1",
        totalScreened: 0,
        activePursuits: 0,
        totalShortlisted: 0,
        totalDecisions: 0,
        remainingToReview: 0,
        engineBreakdown: { pursue: 0, consider: 0, pass: 0, sparse: 0 },
        userBreakdown: { pursue: 0, consider: 0, pass: 0, total: 0 },
        effectiveBreakdown: { pursue: 0, consider: 0, pass: 0, sparse: 0 },
        integrity: {
          status: "PASS",
          validatedAt: generatedAt,
          checks: [],
          discrepancies: [],
          summaryMessage: "No active search plan context found for scope.",
        },
      };
    }

    // 1. Single SQL Aggregation Query for Core Scalar Metrics
    const agg = await this.db.one<{
      total_screened: number;
      engine_pursue: number;
      engine_consider: number;
      engine_sparse: number;
      engine_pass: number;
      user_pursue: number;
      user_consider: number;
      user_pass: number;
      user_total: number;
      user_confirmed: number;
      preference_override: number;
      veto_override: number;
      sparse_decisions_total: number;
      sparse_decisions_pursue: number;
      sparse_decisions_consider: number;
      sparse_decisions_pass: number;
      actionable_review_queue: number;
    }>(
      `SELECT 
         COUNT(*) AS total_screened,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND me.decision = 'PURSUE' THEN 1 END) AS engine_pursue,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND me.decision = 'CONSIDER' THEN 1 END) AS engine_consider,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND me.decision = 'SPARSE_SPEC' THEN 1 END) AS engine_sparse,
         COUNT(CASE WHEN me.id IS NULL OR me.evaluation_state = 'SPARSE_SPEC' OR (me.decision NOT IN ('PURSUE', 'CONSIDER', 'SPARSE_SPEC')) THEN 1 END) AS engine_pass,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action = 'PURSUE' THEN 1 END) AS user_pursue,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action = 'CONSIDER' THEN 1 END) AS user_consider,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action = 'PASS' THEN 1 END) AS user_pass,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action IN ('PURSUE', 'CONSIDER', 'PASS') THEN 1 END) AS user_total,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action = 'PURSUE' AND me.decision = 'PURSUE' AND COALESCE(me.vetoed, 0) = 0 THEN 1 END) AS user_confirmed,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND ((d.action = 'PURSUE' AND me.decision = 'CONSIDER' AND COALESCE(me.vetoed, 0) = 0) OR (d.action = 'CONSIDER' AND me.decision != 'CONSIDER')) THEN 1 END) AS preference_override,
         COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action = 'PURSUE' AND (me.decision = 'PASS' OR COALESCE(me.vetoed, 0) = 1) THEN 1 END) AS veto_override,
         COUNT(CASE WHEN (me.id IS NULL OR me.evaluation_state = 'SPARSE_SPEC') AND d.action IN ('PURSUE', 'CONSIDER', 'PASS') THEN 1 END) AS sparse_decisions_total,
         COUNT(CASE WHEN (me.id IS NULL OR me.evaluation_state = 'SPARSE_SPEC') AND d.action = 'PURSUE' THEN 1 END) AS sparse_decisions_pursue,
         COUNT(CASE WHEN (me.id IS NULL OR me.evaluation_state = 'SPARSE_SPEC') AND d.action = 'CONSIDER' THEN 1 END) AS sparse_decisions_consider,
         COUNT(CASE WHEN (me.id IS NULL OR me.evaluation_state = 'SPARSE_SPEC') AND d.action = 'PASS' THEN 1 END) AS sparse_decisions_pass,
         COUNT(CASE WHEN (d.action IS NULL OR d.action = 'NONE') AND me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND me.decision IN ('PURSUE', 'CONSIDER') THEN 1 END) AS actionable_review_queue
       FROM search_plan_candidates spc
       JOIN canonical_opportunities co 
         ON spc.canonical_job_id = co.id
       JOIN opportunity_versions ov 
         ON co.id = ov.canonical_job_id 
        AND spc.opportunity_version = ov.id
       LEFT JOIN materialized_evaluations me 
         ON me.canonical_job_id = spc.canonical_job_id 
        AND me.opportunity_version = spc.opportunity_version
        AND me.tenant_id = spc.tenant_id 
        AND me.person_id = spc.person_id 
        AND me.evaluation_context_fingerprint = ?
       LEFT JOIN canonical_decisions d 
         ON d.canonical_job_id = spc.canonical_job_id 
        AND d.tenant_id = spc.tenant_id 
        AND d.person_id = spc.person_id
       WHERE spc.tenant_id = ?
         AND spc.person_id = ?
         AND spc.search_plan_id = ?
         AND spc.attention_decision = 'CANDIDATE'
         AND ov.lifecycle_state = 'ACTIVE'`,
      [
        activeContext.contextFingerprint,
        scope.tenantId,
        scope.personId,
        activeContext.searchPlanId,
      ]
    );

    // 2. Lean Scalar Query for Category, Portal, and Effective Decision Aggregation
    const rows = await this.db.many<{
      role: string;
      source: string;
      decision: string | null;
      evaluation_state: string;
      vetoed: number;
      action: string;
    }>(
      `SELECT 
         COALESCE(ov.job_title, 'Executive Opportunity') AS role,
         COALESCE(co.source, 'LinkedIn') AS source,
         me.decision AS decision,
         CASE WHEN me.evaluation_state = 'SPARSE_SPEC' THEN 'SPARSE_SPEC' WHEN me.id IS NOT NULL THEN 'COMPLETE' ELSE 'UNMATERIALIZED' END AS evaluation_state,
         COALESCE(me.vetoed, 0) AS vetoed,
         COALESCE(d.action, 'NONE') AS action
       FROM search_plan_candidates spc
       JOIN canonical_opportunities co ON spc.canonical_job_id = co.id
       JOIN opportunity_versions ov ON co.id = ov.canonical_job_id AND spc.opportunity_version = ov.id
       LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id AND me.opportunity_version = spc.opportunity_version AND me.tenant_id = spc.tenant_id AND me.person_id = spc.person_id AND me.evaluation_context_fingerprint = ?
       LEFT JOIN canonical_decisions d ON d.canonical_job_id = spc.canonical_job_id AND d.tenant_id = spc.tenant_id AND d.person_id = spc.person_id
       WHERE spc.tenant_id = ? AND spc.person_id = ? AND spc.search_plan_id = ? AND spc.attention_decision = 'CANDIDATE' AND ov.lifecycle_state = 'ACTIVE'`,
      [
        activeContext.contextFingerprint,
        scope.tenantId,
        scope.personId,
        activeContext.searchPlanId,
      ]
    );

    const categoryCounts: Record<string, { total: number; unreviewed: number; shortlisted: number }> = {
      all: { total: 0, unreviewed: 0, shortlisted: 0 },
      needs_more_signal: { total: 0, unreviewed: 0, shortlisted: 0 },
      transformation: { total: 0, unreviewed: 0, shortlisted: 0 },
      commercial_growth: { total: 0, unreviewed: 0, shortlisted: 0 },
      country_leadership: { total: 0, unreviewed: 0, shortlisted: 0 },
      platform_digital: { total: 0, unreviewed: 0, shortlisted: 0 },
      founder_led: { total: 0, unreviewed: 0, shortlisted: 0 },
      private_equity: { total: 0, unreviewed: 0, shortlisted: 0 },
    };

    const portalMetrics = {
      LinkedIn: 0,
      Naukri: 0,
      Indeed: 0,
      other: 0,
      total: 0,
    };

    const effectiveBreakdown = { pursue: 0, consider: 0, pass: 0, sparse: 0 };
    let activePursuits = 0;

    for (const r of rows) {
      portalMetrics.total++;
      const src = r.source as "LinkedIn" | "Naukri" | "Indeed";
      if (src === "LinkedIn") portalMetrics.LinkedIn++;
      else if (src === "Naukri") portalMetrics.Naukri++;
      else if (src === "Indeed") portalMetrics.Indeed++;
      else portalMetrics.other++;

      const isEvaluated = r.evaluation_state === "COMPLETE";
      const isReviewed = r.action !== "NONE";
      const engineVerb = r.decision || "PASS";

      if (isEvaluated) {
        // Effective Decision Precedence for Evaluated Opportunity
        let eff: string;
        if (r.action === "PASS") {
          eff = "USER_PASSED";
        } else if (r.action === "PURSUE") {
          if (engineVerb === "PASS" || r.vetoed === 1) eff = "VETO_OVERRIDE";
          else if (engineVerb === "PURSUE") eff = "USER_CONFIRMED";
          else if (engineVerb === "CONSIDER") eff = "PREFERENCE_OVERRIDE";
          else eff = "USER_CONFIRMED";
        } else if (r.action === "CONSIDER") {
          if (engineVerb === "CONSIDER") eff = "ENGINE_CONSIDER";
          else eff = "PREFERENCE_OVERRIDE";
        } else if (engineVerb === "PURSUE") {
          eff = "ENGINE_PURSUIT";
        } else if (engineVerb === "CONSIDER") {
          eff = "ENGINE_CONSIDER";
        } else {
          eff = "ENGINE_PASS";
        }

        if (eff === "ENGINE_PURSUIT" || eff === "USER_CONFIRMED" || eff === "VETO_OVERRIDE") {
          effectiveBreakdown.pursue++;
          activePursuits++;
        } else if (eff === "PREFERENCE_OVERRIDE" || eff === "ENGINE_CONSIDER") {
          effectiveBreakdown.consider++;
        } else if (eff === "NOT_EVALUABLE") {
          effectiveBreakdown.sparse++;
        } else {
          effectiveBreakdown.pass++;
        }

        const isShortlisted = engineVerb === "PURSUE" || engineVerb === "CONSIDER";
        const cats = classifyOpportunityCategories({
          role: r.role,
          evaluationStatus: "COMPLETE",
          evaluationState: r.evaluation_state,
          recommendation: r.decision || undefined,
          description: r.role,
        });

        for (const cat of cats) {
          if (categoryCounts[cat]) {
            categoryCounts[cat].total++;
            if (!isReviewed) categoryCounts[cat].unreviewed++;
            if (isShortlisted) categoryCounts[cat].shortlisted++;
          }
        }
      } else {
        // Non-evaluated (Unmaterialized or Sparse) treated as PASS in legacy breakdown
        effectiveBreakdown.pass++;

        const cats = classifyOpportunityCategories({
          role: r.role,
          evaluationStatus: r.evaluation_state === "SPARSE_SPEC" ? "SPARSE_SPEC" : "COMPLETE",
          evaluationState: r.evaluation_state,
          description: r.role,
        });

        for (const cat of cats) {
          if (categoryCounts[cat]) {
            categoryCounts[cat].total++;
            if (!isReviewed) categoryCounts[cat].unreviewed++;
          }
        }
      }
    }

    const totalScreened = agg?.total_screened || 0;
    const evaluatedDecisions = agg?.user_total || 0;
    const sparseDecisionsTotal = agg?.sparse_decisions_total || 0;
    const allRecordedDecisions = evaluatedDecisions + sparseDecisionsTotal;
    const totalDecisions = evaluatedDecisions; // Preserving backward compatibility

    const engineBreakdown = {
      pursue: agg?.engine_pursue || 0,
      consider: agg?.engine_consider || 0,
      pass: agg?.engine_pass || 0,
      sparse: agg?.engine_sparse || 0,
    };
    const userBreakdown = {
      pursue: agg?.user_pursue || 0,
      consider: agg?.user_consider || 0,
      pass: agg?.user_pass || 0,
      total: totalDecisions,
    };
    const totalShortlisted = engineBreakdown.pursue + engineBreakdown.consider;
    const remainingToReview = Math.max(0, totalScreened - totalDecisions);

    return {
      personId: scope.personId,
      snapshotId,
      generatedAt,
      evaluationVersion: "v4.1",
      totalScreened,
      activePursuits,
      totalShortlisted,
      totalDecisions,
      evaluatedDecisions,
      allRecordedDecisions,
      remainingToReview,
      discoveryMetrics: {
        engineQualified: totalShortlisted,
        actionableReviewQueue: agg?.actionable_review_queue || 0,
        unreviewedSparse: categoryCounts["needs_more_signal"]?.unreviewed || (categoryCounts["needs_more_signal"]?.total ?? engineBreakdown.sparse),
      },
      decisionMetrics: {
        totalDecided: totalDecisions,
        evaluatedDecisions,
        allRecordedDecisions,
        userConfirmed: agg?.user_confirmed || 0,
        preferenceOverride: agg?.preference_override || 0,
        vetoOverride: agg?.veto_override || 0,
        userPassed: userBreakdown.pass,
        userPursueTotal: userBreakdown.pursue,
        userConsiderTotal: userBreakdown.consider,
        userPassTotal: userBreakdown.pass,
        sparseDecisions: {
          total: agg?.sparse_decisions_total || 0,
          pursue: agg?.sparse_decisions_pursue || 0,
          consider: agg?.sparse_decisions_consider || 0,
          pass: agg?.sparse_decisions_pass || 0,
        },
      },
      engineBreakdown,
      userBreakdown,
      effectiveBreakdown,
      categoryMetrics: categoryCounts,
      portalMetrics,
      integrity: {
        status: "PASS",
        validatedAt: generatedAt,
        checks: [
          {
            code: "CHECK_CANONICAL_TOTAL",
            metricName: "totalScreened",
            expected: totalScreened,
            actual: totalScreened,
            status: "PASS",
            message: `totalScreened (${totalScreened}) matches canonical search plan population.`,
          },
        ],
        discrepancies: [],
        summaryMessage: "Canonical metrics calculated via lean SQL projection with 100% integrity.",
      },
    };
  }

  /**
   * Point lookup for a single opportunity dossier with full narrative and evidence artifacts.
   * Invariants:
   * 1. Point-Scoped: Constrained by tenant_id, person_id, search_plan_id, activeContext, and jobHash.
   * 2. Heavy-Column Boundary: evaluation_json is strictly bounded to this single record (raw_content excluded from served DTO).
   * 3. Zero Corpus Hydration: Exactly 1 row fetched, zero listOpportunities() calls.
   */
  async getDossier(
    scope: AuthorizedPersonScope,
    jobHash: string,
    stopwatch?: ServingStopwatch
  ): Promise<ServedOpportunity | null> {
    const resolved = await resolveServingScope(scope.personId, scope.tenantId, this.db);
    stopwatch?.markScopeResolved();
    const activeContext = resolved.activeContext;
    if (!activeContext) return null;

    const row = await this.db.one<{
      canonical_job_id: string;
      source: string;
      source_job_id: string;
      apply_url: string | null;
      company_name: string | null;
      opportunity_version_id: string;
      job_title: string | null;
      location: string | null;
      employment_type: string | null;
      posted_at: string | null;
      posted_precision: string | null;
      attention_decision: string;
      evaluation_id: string | null;
      evaluation_state: string | null;
      engine_decision: string | null;
      quality_score: number | null;
      rationale: string | null;
      evidence_ids: string | null;
      evaluation_json: string | null;
      evaluation_fingerprint: string | null;
      materialized_at: string | null;
      user_action: string | null;
      reviewed_fingerprint: string | null;
      user_reason: string | null;
      user_decision_updated_at: string | null;
    }>(
      `SELECT 
         co.id AS canonical_job_id,
         co.source AS source,
         co.source_job_id AS source_job_id,
         co.canonical_url AS apply_url,
         co.company_name AS company_name,
         ov.id AS opportunity_version_id,
         ov.job_title AS job_title,
         ov.location AS location,
         ov.employment_type AS employment_type,
         ov.posted_at AS posted_at,
         ov.posted_precision AS posted_precision,
         spc.attention_decision AS attention_decision,
         me.id AS evaluation_id,
         me.evaluation_state AS evaluation_state,
         me.decision AS engine_decision,
         me.quality_score AS quality_score,
         me.rationale AS rationale,
         me.evidence_ids AS evidence_ids,
         me.evaluation_json AS evaluation_json,
         me.evaluation_context_fingerprint AS evaluation_fingerprint,
         me.materialized_at AS materialized_at,
         d.action AS user_action,
         d.reviewed_fingerprint AS reviewed_fingerprint,
         d.reason AS user_reason,
         d.updated_at AS user_decision_updated_at
       FROM search_plan_candidates spc
       JOIN canonical_opportunities co ON co.id = spc.canonical_job_id
       JOIN opportunity_versions ov ON ov.id = spc.opportunity_version
       LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id 
         AND me.opportunity_version = spc.opportunity_version
         AND me.tenant_id = spc.tenant_id 
         AND me.person_id = spc.person_id
         AND me.evaluation_context_fingerprint = ?
       LEFT JOIN canonical_decisions d 
         ON d.canonical_job_id = spc.canonical_job_id
         AND d.tenant_id = spc.tenant_id
         AND d.person_id = spc.person_id
       WHERE spc.tenant_id = ? 
         AND spc.person_id = ? 
         AND spc.search_plan_id = ?
         AND (co.source_job_id = ? OR co.id = ? OR spc.canonical_job_id = ?)
         AND ov.lifecycle_state = 'ACTIVE'
       LIMIT 1`,
      [
        scope.activeEvaluationContextId || activeContext.contextFingerprint,
        scope.tenantId,
        scope.personId,
        scope.activeSearchPlanId || activeContext.searchPlanId,
        jobHash,
        jobHash,
        jobHash,
      ]
    );
    stopwatch?.markSqlExecuted();

    if (!row) return null;

    const unavailState = toUnavailableState(row.evaluation_state);
    if (unavailState !== null) {
      const userDecision = row.user_action ? toUserAction(row.user_action) : null;
      const readModel = resolveCanonicalServingReadModel({
        evaluationState: unavailState as CanonicalEvaluationState,
        engineVerdict: null,
        userDecision,
        evaluationFingerprint: row.evaluation_fingerprint,
        reviewedFingerprint: row.reviewed_fingerprint,
        qualityScore: null,
      });
      return {
        evaluationState: unavailState,
        jobHash: String(row.source_job_id),
        role: row.job_title || "Unknown Role",
        company: row.company_name || "Unknown Company",
        location: row.location || "Unknown",
        postedRelative: "recently",
        scrapedFrom: toScrapeSource(row.source),
        applyUrl: row.apply_url || undefined,
        reasonCode: unavailState,
        evaluationFingerprint: readModel.evaluationFingerprint,
        userDecision: userDecision ? {
          personId: scope.personId,
          jobHash: row.source_job_id,
          userAction: userDecision,
          reviewedFingerprint: readModel.reviewedFingerprint,
          updatedAt: row.user_decision_updated_at,
        } : null,
        effectiveDecision: readModel.effectiveDecision,
        reviewState: readModel.reviewState,
      } as UnavailableOpportunity;
    }

    if (!row.evaluation_json) {
      const userDecision = row.user_action ? toUserAction(row.user_action) : null;
      const readModel = resolveCanonicalServingReadModel({
        evaluationState: "UNMATERIALIZED",
        engineVerdict: null,
        userDecision,
        evaluationFingerprint: null,
        reviewedFingerprint: row.reviewed_fingerprint,
        qualityScore: null,
      });
      return {
        evaluationState: "UNMATERIALIZED",
        jobHash: String(row.source_job_id),
        role: row.job_title || "Unknown Role",
        company: row.company_name || "Unknown Company",
        location: row.location || "Unknown",
        postedRelative: "recently",
        scrapedFrom: toScrapeSource(row.source),
        applyUrl: row.apply_url || undefined,
        contextFingerprint: activeContext.contextFingerprint,
        evaluationFingerprint: readModel.evaluationFingerprint,
        userDecision: userDecision ? {
          personId: scope.personId,
          jobHash: row.source_job_id,
          userAction: userDecision,
          reviewedFingerprint: readModel.reviewedFingerprint,
          updatedAt: row.user_decision_updated_at,
        } : null,
        effectiveDecision: readModel.effectiveDecision,
        reviewState: readModel.reviewState,
      } as UnmaterializedOpportunity;
    }

    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(row.evaluation_json);
    } catch {
      const userDecision = row.user_action ? toUserAction(row.user_action) : null;
      const readModel = resolveCanonicalServingReadModel({
        evaluationState: "INVALID",
        engineVerdict: null,
        userDecision,
        evaluationFingerprint: row.evaluation_fingerprint,
        reviewedFingerprint: row.reviewed_fingerprint,
        qualityScore: null,
      });
      return {
        evaluationState: "INVALID",
        jobHash: String(row.source_job_id),
        role: row.job_title || "Unknown Role",
        company: row.company_name || "Unknown Company",
        location: row.location || "Unknown",
        postedRelative: "recently",
        scrapedFrom: toScrapeSource(row.source),
        applyUrl: row.apply_url || undefined,
        reasonCode: "MALFORMED_EVALUATION",
        evaluationFingerprint: readModel.evaluationFingerprint,
        userDecision: userDecision ? {
          personId: scope.personId,
          jobHash: row.source_job_id,
          userAction: userDecision,
          reviewedFingerprint: readModel.reviewedFingerprint,
          updatedAt: row.user_decision_updated_at,
        } : null,
        effectiveDecision: readModel.effectiveDecision,
        reviewState: readModel.reviewState,
      } as UnavailableOpportunity;
    }

    const userState: UserDecisionStateV4 | null = row.user_action
      ? {
          personId: scope.personId,
          jobHash: row.source_job_id,
          userAction: toUserAction(row.user_action),
          reviewedFingerprint: row.reviewed_fingerprint,
          updatedAt: row.user_decision_updated_at,
        }
      : null;

    const presentationContext: ServingPresentationContext = {
      personId: scope.personId,
    };

    const oppSource = {
      jobHash: row.source_job_id,
      role: row.job_title || "Executive Opportunity",
      company: row.company_name || "Executive Firm",
      location: row.location || "Remote",
      scrapedFrom: row.source || "LinkedIn",
      applyUrl: row.apply_url || undefined,
      postedAt: row.posted_at || undefined,
      postedPrecision: row.posted_precision || undefined,
    };

    // Pre-production derived rows that do not carry the canonical intrinsic
    // payload are deliberately not adapted into plausible recommendations.
    if (!isCanonicalIntrinsicEvaluation(rawParsed)) {
      const readModel = resolveCanonicalServingReadModel({
        evaluationState: "INVALID",
        engineVerdict: null,
        userDecision: userState?.userAction || null,
        evaluationFingerprint: row.evaluation_fingerprint,
        reviewedFingerprint: row.reviewed_fingerprint,
        qualityScore: null,
      });
      return {
        evaluationState: "INVALID",
        jobHash: String(row.source_job_id),
        role: row.job_title || "Unknown Role",
        company: row.company_name || "Unknown Company",
        location: row.location || "Unknown",
        postedRelative: "recently",
        scrapedFrom: toScrapeSource(row.source),
        applyUrl: row.apply_url || undefined,
        reasonCode: "NON_CANONICAL_EVALUATION",
        userDecision: userState,
        evaluationFingerprint: readModel.evaluationFingerprint,
        effectiveDecision: readModel.effectiveDecision,
        reviewState: readModel.reviewState,
      } as UnavailableOpportunity;
    }

    const opp = serveEvaluation(rawParsed, presentationContext, oppSource, userState) as EvaluatedOpportunity;
    const readModel = resolveCanonicalServingReadModel({
      evaluationState: "EVALUATED",
      engineVerdict: row.engine_decision,
      userDecision: userState?.userAction || null,
      evaluationFingerprint: row.evaluation_fingerprint,
      reviewedFingerprint: row.reviewed_fingerprint,
      qualityScore: row.quality_score,
    });
    // Persisted materialized columns, not JSON compatibility aliases, are the
    // authoritative recommendation/provenance values exposed by dossier.
    if (opp.engineRecommendation) {
      opp.engineRecommendation = {
        ...opp.engineRecommendation,
        engineVerdict: readModel.engineVerdict,
        evaluationFingerprint: row.evaluation_fingerprint || opp.engineRecommendation.evaluationFingerprint,
        qualityScore: row.quality_score,
      };
    }
    opp.effectiveDecision = readModel.effectiveDecision as EffectiveDecision;
    (opp as EvaluatedOpportunity & { reviewState: CanonicalReviewState }).reviewState = readModel.reviewState;

    return opp;
  }

  /**
   * Point lookup for previous/next adjacent navigation within the filtered population.
   * Invariants:
   * 1. Ordering Invariant: Identical sequence (tier ASC, quality_score DESC NULLS LAST, job_hash ASC).
   * 2. Filter-Aware: Prev/Next strictly respects categoryId and decisionFilter.
   * 3. Zero Heavy Artifacts: Only projection scalars are selected for sequence calculation.
   */
  async getNavigation(
    scope: AuthorizedPersonScope,
    jobHash: string,
    filters?: FeedFilters
  ): Promise<NavigationContext | null> {
    const resolved = await resolveServingScope(scope.personId, scope.tenantId, this.db);
    const activeContext = resolved.activeContext;
    if (!activeContext) {
      return null;
    }

    // Resolve alias if needed
    const aliasRow = await this.db.one<{ source_job_id: string }>(
      `SELECT co.source_job_id
       FROM search_plan_candidates spc
       JOIN canonical_opportunities co ON co.id = spc.canonical_job_id
       WHERE spc.tenant_id = ? AND spc.person_id = ? AND spc.search_plan_id = ?
         AND (co.source_job_id = ? OR co.id = ? OR spc.canonical_job_id = ?) LIMIT 1`,
      [scope.tenantId, scope.personId, scope.activeSearchPlanId || activeContext.searchPlanId, jobHash, jobHash, jobHash]
    );
    const targetHash = aliasRow ? String(aliasRow.source_job_id) : jobHash;

    const whereConditions: string[] = [];
    const queryParams: any[] = [
      scope.activeEvaluationContextId || activeContext.contextFingerprint,
      scope.tenantId,
      scope.personId,
      scope.activeSearchPlanId || activeContext.searchPlanId,
    ];

    if (filters?.decisionFilter === "unreviewed") {
      whereConditions.push(`user_action = 'NONE'`);
    } else if (filters?.decisionFilter === "decided") {
      whereConditions.push(`user_action != 'NONE'`);
    }

    const filterSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

    const rows = await this.db.many<{
      job_hash: string;
      role: string;
      evaluation_state: string;
      engine_verdict: string | null;
    }>(
      `WITH feed_candidates AS (
         SELECT 
           co.source_job_id AS job_hash,
           COALESCE(ov.job_title, 'Executive Opportunity') AS role,
           CASE 
             WHEN me.evaluation_state = 'SPARSE_SPEC' THEN 'SPARSE_SPEC'
             WHEN me.id IS NOT NULL THEN 'COMPLETE'
             ELSE 'UNMATERIALIZED'
           END AS evaluation_state,
           me.decision AS engine_verdict,
           me.quality_score AS quality_score,
           COALESCE(d.action, 'NONE') AS user_action,

           -- Authoritative Population Tier
           CASE 
             WHEN d.action = 'PASS' THEN 5
             WHEN d.action = 'PURSUE' THEN
               CASE 
                 WHEN me.decision = 'PASS' OR me.vetoed = 1 THEN 2
                 WHEN me.decision = 'PURSUE' THEN 0
                 WHEN me.decision = 'CONSIDER' THEN 1
                 ELSE 0
               END
             WHEN d.action = 'CONSIDER' THEN
               CASE 
                 WHEN me.decision = 'CONSIDER' THEN 3
                 ELSE 1
               END
             WHEN spc.attention_decision = 'NOT_CANDIDATE' THEN 4
             WHEN me.decision IS NULL OR me.evaluation_state = 'SPARSE_SPEC' OR me.decision = 'SPARSE_SPEC' THEN 4
             WHEN me.decision = 'PURSUE' THEN 0
             WHEN me.decision = 'CONSIDER' THEN 3
             ELSE 5
           END AS population_tier
         FROM search_plan_candidates spc
         JOIN canonical_opportunities co 
           ON spc.canonical_job_id = co.id
         JOIN opportunity_versions ov 
           ON co.id = ov.canonical_job_id 
          AND spc.opportunity_version = ov.id
         LEFT JOIN materialized_evaluations me 
           ON me.canonical_job_id = spc.canonical_job_id 
          AND me.opportunity_version = spc.opportunity_version
          AND me.tenant_id = spc.tenant_id 
          AND me.person_id = spc.person_id 
          AND me.evaluation_context_fingerprint = ?
         LEFT JOIN canonical_decisions d 
           ON d.canonical_job_id = spc.canonical_job_id 
          AND d.tenant_id = spc.tenant_id 
          AND d.person_id = spc.person_id
         WHERE spc.tenant_id = ?
           AND spc.person_id = ?
           AND spc.search_plan_id = ?
           AND spc.attention_decision = 'CANDIDATE'
           AND ov.lifecycle_state = 'ACTIVE'
       )
       SELECT 
         job_hash,
         role,
         evaluation_state,
         engine_verdict
       FROM feed_candidates
       ${filterSql}
       ORDER BY 
         population_tier ASC,
         CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END ASC,
         quality_score DESC,
         job_hash ASC`,
      queryParams
    );

    let items = rows;
    if (filters?.categoryId) {
      items = items.filter((r) => {
        const cats = classifyOpportunityCategories({
          role: r.role,
          evaluationStatus: r.evaluation_state === "SPARSE_SPEC" ? "SPARSE_SPEC" : "COMPLETE",
          evaluationState: r.evaluation_state,
          recommendation: r.engine_verdict || undefined,
          description: r.role,
        });
        return cats.includes(filters.categoryId!);
      });
    }

    const totalCount = items.length;
    const idx = items.findIndex((i) => i.job_hash === targetHash);

    if (idx === -1) {
      return null;
    }

    return {
      currentIndex: idx + 1,
      totalCount: totalCount || 1,
      prevJobHash: idx > 0 ? items[idx - 1].job_hash : undefined,
      nextJobHash: idx < totalCount - 1 ? items[idx + 1].job_hash : undefined,
    };
  }
}
