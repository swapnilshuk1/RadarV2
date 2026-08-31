# FOR-4E Prioritized Action Plan (Investigation Only — No Remediation Executed)

## P0 — Must Resolve Before Trusting Metrics
1. **Fix Enum Check in `SqliteCanonicalServingStore.getExecutiveMetrics`**:
   - Update `"ENGINE_PURSUIT"` $\to$ `"ENGINE_PURSUE"`, `"USER_CONFIRMED"` $\to$ `"EXPLICIT_PURSUE"`, `"PREFERENCE_OVERRIDE"` $\to$ `"EXPLICIT_CONSIDER"`.
   - Re-syncs header metric counts with live Turso database truth.

## P1 — Important Model & Persistence Enhancements
2. **Preserve Continuous Intrinsic Score on `PASS` Evaluations**:
   - Store actual calculated Model C score in `materialized_evaluations.quality_score` while retaining `decision = 'PASS'`.
3. **Calibrate Scoring Model Fallback Priors**:
   - Evaluate whether fallback priors for missing salary/growth should be raised or dynamic to allow 90+ scores for top executive roles.

## P2 — UI & Presentation Refinements
4. **Serialize Granular `dimensionScores` in `EvaluationWorker`**:
   - Pass dimension score breakdowns to enable full dimensional radar rendering on cards.
5. **Clarify UI Metric Ribbon Labels**:
   - Distinguish "Actionable Shortlist Queue (82)" from "Total Evaluated Fit (102)" and "Executive Pursuits (330)".

## NO ACTION — Verified Correct System Invariants
- Historical decisions (1,498 user choices) remain 100% clean and intact.
- SPARSE_SPEC isolation (639 low-text jobs) correctly quarantined from executive queue.
- Zero orphan candidates or orphan decisions in Turso database.
