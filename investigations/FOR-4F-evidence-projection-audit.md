# FOR-4F Evidence & Dimension Projection Audit

## 1. Dimension Score Persistence
- In `materialized_evaluations.evaluation_json`, `record.dimensions` contains qualitative narrative nodes, but the numerical object `record.dimensionScores` is omitted during worker serialization.
- **Impact**: UI cards fallback to client-side heuristic parsing rather than reading direct persisted dimension scores.
