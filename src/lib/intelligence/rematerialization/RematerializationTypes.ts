/**
 * src/lib/intelligence/rematerialization/RematerializationTypes.ts
 *
 * RADAR V4 Canonical Re-Materialization Domain Types & Contracts
 */

export type RematerializationState =
  | "LEGACY"
  | "CANONICAL_FRESH"
  | "CANONICAL_STALE"
  | "MIGRATED"
  | "FAILED"
  | "SKIPPED_REQUIRES_REVIEW";

export interface RematerializeOptions {
  /** If true, runs all evaluations and checks but writes zero mutations to the database */
  readonly dryRun: boolean;
  /** Maximum number of rows to process in this run (e.g. 10 for batch 1, 100 for batch 5) */
  readonly limit?: number;
  /** Cursor for resume/pagination (job_hash string) */
  readonly cursor?: string;
  /** Specific candidate personId to target (defaults to all persons if omitted) */
  readonly personId?: string;
  /** Specific jobHash to target */
  readonly jobHash?: string;
  /** Sub-batch size for transaction chunking */
  readonly batchSize?: number;
  /** Policy version to target (defaults to "v4.3") */
  readonly policyVersion?: string;
  /** Ontology version to target (defaults to "v2") */
  readonly ontologyVersion?: string;
  /** Concurrency limit for parallel evaluation & write worker pool (default: 8) */
  readonly concurrency?: number;
  /** If true, loops continuously batch-by-batch until no rows remain or stop condition is met */
  readonly continuous?: boolean;
  /** Maximum batches to run in continuous mode (default: unlimited) */
  readonly maxBatches?: number;
  /** Stop continuous execution if consecutive failures exceed this count (default: 5) */
  readonly stopOnErrorThreshold?: number;
}

export interface RowComparison {
  readonly personId: string;
  readonly jobHash: string;
  readonly state: RematerializationState;
  readonly oldFingerprint: string | null;
  readonly newFingerprint: string | null;
  readonly oldEngineVerdict: string | null;
  readonly newIntrinsicVerdict: string | null;
  readonly oldQualityScore: number | null;
  readonly newIntrinsicQualityScore: number | null;
  readonly oldEvaluationStatus: string | null;
  readonly newEvaluationStatus: string | null;
  readonly oldPolicyVersion: string | null;
  readonly newPolicyVersion: string | null;
  readonly userDecision: "PURSUE" | "CONSIDER" | "PASS" | null;
  readonly userDecisionPreserved: boolean;
  readonly skipReason?: string;
  readonly error?: string;
  readonly durationMs: number;
}

export interface BatchReconciliationReport {
  readonly batchId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly dryRun: boolean;
  readonly examined: number;
  readonly migrated: number;
  readonly alreadyCanonical: number;
  readonly skipped: number;
  readonly failed: number;
  readonly sourceMissing: number;
  readonly profileMissing: number;
  readonly fingerprintMismatch: number;
  readonly evaluationErrors: number;
  readonly decisionPreservationFailures: number;
  readonly nextCursor: string | null;
  readonly legacyVerdictDistribution: Record<string, number>;
  readonly newIntrinsicVerdictDistribution: Record<string, number>;
  readonly qualityScoreDeltas: {
    readonly meanOld: number;
    readonly meanNew: number;
    readonly meanDelta: number;
  };
  readonly evaluationStatusDistribution: Record<string, number>;
  readonly policyVersionDistribution: Record<string, number>;
  readonly ontologyVersionDistribution: Record<string, number>;
  readonly performance: {
    readonly totalDurationMs: number;
    readonly avgRowDurationMs: number;
    readonly avgDbLatencyMs: number;
    readonly dbReadLatencyMs: number;
    readonly dbWriteLatencyMs: number;
    readonly evaluationLatencyMs: number;
    readonly configuredConcurrency: number;
    readonly peakConcurrency: number;
    readonly rowsPerSec: number;
  };
  readonly rows: RowComparison[];
}

export interface ContinuousMigrationSummary {
  readonly totalBatches: number;
  readonly totalExamined: number;
  readonly totalMigrated: number;
  readonly totalAlreadyCanonical: number;
  readonly totalSkipped: number;
  readonly totalFailed: number;
  readonly totalFingerprintMismatches: number;
  readonly totalDecisionPreservationFailures: number;
  readonly initialCursor: string | null;
  readonly finalCursor: string | null;
  readonly totalDurationMs: number;
  readonly overallRowsPerSec: number;
  readonly stopReason: "COMPLETED" | "MAX_BATCHES_REACHED" | "STOP_CONDITION_TRIGGERED" | "ABORTED";
  readonly reports: BatchReconciliationReport[];
}

