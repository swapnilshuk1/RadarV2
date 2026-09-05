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

/** Mutually exclusive canonical evaluation states in the authorized feed population. */
export interface EvaluationPopulationBreakdown {
  readonly evaluated: number;
  readonly sparse: number;
  readonly unmaterialized: number;
  readonly profileRequired: number;
  readonly notEvaluable: number;
  readonly invalid: number;
}

export function reconcileEvaluationPopulation(
  total: number,
  breakdown: EvaluationPopulationBreakdown,
): MetricIntegrityCheck {
  const actual =
    breakdown.evaluated +
    breakdown.sparse +
    breakdown.unmaterialized +
    breakdown.profileRequired +
    breakdown.notEvaluable +
    breakdown.invalid;
  return {
    code: "INV_CANONICAL_POPULATION_PARTITION",
    metricName: "canonicalEvaluationPopulation",
    expected: total,
    actual,
    status: total === actual ? "PASS" : "ERROR",
    message: total === actual
      ? "Canonical evaluation states partition the authorized population."
      : `Canonical evaluation state partition mismatch: expected ${total}, actual ${actual}, delta ${actual - total}.`,
  };
}

export interface CanonicalOpportunityMetrics {
  readonly personId: string;
  /** Canonical population scope used for independent metric reconciliation. */
  readonly tenantId?: string;
  readonly searchPlanId?: string;
  readonly evaluationContextFingerprint?: string;
  readonly snapshotId: string;
  readonly generatedAt: string;
  readonly evaluationVersion: string;

  // Global Core Metrics
  readonly totalScreened: number;

  /**
   * @deprecated Cross-stage metric summing unreviewed engine pursuits and user decisions.
   * For user decisions, inspect `decisionMetrics.userPursueTotal` (472).
   * For active review queue, inspect `discoveryMetrics.actionableReviewQueue` (82).
   */
  readonly activePursuits: number;

  /**
   * Total opportunities shortlisted/qualified by RADAR's recommendation engine (389 Pursue + 256 Consider = 645).
   * Strictly decoupled from user decision overrides (does NOT include VETO_OVERRIDE).
   */
  readonly totalShortlisted: number;

  readonly totalDecisions: number;
  /**
   * Explicit disambiguation of user decision metrics:
   * - `evaluatedDecisions`: User decisions recorded against fully materialized/evaluated opportunities (1,498).
   * - `allRecordedDecisions`: All user decisions across all search plan candidates including sparse/unmaterialized (1,509).
   */
  readonly evaluatedDecisions?: number;
  readonly allRecordedDecisions?: number;
  readonly remainingToReview: number;

  // Granular Distributions
  readonly engineBreakdown: MetricBreakdown;
  readonly evaluationPopulation: EvaluationPopulationBreakdown;
  readonly userBreakdown: UserDecisionMetrics;
  readonly effectiveBreakdown: MetricBreakdown;

  // Canonical Stage Breakdown (Disambiguating Discovery/Shortlist vs Decisions)
  readonly discoveryMetrics?: {
    readonly engineQualified: number;       // 645 (389 Pursue + 256 Consider)
    readonly actionableReviewQueue: number; // 82 (22 Pursue + 60 Consider unreviewed)
    readonly unreviewedSparse: number;      // 639
  };
  readonly decisionMetrics?: {
    readonly totalDecided: number;          // 1,498
    readonly evaluatedDecisions?: number;   // 1,498 (decisions on evaluated/materialized opportunities)
    readonly allRecordedDecisions?: number; // 1,509 (all decisions including sparse/unmaterialized)
    readonly userConfirmed: number;         // 308 (Engine Pursue + User Pursue)
    readonly preferenceOverride: number;    // 46 (Engine Consider + User Pursue/Consider overrides)
    readonly vetoOverride: number;          // 122 (Engine Pass + User Pursue)
    readonly userPassed: number;            // 889 (Explicit user pass)
    readonly userPursueTotal: number;       // 472 (Total explicit user Pursue decisions)
    readonly userConsiderTotal: number;     // 137 (Total explicit user Consider decisions)
    readonly userPassTotal: number;         // 889 (Total explicit user Pass decisions)
    readonly sparseDecisions?: {
      readonly total: number;               // 11
      readonly pursue: number;              // 2
      readonly consider: number;            // 1
      readonly pass: number;                // 8
    };
  };

  // Authoritative Category Population Metrics
  readonly categoryMetrics?: Record<string, { total: number; unreviewed: number; shortlisted: number }>;

  // Authoritative Portal Discovery Metrics (Search Plan Population DB-wide)
  readonly portalMetrics?: {
    readonly LinkedIn: number;
    readonly Naukri: number;
    readonly Indeed: number;
    readonly other: number;
    readonly total: number;
  };

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
      if (metrics.tenantId && metrics.searchPlanId && metrics.evaluationContextFingerprint) {
        const canonical = await db.one<{ total: number; evaluated: number; pursue: number; consider: number; pass: number; sparse: number; unmaterialized: number; profile_required: number; not_evaluable: number; invalid: number; user_pursue: number; user_consider: number; user_pass: number; user_total: number }>(
          `SELECT COUNT(*) AS total,
            COUNT(CASE WHEN me.evaluation_state IN ('COMPLETE','EVALUATED') AND me.decision IN ('PURSUE','CONSIDER','PASS') AND me.quality_score IS NOT NULL AND me.evaluation_fingerprint IS NOT NULL THEN 1 END) AS evaluated,
            COUNT(CASE WHEN me.evaluation_state IN ('COMPLETE','EVALUATED') AND me.decision='PURSUE' AND me.quality_score IS NOT NULL AND me.evaluation_fingerprint IS NOT NULL THEN 1 END) AS pursue,
            COUNT(CASE WHEN me.evaluation_state IN ('COMPLETE','EVALUATED') AND me.decision='CONSIDER' AND me.quality_score IS NOT NULL AND me.evaluation_fingerprint IS NOT NULL THEN 1 END) AS consider,
            COUNT(CASE WHEN me.evaluation_state IN ('COMPLETE','EVALUATED') AND me.decision='PASS' AND me.quality_score IS NOT NULL AND me.evaluation_fingerprint IS NOT NULL THEN 1 END) AS pass,
            COUNT(CASE WHEN me.evaluation_state='SPARSE_SPEC' THEN 1 END) AS sparse,
            COUNT(CASE WHEN me.id IS NULL THEN 1 END) AS unmaterialized,
            COUNT(CASE WHEN me.evaluation_state='PROFILE_REQUIRED' THEN 1 END) AS profile_required,
            COUNT(CASE WHEN me.evaluation_state='NOT_EVALUABLE' THEN 1 END) AS not_evaluable,
            COUNT(CASE WHEN me.id IS NOT NULL AND NOT (me.evaluation_state='SPARSE_SPEC' OR me.evaluation_state IN ('PROFILE_REQUIRED','NOT_EVALUABLE') OR (me.evaluation_state IN ('COMPLETE','EVALUATED') AND me.decision IN ('PURSUE','CONSIDER','PASS') AND me.quality_score IS NOT NULL AND me.evaluation_fingerprint IS NOT NULL)) THEN 1 END) AS invalid,
            COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action='PURSUE' THEN 1 END) AS user_pursue,
            COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action='CONSIDER' THEN 1 END) AS user_consider,
            COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action='PASS' THEN 1 END) AS user_pass,
            COUNT(CASE WHEN me.id IS NOT NULL AND me.evaluation_state != 'SPARSE_SPEC' AND d.action IN ('PURSUE','CONSIDER','PASS') THEN 1 END) AS user_total
           FROM search_plan_candidates spc JOIN opportunity_versions ov ON ov.id=spc.opportunity_version AND ov.canonical_job_id=spc.canonical_job_id
           LEFT JOIN materialized_evaluations me ON me.canonical_job_id=spc.canonical_job_id AND me.opportunity_version=spc.opportunity_version AND me.tenant_id=spc.tenant_id AND me.person_id=spc.person_id AND me.evaluation_context_fingerprint=?
           LEFT JOIN canonical_decisions d ON d.canonical_job_id=spc.canonical_job_id AND d.tenant_id=spc.tenant_id AND d.person_id=spc.person_id
           WHERE spc.tenant_id=? AND spc.person_id=? AND spc.search_plan_id=? AND spc.attention_decision='CANDIDATE' AND ov.lifecycle_state='ACTIVE'`,
          [metrics.evaluationContextFingerprint, metrics.tenantId, metrics.personId, metrics.searchPlanId],
        );
        const state = canonical!;
        const checks: MetricIntegrityCheck[] = [
          reconcileEvaluationPopulation(metrics.totalScreened, metrics.evaluationPopulation),
          { code: "CHECK_CANONICAL_TOTAL", metricName: "totalScreened", expected: state.total, actual: metrics.totalScreened, status: state.total === metrics.totalScreened ? "PASS" : "ERROR", message: "Independent canonical candidate population reconciliation." },
          { code: "CHECK_EVALUATED_PARTITION", metricName: "evaluated", expected: state.evaluated, actual: metrics.engineBreakdown.pursue + metrics.engineBreakdown.consider + metrics.engineBreakdown.pass, status: state.evaluated === metrics.engineBreakdown.pursue + metrics.engineBreakdown.consider + metrics.engineBreakdown.pass ? "PASS" : "ERROR", message: "Evaluated population equals engine verdict partition." },
          { code: "CHECK_ENGINE_SHORTLIST", metricName: "totalShortlisted", expected: state.pursue + state.consider, actual: metrics.totalShortlisted, status: state.pursue + state.consider === metrics.totalShortlisted ? "PASS" : "ERROR", message: "Shortlist is engine PURSUE plus CONSIDER, never user/effective decisions." },
          { code: "CHECK_USER_PURSUIT", metricName: "userBreakdown.pursue", expected: state.user_pursue, actual: metrics.userBreakdown.pursue, status: state.user_pursue === metrics.userBreakdown.pursue ? "PASS" : "ERROR", message: "User pursuit remains separate from engine recommendation." },
          { code: "CHECK_USER_CONSIDER", metricName: "userBreakdown.consider", expected: state.user_consider, actual: metrics.userBreakdown.consider, status: state.user_consider === metrics.userBreakdown.consider ? "PASS" : "ERROR", message: "User consideration remains separate from engine recommendation." },
          { code: "CHECK_USER_PASS", metricName: "userBreakdown.pass", expected: state.user_pass, actual: metrics.userBreakdown.pass, status: state.user_pass === metrics.userBreakdown.pass ? "PASS" : "ERROR", message: "User pass remains separate from engine recommendation." },
          { code: "CHECK_USER_TOTAL", metricName: "userBreakdown.total", expected: state.user_total, actual: metrics.userBreakdown.total, status: state.user_total === metrics.userBreakdown.total ? "PASS" : "ERROR", message: "Canonical user-decision population reconciliation." },
        ];
        const failed = checks.filter((check) => check.status !== "PASS");
        return { status: failed.length ? "ERROR" : "PASS", validatedAt, checks, discrepancies: failed, summaryMessage: failed.length ? "Canonical metric reconciliation failed." : "Canonical metric reconciliation passed.", devDetails: { personId: metrics.personId, totalChecked: checks.length, totalFailed: failed.length } };
      }
      // A snapshot without its canonical scope is not reconcilable.  It must
      // never be compared with historical tables that happen to have a person
      // identifier in common.
      const unavailable: MetricIntegrityCheck = {
        code: "CANONICAL_SCOPE_UNAVAILABLE",
        metricName: "canonicalPopulationScope",
        expected: "tenantId, searchPlanId, evaluationContextFingerprint",
        actual: "incomplete scope",
        status: "ERROR",
        message: "Canonical metric integrity cannot run without a complete authorized population scope.",
      };
      return {
        status: "UNAVAILABLE",
        validatedAt,
        checks: [unavailable],
        discrepancies: [unavailable],
        summaryMessage: unavailable.message,
        devDetails: { personId: metrics.personId, totalChecked: 1, totalFailed: 1 },
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
