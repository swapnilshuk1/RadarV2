# FOR-4E Zero Score Forensic Analysis (2,229 Zero Scores)

## 1. Cross-Tabulation: Engine Verdict × Score Bucket

| Engine Verdict | Total | Score = 0 | Score > 0 | Score = NULL | Score Range |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PURSUE** | 22 | 0 | 22 | 0 | 65 – 83 |
| **CONSIDER** | 80 | 0 | 80 | 0 | 52 – 64 |
| **PASS** | 2,261 | **2,229** | 32 | 0 | 34 – 80 |
| **SPARSE_SPEC** | 639 | 0 | 0 | **639** | NULL |

## 2. Where is 0 Introduced?
- **Root Cause**: In `EvaluationWorker.ts` and `DecisionPolicyEngine.ts`, whenever an opportunity triggers an exclusion veto or is classified as `PASS`, the pipeline materializes `quality_score = 0` rather than storing the continuous Model C fit score.
- **Impact**: Destroys continuous distribution ranking among non-shortlisted opportunities.
