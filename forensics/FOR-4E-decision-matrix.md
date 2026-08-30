# FOR-4E Forensic Decision & Issue Classification Matrix

| Issue ID | Suspected Issue | Classification | Severity | Evidence | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ISS-01** | `getExecutiveMetrics` Obsolete Enum Check | **PROVEN BUG** | **CRITICAL (P0)** | `SqliteCanonicalServingStore.ts:853` checks V3 enums | FIX SERVING / METRICS |
| **ISS-02** | 83-point Artificial Max Score Ceiling | **PROVEN MATHEMATICAL CONSTRAINT** | **HIGH (P1)** | `QualityScoreCalculator.ts:114` 80-fallback bounds output to 84.6 | DECISION ON MODEL PRIORS |
| **ISS-03** | 2,229 PASS Records Flattened to Score 0 | **PROVEN DATA / PIPELINE BEHAVIOR** | **MEDIUM (P1)** | `EvaluationWorker.ts` writes 0 on PASS | PRESERVE CONTINUOUS SCORE |
| **ISS-04** | Missing `dimensionScores` in Serialized Evaluation | **PROVEN SERIALIZATION OMISSION** | **MEDIUM (P2)** | `record.dimensionScores` undefined in JSON | FIX SERIALIZATION MAPPING |
| **ISS-05** | Home Ribbon "SHORTLISTED" Label Ambiguity | **PROVEN SEMANTIC CONFLATION** | **MEDIUM (P2)** | Conflates 569/102/82 populations | REFINE UI LABELS |
