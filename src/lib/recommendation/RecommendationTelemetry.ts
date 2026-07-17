/**
 * RecommendationTelemetry
 * 
 * Two layers of metrics for the recommendation engine:
 * 
 * 1. Operational — what the engine produced in this run
 * 2. Calibration — long-run feedback on whether the recommendations were correct
 *    (e.g., was an "Excellent" recommendation actually pursued? Was it rejected?)
 */

export interface OperationalMetrics {
  jobsEvaluated: number;
  cacheHits: number;
  excellent: number;
  good: number;
  average: number;
  weakFit: number;
  insufficientEvidence: number;
  hardConstraintViolations: number;
  averageScore: number;
  averageDataConfidence: number;
  averageModelConfidence: number;
  averageRecommendationConfidence: number;
  latencyMs: number;
  avgFacts: number;
  avgUniqueDims: number;
  avgEvidenceSnippets: number;
}

export interface CalibrationMetrics {
  reviewed: number;
  accepted: number;   // User agreed with the recommendation
  rejected: number;   // User disagreed
  ignored: number;    // No action taken
  saved: number;
  applied: number;
  interview: number;
  offer: number;
}

export class RecommendationTelemetry {
  private startTime: number;
  private scores: number[] = [];
  private dataConfidences: number[] = [];
  private modelConfidences: number[] = [];
  private recommendationConfidences: number[] = [];
  private factCounts: number[] = [];
  private uniqueDimCounts: number[] = [];
  private evidenceSnippetCounts: number[] = [];

  private ops: Omit<OperationalMetrics, "averageScore" | "averageDataConfidence" | "averageModelConfidence" | "averageRecommendationConfidence" | "latencyMs" | "avgFacts" | "avgUniqueDims" | "avgEvidenceSnippets"> = {
    jobsEvaluated: 0,
    cacheHits: 0,
    excellent: 0,
    good: 0,
    average: 0,
    weakFit: 0,
    insufficientEvidence: 0,
    hardConstraintViolations: 0,
  };

  constructor() {
    this.startTime = Date.now();
  }

  recordEvaluation(opts: {
    decision: "Excellent" | "Good" | "Average" | "Weak Fit" | "Needs More Evidence";
    score: number;
    dataConfidence: number;
    modelConfidence: number;
    recommendationConfidence: number;
    fromCache: boolean;
    hardConstraintViolated: boolean;
    factCount?: number;
    uniqueDimCount?: number;
    evidenceSnippetCount?: number;
  }): void {
    this.ops.jobsEvaluated++;
    if (opts.fromCache) this.ops.cacheHits++;
    if (opts.hardConstraintViolated) this.ops.hardConstraintViolations++;

    if (opts.decision === "Excellent") this.ops.excellent++;
    else if (opts.decision === "Good") this.ops.good++;
    else if (opts.decision === "Average") this.ops.average++;
    else if (opts.decision === "Weak Fit") this.ops.weakFit++;
    else if (opts.decision === "Needs More Evidence") this.ops.insufficientEvidence++;

    this.scores.push(opts.score);
    this.dataConfidences.push(opts.dataConfidence);
    this.modelConfidences.push(opts.modelConfidence);
    this.recommendationConfidences.push(opts.recommendationConfidence);
    this.factCounts.push(opts.factCount ?? 0);
    this.uniqueDimCounts.push(opts.uniqueDimCount ?? 0);
    this.evidenceSnippetCounts.push(opts.evidenceSnippetCount ?? 0);
  }

  getOperationalMetrics(): OperationalMetrics {
    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    return {
      ...this.ops,
      averageScore: avg(this.scores),
      averageDataConfidence: avg(this.dataConfidences),
      averageModelConfidence: avg(this.modelConfidences),
      averageRecommendationConfidence: avg(this.recommendationConfidences),
      latencyMs: Date.now() - this.startTime,
      avgFacts: avg(this.factCounts),
      avgUniqueDims: avg(this.uniqueDimCounts),
      avgEvidenceSnippets: avg(this.evidenceSnippetCounts),
    };
  }

  /**
   * Formats the operational dashboard for CLI output.
   */
  formatDashboard(): string {
    const m = this.getOperationalMetrics();
    const line = "=".repeat(60);

    return [
      line,
      "         RECOMMENDATION ENGINE DASHBOARD",
      line,
      "RESULTS",
      `  Jobs Evaluated:         ${m.jobsEvaluated}`,
      `  Cache Hits:             ${m.cacheHits}  (${m.jobsEvaluated > 0 ? Math.round(m.cacheHits / m.jobsEvaluated * 100) : 0}%)`,
      `  Excellent Fit:          ${m.excellent}`,
      `  Good Fit:               ${m.good}`,
      `  Average Fit:            ${m.average}`,
      `  Weak Fit:               ${m.weakFit}`,
      `  Needs More Evidence:    ${m.insufficientEvidence}`,
      `  Constraint Fails:       ${m.hardConstraintViolations}`,
      "",
      "SCORES & CONFIDENCE",
      `  Average Fit Score:          ${m.averageScore}%`,
      `  Avg Data Confidence:        ${m.averageDataConfidence}%`,
      `  Avg Model Confidence:       ${m.averageModelConfidence}%`,
      `  Avg Recommendation Conf:    ${m.averageRecommendationConfidence}%`,
      "",
      "EVIDENCE DENSITY",
      `  Avg Facts / Job:            ${m.avgFacts}`,
      `  Avg Unique Dimensions / Job: ${m.avgUniqueDims}`,
      `  Avg Evidence Snippets / Job: ${m.avgEvidenceSnippets}`,
      "",
      "PERFORMANCE",
      `  Total Latency:   ${m.latencyMs}ms`,
      `  Per Job:         ${m.jobsEvaluated > 0 ? Math.round(m.latencyMs / m.jobsEvaluated) : 0}ms`,
      line,
    ].join("\n");
  }
}
