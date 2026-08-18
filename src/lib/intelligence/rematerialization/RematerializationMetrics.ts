/**
 * src/lib/intelligence/rematerialization/RematerializationMetrics.ts
 *
 * Metric accumulator and reconciliation generator for batch rematerialization.
 */

import type {
  BatchReconciliationReport,
  RematerializationState,
  RowComparison,
} from "./RematerializationTypes";

export class RematerializationMetricCollector {
  private readonly batchId: string;
  private readonly startedAt: Date;
  private readonly dryRun: boolean;
  private readonly rows: RowComparison[] = [];

  private sourceMissingCount = 0;
  private profileMissingCount = 0;
  private fingerprintMismatchCount = 0;
  private evaluationErrorCount = 0;
  private decisionPreservationFailures = 0;
  private totalDbLatencyMs = 0;
  private totalDbReadLatencyMs = 0;
  private totalDbWriteLatencyMs = 0;
  private totalEvaluationLatencyMs = 0;
  private dbOperationCount = 0;
  private configuredConcurrency = 8;
  private peakConcurrency = 1;

  constructor(batchId: string, dryRun: boolean) {
    this.batchId = batchId;
    this.startedAt = new Date();
    this.dryRun = dryRun;
  }

  public recordDbLatency(latencyMs: number): void {
    this.totalDbLatencyMs += latencyMs;
    this.dbOperationCount++;
  }

  public recordDbReadLatency(latencyMs: number): void {
    this.totalDbReadLatencyMs += latencyMs;
    this.recordDbLatency(latencyMs);
  }

  public recordDbWriteLatency(latencyMs: number): void {
    this.totalDbWriteLatencyMs += latencyMs;
    this.recordDbLatency(latencyMs);
  }

  public recordEvaluationLatency(latencyMs: number): void {
    this.totalEvaluationLatencyMs += latencyMs;
  }

  public setConcurrencyMetrics(configured: number, peak: number): void {
    this.configuredConcurrency = configured;
    this.peakConcurrency = peak;
  }

  public recordRow(row: RowComparison): void {
    this.rows.push(row);

    if (row.state === "SKIPPED_REQUIRES_REVIEW") {
      if (row.skipReason?.includes("source")) {
        this.sourceMissingCount++;
      }
      if (row.skipReason?.includes("profile") || row.skipReason?.includes("projection")) {
        this.profileMissingCount++;
      }
    }

    if (row.error?.includes("FINGERPRINT_MISMATCH")) {
      this.fingerprintMismatchCount++;
    }

    if (row.state === "FAILED" || (row.error && !row.error.includes("FINGERPRINT_MISMATCH"))) {
      this.evaluationErrorCount++;
    }

    if (!row.userDecisionPreserved) {
      this.decisionPreservationFailures++;
    }
  }

  public buildReport(nextCursor: string | null = null): BatchReconciliationReport {
    const completedAt = new Date();
    const totalDurationMs = completedAt.getTime() - this.startedAt.getTime();

    let migrated = 0;
    let alreadyCanonical = 0;
    let skipped = 0;
    let failed = 0;

    const legacyVerdictDist: Record<string, number> = {};
    const newIntrinsicVerdictDist: Record<string, number> = {};
    const evalStatusDist: Record<string, number> = {};
    const policyVersionDist: Record<string, number> = {};
    const ontologyVersionDist: Record<string, number> = {};

    let sumOldScore = 0;
    let countOldScore = 0;
    let sumNewScore = 0;
    let countNewScore = 0;

    for (const r of this.rows) {
      if (r.state === "MIGRATED") migrated++;
      else if (r.state === "CANONICAL_FRESH") alreadyCanonical++;
      else if (r.state === "SKIPPED_REQUIRES_REVIEW" || r.state === "CANONICAL_STALE") skipped++;
      else if (r.state === "FAILED") failed++;

      if (r.oldEngineVerdict) {
        legacyVerdictDist[r.oldEngineVerdict] = (legacyVerdictDist[r.oldEngineVerdict] || 0) + 1;
      }
      if (r.newIntrinsicVerdict) {
        newIntrinsicVerdictDist[r.newIntrinsicVerdict] = (newIntrinsicVerdictDist[r.newIntrinsicVerdict] || 0) + 1;
      }
      if (r.newEvaluationStatus) {
        evalStatusDist[r.newEvaluationStatus] = (evalStatusDist[r.newEvaluationStatus] || 0) + 1;
      }
      if (r.newPolicyVersion) {
        policyVersionDist[r.newPolicyVersion] = (policyVersionDist[r.newPolicyVersion] || 0) + 1;
      }

      if (r.oldQualityScore !== null && r.oldQualityScore !== undefined) {
        sumOldScore += r.oldQualityScore;
        countOldScore++;
      }
      if (r.newIntrinsicQualityScore !== null && r.newIntrinsicQualityScore !== undefined) {
        sumNewScore += r.newIntrinsicQualityScore;
        countNewScore++;
      }
    }

    const meanOld = countOldScore > 0 ? sumOldScore / countOldScore : 0;
    const meanNew = countNewScore > 0 ? sumNewScore / countNewScore : 0;
    const meanDelta = meanNew - meanOld;

    const avgRowDurationMs = this.rows.length > 0 ? totalDurationMs / this.rows.length : 0;
    const avgDbLatencyMs = this.dbOperationCount > 0 ? this.totalDbLatencyMs / this.dbOperationCount : 0;
    const rowsPerSec = totalDurationMs > 0 ? (this.rows.length / totalDurationMs) * 1000 : 0;

    return {
      batchId: this.batchId,
      startedAt: this.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      dryRun: this.dryRun,
      examined: this.rows.length,
      migrated,
      alreadyCanonical,
      skipped,
      failed,
      sourceMissing: this.sourceMissingCount,
      profileMissing: this.profileMissingCount,
      fingerprintMismatch: this.fingerprintMismatchCount,
      evaluationErrors: this.evaluationErrorCount,
      decisionPreservationFailures: this.decisionPreservationFailures,
      nextCursor,
      legacyVerdictDistribution: legacyVerdictDist,
      newIntrinsicVerdictDistribution: newIntrinsicVerdictDist,
      qualityScoreDeltas: {
        meanOld: Math.round(meanOld * 100) / 100,
        meanNew: Math.round(meanNew * 100) / 100,
        meanDelta: Math.round(meanDelta * 100) / 100,
      },
      evaluationStatusDistribution: evalStatusDist,
      policyVersionDistribution: policyVersionDist,
      ontologyVersionDistribution: ontologyVersionDist,
      performance: {
        totalDurationMs: Math.round(totalDurationMs),
        avgRowDurationMs: Math.round(avgRowDurationMs * 10) / 10,
        avgDbLatencyMs: Math.round(avgDbLatencyMs * 10) / 10,
        dbReadLatencyMs: Math.round(this.totalDbReadLatencyMs * 10) / 10,
        dbWriteLatencyMs: Math.round(this.totalDbWriteLatencyMs * 10) / 10,
        evaluationLatencyMs: Math.round(this.totalEvaluationLatencyMs * 10) / 10,
        configuredConcurrency: this.configuredConcurrency,
        peakConcurrency: this.peakConcurrency,
        rowsPerSec: Math.round(rowsPerSec * 10) / 10,
      },
      rows: this.rows,
    };
  }
}

