# FOR-4F Score Lineage Forensic Analysis

## 1. Score Pipeline Trace
1. **Raw JD Text** $\to$ `JobProjectionBuilder.build(raw)` extracts structured evidence.
2. If text $<25$ words $\to$ `EvidenceGate` yields `SPARSE_SPEC` (Score = `null`).
3. Otherwise, 3 assessment engines evaluate fit:
   - `CareerAssessmentEngine` (Trajectory fit, baseline 80)
   - `CapabilityAssessmentEngine` (Skills match $0 - 100$)
   - `OpportunityAssessmentEngine` (Comp & Growth fit, fallback 80)
4. `QualityScoreCalculator.calculate` weights them:
   $$\text{Score} = (0.4615 \times \text{Career}) + (0.2308 \times \text{Capability}) + (0.3077 \times \text{Opportunity})$$
5. `DecisionPolicyEngine.evaluate` triggers exclusion gates:
   - If hard veto triggers $\to$ `decision = 'PASS'`.
6. `EvaluationWorker.ts` writes to `materialized_evaluations`:
   - If `PASS` $\to$ sets `quality_score = 0` (in 2,229 records).
   - If `PURSUE` / `CONSIDER` $\to$ preserves calculated continuous score ($52 - 83$).
