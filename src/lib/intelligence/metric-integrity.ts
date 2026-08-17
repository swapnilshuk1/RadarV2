/**
 * src/lib/intelligence/metric-integrity.ts
 *
 * RADAR V4 Canonical Metric Source-of-Truth & Load-Time Integrity System.
 *
 * Invariants:
 * 1. Single Canonical Metrics Contract: UI must consume a single validated metrics object.
 * 2. Independent Source-of-Truth Validation: Metrics are verified against independent database queries.
 * 3. Mathematical Invariant Enforcement: Validates population bounds and relationships.
 * 4. Automatic Load-Time Execution: Runs on server loader data retrieval.
 * 5. Visible Integrity Warning: Discrepancies generate structured warnings without silent fallbacks.
 */

import { DatabaseAdapter } from "../../data/database";

export type IntegrityStatus = "PASS" | "WARNING" | "ERROR" | "UNAVAILABLE";

export interface MetricIntegrityCheck {
  readonly code: string;
  readonly metricName: string;
  readonly expected: number | string;
  readonly actual: number | string;
  readonly status: "PASS" | "WARNING" | "ERROR";
  readonly message: string;
}

export interface MetricIntegrityResult {
  readonly status: IntegrityStatus;
  readonly validatedAt: string;
  readonly checks: readonly MetricIntegrityCheck[];
  readonly discrepancies: readonly MetricIntegrityCheck[];
  readonly summaryMessage: string;
  readonly devDetails?: {
    readonly personId: string;
    readonly totalChecked: number;
    readonly totalFailed: number;
  };
}

export interface MetricBreakdown {
  readonly pursue: number;
  readonly consider: number;
  readonly pass: number;
  readonly sparse: number;
}

export interface UserDecisionMetrics {
  readonly pursue: number;
  readonly consider: number;
  readonly pass: number;
  readonly total: number;
}

export interface CanonicalOpportunityMetrics {
  readonly personId: string;
  readonly snapshotId: string;
  readonly generatedAt: string;
  readonly evaluationVersion: string;

  // Global Core Metrics
  readonly totalScreened: number;
  readonly activePursuits: number;
  readonly totalShortlisted: number;
  readonly totalDecisions: number;
  readonly remainingToReview: number;

  // Granular Distributions
  readonly engineBreakdown: MetricBreakdown;
  readonly userBreakdown: UserDecisionMetrics;
  readonly effectiveBreakdown: MetricBreakdown;

  // Authoritative Category Population Metrics
  readonly categoryMetrics?: Record<string, { total: number; unreviewed: number; shortlisted: number }>;

  // Metric Integrity Check Result
  readonly integrity: MetricIntegrityResult;
}

export class MetricIntegrityValidator {
  /**
   * Validates a CanonicalOpportunityMetrics snapshot against independent database verification queries
   * and mathematical invariants.
   */
  public static async validate(
    metrics: Omit<CanonicalOpportunityMetrics, "integrity">,
    db: DatabaseAdapter
  ): Promise<MetricIntegrityResult> {
    const validatedAt = new Date().toISOString();
    const checks: MetricIntegrityCheck[] = [];
    const discrepancies: MetricIntegrityCheck[] = [];

    try {
      // 1. Independent Database Query Verification (Source-of-Truth Check)
      const independentScreened = await db.one<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM candidate_evaluations WHERE person_id = ?`,
        [metrics.personId]
      );

      const independentVerdicts = await db.many<{ engine_verdict: string; cnt: number }>(
        `SELECT effective_decision as engine_verdict, COUNT(*) as cnt FROM candidate_evaluations WHERE person_id = ? GROUP BY effective_decision`,
        [metrics.personId]
      );

      const independentEffective = await db.many<{ effective_decision: string; cnt: number }>(
        `SELECT COALESCE(d.action, ce.user_decision_override, ce.effective_decision) as effective_decision, COUNT(*) as cnt
         FROM candidate_evaluations ce
         LEFT JOIN decisions d ON ce.person_id = d.person_id AND ce.job_hash = d.opportunity_id
         WHERE ce.person_id = ?
         GROUP BY COALESCE(d.action, ce.user_decision_override, ce.effective_decision)`,
        [metrics.personId]
      );

      const independentDecisions = await db.one<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM decisions WHERE person_id = ?`,
        [metrics.personId]
      );

      const expectedScreened = independentScreened?.cnt ?? 0;
      const expectedDecisions = independentDecisions?.cnt ?? 0;

      const verdictMap = new Map<string, number>();
      for (const row of independentVerdicts) {
        verdictMap.set(row.engine_verdict, row.cnt);
      }

      const effectiveMap = new Map<string, number>();
      for (const row of independentEffective) {
        effectiveMap.set(row.effective_decision, row.cnt);
      }

      const expectedEnginePursue = (verdictMap.get("PURSUE") ?? 0) + (verdictMap.get("RECOMMEND_PURSUE") ?? 0);
      const expectedEngineConsider = (verdictMap.get("CONSIDER") ?? 0) + (verdictMap.get("RECOMMEND_CONSIDER") ?? 0);
      const expectedEnginePass = (verdictMap.get("PASS") ?? 0) + (verdictMap.get("RECOMMEND_PASS") ?? 0);
      const expectedEffectivePursue = effectiveMap.get("PURSUE") ?? 0;
      const expectedEffectiveShortlisted = (effectiveMap.get("PURSUE") ?? 0) + (effectiveMap.get("CONSIDER") ?? 0);

      // Check A: Total Screened Population
      const checkScreened: MetricIntegrityCheck = {
        code: "CHECK_TOTAL_SCREENED",
        metricName: "totalScreened",
        expected: expectedScreened,
        actual: metrics.totalScreened,
        status: metrics.totalScreened === expectedScreened ? "PASS" : "ERROR",
        message: metrics.totalScreened === expectedScreened
          ? `totalScreened matches database count (${expectedScreened}).`
          : `totalScreened (${metrics.totalScreened}) conflicts with database count (${expectedScreened}).`,
      };
      checks.push(checkScreened);
      if (checkScreened.status !== "PASS") discrepancies.push(checkScreened);

      // Check B: Active Pursuits Metric
      const checkPursuits: MetricIntegrityCheck = {
        code: "CHECK_ACTIVE_PURSUITS",
        metricName: "activePursuits",
        expected: expectedEffectivePursue,
        actual: metrics.activePursuits,
        status: metrics.activePursuits === expectedEffectivePursue ? "PASS" : "ERROR",
        message: metrics.activePursuits === expectedEffectivePursue
          ? `activePursuits matches database effective PURSUE count (${expectedEffectivePursue}).`
          : `activePursuits (${metrics.activePursuits}) conflicts with database count (${expectedEffectivePursue}).`,
      };
      checks.push(checkPursuits);
      if (checkPursuits.status !== "PASS") discrepancies.push(checkPursuits);

      // Check C: Shortlisted Metric
      const checkShortlisted: MetricIntegrityCheck = {
        code: "CHECK_TOTAL_SHORTLISTED",
        metricName: "totalShortlisted",
        expected: expectedEffectiveShortlisted,
        actual: metrics.totalShortlisted,
        status: metrics.totalShortlisted === expectedEffectiveShortlisted ? "PASS" : "ERROR",
        message: metrics.totalShortlisted === expectedEffectiveShortlisted
          ? `totalShortlisted matches database shortlisted count (${expectedEffectiveShortlisted}).`
          : `totalShortlisted (${metrics.totalShortlisted}) conflicts with database count (${expectedEffectiveShortlisted}).`,
      };
      checks.push(checkShortlisted);
      if (checkShortlisted.status !== "PASS") discrepancies.push(checkShortlisted);

      // Check D: Decisions Count
      const checkDecisions: MetricIntegrityCheck = {
        code: "CHECK_TOTAL_DECISIONS",
        metricName: "totalDecisions",
        expected: expectedDecisions,
        actual: metrics.totalDecisions,
        status: metrics.totalDecisions === expectedDecisions ? "PASS" : "ERROR",
        message: metrics.totalDecisions === expectedDecisions
          ? `totalDecisions matches database decisions table count (${expectedDecisions}).`
          : `totalDecisions (${metrics.totalDecisions}) conflicts with database count (${expectedDecisions}).`,
      };
      checks.push(checkDecisions);
      if (checkDecisions.status !== "PASS") discrepancies.push(checkDecisions);

      // Check E: Engine Pursue Breakdown
      const checkEnginePursue: MetricIntegrityCheck = {
        code: "CHECK_ENGINE_PURSUE",
        metricName: "engineBreakdown.pursue",
        expected: expectedEnginePursue,
        actual: metrics.engineBreakdown.pursue,
        status: metrics.engineBreakdown.pursue === expectedEnginePursue ? "PASS" : "ERROR",
        message: metrics.engineBreakdown.pursue === expectedEnginePursue
          ? `engineBreakdown.pursue matches database count (${expectedEnginePursue}).`
          : `engineBreakdown.pursue (${metrics.engineBreakdown.pursue}) conflicts with database count (${expectedEnginePursue}).`,
      };
      checks.push(checkEnginePursue);
      if (checkEnginePursue.status !== "PASS") discrepancies.push(checkEnginePursue);

      // 2. Mathematical Invariant Verification
      // Invariant 1: Engine breakdown sum <= totalScreened
      const engineSum = metrics.engineBreakdown.pursue + metrics.engineBreakdown.consider + metrics.engineBreakdown.pass + metrics.engineBreakdown.sparse;
      const checkEngineSum: MetricIntegrityCheck = {
        code: "INV_ENGINE_SUM_LE_SCREENED",
        metricName: "engineBreakdownSum",
        expected: `<= ${metrics.totalScreened}`,
        actual: engineSum,
        status: engineSum <= metrics.totalScreened ? "PASS" : "ERROR",
        message: engineSum <= metrics.totalScreened
          ? `Engine breakdown sum (${engineSum}) is bounded by totalScreened (${metrics.totalScreened}).`
          : `Engine breakdown sum (${engineSum}) exceeds totalScreened (${metrics.totalScreened}).`,
      };
      checks.push(checkEngineSum);
      if (checkEngineSum.status !== "PASS") discrepancies.push(checkEngineSum);

      // Invariant 2: Active pursuits <= totalScreened
      const checkPursuitsLeScreened: MetricIntegrityCheck = {
        code: "INV_PURSUITS_LE_SCREENED",
        metricName: "activePursuitsBound",
        expected: `<= ${metrics.totalScreened}`,
        actual: metrics.activePursuits,
        status: metrics.activePursuits <= metrics.totalScreened ? "PASS" : "ERROR",
        message: metrics.activePursuits <= metrics.totalScreened
          ? `Active pursuits (${metrics.activePursuits}) is bounded by totalScreened (${metrics.totalScreened}).`
          : `Active pursuits (${metrics.activePursuits}) exceeds totalScreened (${metrics.totalScreened}).`,
      };
      checks.push(checkPursuitsLeScreened);
      if (checkPursuitsLeScreened.status !== "PASS") discrepancies.push(checkPursuitsLeScreened);

      // Invariant 3: Decisions <= totalScreened
      const checkDecisionsLeScreened: MetricIntegrityCheck = {
        code: "INV_DECISIONS_LE_SCREENED",
        metricName: "totalDecisionsBound",
        expected: `<= ${metrics.totalScreened}`,
        actual: metrics.totalDecisions,
        status: metrics.totalDecisions <= metrics.totalScreened ? "PASS" : "ERROR",
        message: metrics.totalDecisions <= metrics.totalScreened
          ? `Total decisions (${metrics.totalDecisions}) is bounded by totalScreened (${metrics.totalScreened}).`
          : `Total decisions (${metrics.totalDecisions}) exceeds totalScreened (${metrics.totalScreened}).`,
      };
      checks.push(checkDecisionsLeScreened);
      if (checkDecisionsLeScreened.status !== "PASS") discrepancies.push(checkDecisionsLeScreened);

      // Invariant 4: Remaining to review <= totalScreened
      const checkRemainingLeScreened: MetricIntegrityCheck = {
        code: "INV_REMAINING_LE_SCREENED",
        metricName: "remainingToReviewBound",
        expected: `<= ${metrics.totalScreened}`,
        actual: metrics.remainingToReview,
        status: metrics.remainingToReview <= metrics.totalScreened ? "PASS" : "ERROR",
        message: metrics.remainingToReview <= metrics.totalScreened
          ? `Remaining to review (${metrics.remainingToReview}) is bounded by totalScreened (${metrics.totalScreened}).`
          : `Remaining to review (${metrics.remainingToReview}) exceeds totalScreened (${metrics.totalScreened}).`,
      };
      checks.push(checkRemainingLeScreened);
      if (checkRemainingLeScreened.status !== "PASS") discrepancies.push(checkRemainingLeScreened);

      // Invariant 5: Category Population Bounds
      if (metrics.categoryMetrics) {
        for (const [catId, catVal] of Object.entries(metrics.categoryMetrics)) {
          const isCategoryTotalValid = catVal.total <= metrics.totalScreened;
          const isCategoryUnreviewedValid = catVal.unreviewed <= catVal.total;
          const isCategoryShortlistedValid = catVal.shortlisted <= catVal.total;

          const catCheck: MetricIntegrityCheck = {
            code: `INV_CATEGORY_${catId.toUpperCase()}_BOUND`,
            metricName: `category_${catId}`,
            expected: `total <= ${metrics.totalScreened}, unreviewed <= total, shortlisted <= total`,
            actual: `total=${catVal.total}, unreviewed=${catVal.unreviewed}, shortlisted=${catVal.shortlisted}`,
            status: (isCategoryTotalValid && isCategoryUnreviewedValid && isCategoryShortlistedValid) ? "PASS" : "ERROR",
            message: (isCategoryTotalValid && isCategoryUnreviewedValid && isCategoryShortlistedValid)
              ? `Category ${catId} population bounds verified.`
              : `Category ${catId} population violation (total=${catVal.total}, unreviewed=${catVal.unreviewed}, shortlisted=${catVal.shortlisted}, totalScreened=${metrics.totalScreened}).`,
          };
          checks.push(catCheck);
          if (catCheck.status !== "PASS") discrepancies.push(catCheck);
        }
      }

      const hasError = discrepancies.some((d) => d.status === "ERROR");
      const hasWarning = discrepancies.some((d) => d.status === "WARNING");
      const overallStatus: IntegrityStatus = hasError ? "ERROR" : hasWarning ? "WARNING" : "PASS";

      return {
        status: overallStatus,
        validatedAt,
        checks,
        discrepancies,
        summaryMessage: overallStatus === "PASS"
          ? "All metric integrity checks passed."
          : `Metric integrity check detected ${discrepancies.length} discrepancy(ies).`,
        devDetails: {
          personId: metrics.personId,
          totalChecked: checks.length,
          totalFailed: discrepancies.length,
        },
      };
    } catch (err: any) {
      // Query failure path: NEVER return PASS or silent fallback
      const errorCheck: MetricIntegrityCheck = {
        code: "VERIFICATION_QUERY_FAILED",
        metricName: "databaseVerification",
        expected: "Successful Query",
        actual: err?.message || String(err),
        status: "ERROR",
        message: `Independent metric verification query failed: ${err?.message || err}`,
      };
      return {
        status: "UNAVAILABLE",
        validatedAt,
        checks: [errorCheck],
        discrepancies: [errorCheck],
        summaryMessage: "Metric integrity validation unavailable due to database verification error.",
        devDetails: {
          personId: metrics.personId,
          totalChecked: 1,
          totalFailed: 1,
        },
      };
    }
  }
}
