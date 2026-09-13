# GATE_1B_BATCH_05 — Formal Closure Record

**Gate**: GATE 1B (Substrate, Provenance, and Extraction Architecture Decision)  
**Batch**: GATE_1B_BATCH_05 (Extraction Architecture Decision & Acceptance Contract)  
**Scope Revision**: 1  
**Status**: CLOSED  
**Date**: September 13, 2026  

---

## 1. Executive Summary & Batch Responsibility Fulfillment

Batch 05 was authorized strictly as the **Extraction Architecture Decision & Acceptance Contract** batch. It had zero implementation authority and zero model-rerun mandate.

Its primary governance objectives have been fully satisfied:
1. **Extraction Architecture Decided**:
   - **Role Extraction**: `ASYMMETRIC_HYBRID_RICH_PROPOSITION_VERIFIED` (Layer 1 Deterministic Provenance $\rightarrow$ Layer 2 Rich Grounded Propositions $\rightarrow$ Layer 3 High-Risk Semantic Verifier $\rightarrow$ Layer 4 Structural Admission $\rightarrow$ Layer 5 Canonical Type Projection).
   - **Candidate Extraction**: `DETERMINISTIC_FOR_CURRENT_TRANSITION` (`CandidateProofExtractorV1` remains canonical; direct-LLM rejected due to metric dropping, span hallucinations, and unmoored employer chronology).
   - **Rejected Alternatives**: Pure deterministic-only role semantics; direct LLM $\rightarrow$ closed ontology; pure LLM canonical authority; direct candidate LLM extraction.
   - **Certainty Calibration**: The accumulated evidence is sufficient to select the architecture. Architectural experimentation is closed; production certification remains pending.
2. **Evaluator Provenance Explicitly Resolved**:
   - Reconciled R1 ($18$) vs R2 ($5$) high-risk violations for Architecture C: 13 violations arose from an unconstrained `negativeBoundaries` substring search heuristic in `evaluator-v2.ts` that generated false-positive violations on valid documents mentioning boundary terms. Correcting this in `evaluator-r2.ts` isolated the true count of 5 semantic false affirmative errors.
   - Both minimal evaluator implementations (`evaluator-v2.ts` and `evaluator-r2.ts`) are committed to `scripts/transition/`.
   - Epistemic clarity established: The R1→R2 reconciliation is a reconstruction from retained local Batch 04C/R1/R2 evidence. Batch 06 must establish a newly committed, independently auditable evaluator from the frozen error taxonomy before any blind population is executed.
3. **Acceptance Contract & Validation Runbook Authoritative**:
   - Formally authored `docs/transition/GATE_1B_BATCH_06_VALIDATION_RUNBOOK.md`.
   - Pre-registered quantitative pass/fail thresholds ($0$ high-risk false affirmatives, $0$ polarity inversions, $0$ boundary leaks, $100\%$ candidate span provenance, $\ge 50\%$ typed recall, $\ge 90\%$ candidate metric/chronology accuracy, $\le 15.0$s P95 latency, $\le \$0.04$/doc cost SLO).
   - Pre-registered explicit failure consequence table separating architecture-falsifying from implementation-tunable triggers.
   - Enforced 5-stage chronological truth freezing sequence (sample $\rightarrow$ adjudicate blind $\rightarrow$ dual review $\rightarrow$ SHA-256 hash lock $\rightarrow$ single-pass execution).
4. **Governed Decision Record Established**:
   - Recorded in `docs/transition/GATE_1B_BATCH_05_DECISION_RECORD.md`.

---

## 2. Status Transition

- `GATE_1B_BATCH_05`: **CLOSED**
- `extractionArchitectureDecision`: **DECIDED**
- `GATE_1B_BATCH_06`: **AUTHORIZED** (Single governed program executing Steps 1–5 uninterrupted; Step 6 shadow mode remains a deliberate checkpoint)
