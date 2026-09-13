# GATE_1B_BATCH_04C — Closure Record & Evidence Reconciliation

**Gate**: GATE 1B (Substrate, Provenance, and Extraction Architecture Decision)  
**Batch**: GATE_1B_BATCH_04C (Rich semantic proposition generalization & architecture comparison)  
**Scope Revisions**: Revision 1 (Original 04C), R1 (Capacity Diagnostic), R2 (Comparative Integrity Repair & Hybrid Feasibility)  
**Status**: CLOSED  
**Terminal Extraction Architecture Decision**: EVIDENCE ACCUMULATION COMPLETE — TRANSITIONING TO BATCH 05 DECISION RECORD  

---

## 1. Reconciled Evidence Chain (04C → R1 → R2)

Batch 04C was authorized to evaluate three extraction architectures across a 21-document role population and 2 candidate documents. The execution proceeded through three distinct, rigorously audited phases without rewriting prior artifacts:

### Phase 1: Batch 04C Baseline Execution (8k Capacity)
- **Pre-Holdout Freeze**: Contract, Vertex AI prompt, and JSON schema frozen in `src/lib/intelligence/extraction/RichSemanticPropositionContract.ts` and locked in `audit-reports/gate1b-batch04c/manifests/rich-contract-freeze.json` (SHA-256 verified) before holdout text was inspected.
- **Corpus & Ground Truth**: 21 role documents (R=8, H=8, A=4, DEV=1) and 2 candidate resumes frozen in `audit-reports/gate1b-batch04c/manifests/population-manifest.json`. Independent human reference truth frozen in `audit-reports/gate1b-batch04c/fixtures/reference-truth.json`.
- **Three-Way Comparison**:
  - Architecture A (Deterministic V1): 386 atoms emitted, 32.4% typed recall, 0 observed false affirmatives against controls, but missed 76.9% of high-risk facts.
  - Architecture B (Direct Closed-Ontology Gemini): 644 atoms emitted, 44.6% typed recall, 0 polarity representation (schema lacks polarity channel), resulting in 17 facts emitted on negated spans.
  - Architecture C (Rich Propositions, 8k token limit): 395 propositions emitted, 36.5% typed recall, 5 false affirmative assertions. Suffered severe token-budget truncation on the 12 longest documents (dropping from 35.8 to 8.3 propositions/doc).
- **Artifacts**: Retained in `audit-reports/gate1b-batch04c/`.

### Phase 2: Batch 04C-R1 (Capacity Diagnostic)
- **Investigation**: Re-ran Architecture C with 65,536 output token capacity to test whether token budget truncation caused the observed recall drop on long documents.
- **Finding**: Output expanded from 395 to 1,649 propositions. Overall selected reference recall rose from 41.9% to 63.5%, and typed recall rose from 36.5% to 52.7%. On the 12 longest documents, typed recall rose from 5.6% to 38.9%.
- **Provisional Observations**: Revealed that Architecture C recovers rich executive nuances but requires structural boundary constraints to prevent cross-boundary leakage (e.g. candidate prerequisites leaking into role authority).
- **Artifacts**: Retained in `audit-reports/gate1b-batch04c-r1/`.

### Phase 3: Batch 04C-R2 (Comparative Integrity Repair & Hybrid Feasibility Test)
- **Ontology Verification**: Verified that `RichSemanticPropositionContract.ts` and runtime prompts strictly enforced all **25 canonical RoleSemanticTypes**. The phrase *"15 closed ontology types"* in the R1 report was a documentation typo.
- **Adapter Repair**: Corrected Architecture B adapter to preserve actual subjects (`ROLE`, `COMPANY`, `RECRUITING_PROCESS`) and formally set polarity to `REPRESENTATION_UNAVAILABLE`. Re-scored failures into structural inability vs. incorrect assertion.
- **Retraction of Sparse Precision Claims**: Formally retracted `Candidate Proof Precision = 7/39` and `2/18`. Evaluated exclusively on predeclared and typed reference recall.
- **Architecture D (Hybrid Feasibility Engine)**: Evaluated deterministic structural admission rules on C's 65k propositions offline (zero Gemini calls, zero fixture branching).
  - Retained **1,499 atoms (90.9% retention)** and rejected 150 propositions (139 negated propositions safely held as boundary constraints, 8 cross-boundary candidate/company leakages, 3 unresolvable spans).
  - Achieved **51.4% typed recall** and recovered **19/39 high-risk facts**, proving that structural admission preserves C's recall advantage (+19.0% over A) while enforcing boundary discipline.
- **Artifacts**: Retained in `audit-reports/gate1b-batch04c-r2/`.

---

## 2. Evidence Summary Table Across All Evaluated Architectures

| Metric | Arch A: Deterministic V1 | Arch B: Direct Source-ID | Arch C: Rich Props (8k) | Arch C: Rich Props (65k) | Arch D: Hybrid Feasibility |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Total Emitted Propositions / Atoms** | 386 | 644 | 395 | 1,649 | 1,499 (150 rejected) |
| **Selected Ref Selection Recall (N=74)** | 47.3% (35/74) | 48.6% (36/74) | 41.9% (31/74) | 63.5% (47/74) | 62.2% (46/74) |
| **Selected Ref Typed Recall (N=74)** | 32.4% (24/74) | 44.6% (33/74) | 36.5% (27/74) | 52.7% (39/74) | 51.4% (38/74) |
| **Truncated-12 Typed Recall (N=36)** | 22.2% (8/36) | 30.6% (11/36) | 5.6% (2/36) | 38.9% (14/36) | 38.9% (14/36) |
| **Observed False Affirmative Assertions** | 0 | 0 | 5 | 5 | 5 |
| **Emitted on Negated Ref w/o Polarity** | 2 | 17 | 0 | 0 | 0 |
| **Polarity Unrepresentable (HR Facts)** | 9 / 9 (100%) | 18 / 18 (100%) | 0 / 12 (0%) | 0 / 20 (0%) | 0 / 19 (0%) |
| **High-Risk Facts Recovered (N=39)** | 9 / 39 (23.1%) | 18 / 39 (46.2%) | 12 / 39 (30.8%) | 20 / 39 (51.3%) | 19 / 39 (48.7%) |
| **High-Risk Facts Missed (N=39)** | 30 / 39 (76.9%) | 21 / 39 (53.8%) | 27 / 39 (69.2%) | 19 / 39 (48.7%) | 20 / 39 (51.3%) |

---

## 3. Candidate Extraction Comparison Summary (N=2 Resumes)

- **CandidateProofExtractorV1 (Deterministic)**: Decisively outperformed the direct LLM approach. Retained 39 claims, 100% of numeric metrics (`$250M ARR`, `140-person team`, `ROAS 4.2x`), and perfect employer chronological binding across 7 positions.
- **Batch 04B Direct Source-ID LLM**: Dropped numbers from 4 claims, hallucinated span boundaries, and failed to bind achievements to specific employers.
- **Status**: Candidate extraction remains deterministic for the current transition. Future LLM enrichment requires a separately versioned and validated architecture.

---

## 4. Batch 04C Invariant Verification & Closure

1. **Deterministic Baseline Invariant**: Extraction V1 behavior remained untouched throughout 04C/R1/R2.
2. **Production Extraction Authority**: Remained the existing deterministic baseline during all 04C experiments.
3. **No Unilateral Architecture Promotion**: The decision was kept open until all experimental data was audited and presented.
4. **No Premature Batch 06 Work**: Zero source-fact persistence, zero EvidenceGraph modifications.
5. **Ledger Integrity**: All governed implementation commits (`dc089cd`) were formally acknowledged in `docs/transition/IMPLEMENTATION_LEDGER.json`.

**GATE_1B_BATCH_04C is hereby declared CLOSED.**  
The repository transitions to **GATE_1B_BATCH_05** for the formal extraction architecture decision and validation contract.
