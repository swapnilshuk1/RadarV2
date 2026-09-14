# GATE_1B_BATCH_04B — Source-ID Generalization & Candidate Surface Validation

## 1. Batch Identity & Governance Context

- **Gate**: `GATE_1B`
- **Batch ID**: `GATE_1B_BATCH_04B`
- **Title**: `Source-ID generalization & candidate surface validation`
- **Scope Revision**: `1`
- **Status**: `READY`
- **Preceding Batch**: `GATE_1B_BATCH_04` (`COMPLETE`, scope revision 3, all evidence permanently retained under `audit-reports/gate1b-batch04/`)
- **Extraction Architecture Decision**: `OPEN` (not decided; Batch 04B is a bounded empirical validation)
- **Batch 05 Status**: `NOT AUTHORIZED`

---

## 2. Objective & Mandate

Validate whether the frozen conservative source-ID semantic-extraction contract generalizes across diverse role JDs and candidate documents without tuning, while preserving deterministic provenance, full-surface ontology coverage, and high-risk semantic precision.

### Key Governance Principles:
1. **Experimental Provenance Only**: Deterministic `SourceUnit` references (`spanId`) are used as the *frozen interface for this validation*, NOT declared as the final production extraction architecture.
2. **Batch 04 Remains Closed**: Batch 04 evidence remains immutable and sealed. Batch 04 is not reopened.
3. **Batch 05 is NOT AUTHORIZED**: The production extraction architecture decision remains `OPEN`.
4. **Zero Benchmark Tuning**: Prompts, schemas, segmentation rules, and reference labels are locked before execution; no per-case tuning is permitted.

---

## 3. Evaluation Population (11 Documents Inspected, 10 Scored)

The validation inspects **11 documents mechanically**, of which **10 documents contribute to scored validation metrics**, while `FROZEN_ROLE_02` serves strictly as an un-scored development control:

1. **4 Diverse Executive Role JDs** (Scored):
   - Executive roles spanning diverse sectors (Tech, Industrial, Real Estate, Finance) and document layouts (clean Markdown, glued text, sparse).
2. **4 Adversarial Role JDs** (Scored):
   - Boundary stress cases: (1) Explicit negation disclaimer ("Own budget, NOT company P&L"), (2) Advisory interaction vs. Direct reporting ("Works closely with CEO"), (3) Future aspirational target vs. Current scale, (4) Preferred qualification with mandatory exception.
3. **2 Candidate Resumes** (Scored):
   - Distinct executive candidate documents featuring multi-position work histories, dense metrics, self-summary sections, and capability labels.
4. **1 Development Control** (`FROZEN_ROLE_02` — Unscored):
   - Schnell Builders JD from the diagnostic spike, used strictly as an un-scored regression check. Disqualified from generalization metrics.

---

## 4. Execution Sequence

```text
Phase 1 — Governance Authorization
Phase 2 — Freeze Validation Population (8 role + 2 candidate + 1 dev control, exact source hashes)
Phase 3 — Offline Segmentation Review (inspect all 11 documents mechanically, freeze source-segmentation/v1)
Phase 4 — Freeze Reference Truth (role + candidate labels, positive/negative boundaries, reviewer provenance)
Phase 5 — Implement Experimental Source-ID Harness (wire adapter, source-unit registry, ID assembler)
Phase 6 — One Locked Provider Execution per Scored Fixture (+ development control)
Phase 7 — Evaluation and Report (selection + classification metrics, case-level failures, telemetry)
Phase 8 — Governance Closure (acknowledge commits, close 04B, decision remains OPEN, Batch 05 NOT AUTHORIZED)
```

---

## 5. Frozen Experimental Parameters

- **Model**: `gemini-2.5-flash` in `us-central1` via Application Default Credentials (ADC).
- **Thinking**: Default/dynamic thinking is frozen as the conservative validation baseline; no optimal thinking configuration has been established.
- **Generation Settings**: `temperature: 0`, `topP: 1`.
- **Wire Schema Adapter**: Automatic mapping of canonical `const: "..."` to `enum: ["..."]` for Vertex `responseJsonSchema`.
- **Prompt**: Frozen conservative instruction based on Attempt 3 of the diagnostic spike.
- **Evidence Reference**: Model outputs `spanId` only; RADAR mechanically resolves source characters, offsets, and provenance.

---

## 6. Evaluation Framework & Acceptance Criteria

1. **Separation of Selection from Classification**:
   - Source-reference validity (fraction of valid `spanId`s).
   - Proposal semantic precision (fraction of valid proposals correctly typed).
   - **Material proposition selection recall** (fraction of gold facts whose source unit was selected).
   - Typed material recall (fraction of gold facts recovered with exact type and subject).
   - Subject / evidence-class accuracy.
2. **High-Risk Semantic Families**:
   - Zero tolerance for false positives in: `REPORTING_LINE`, `FOUNDER_CEO_PROXIMITY`, `PNL_OWNERSHIP`, `DECISION_AUTHORITY`, people authority/scale (`PEOPLE_LEADERSHIP`, `PEOPLE_SCALE`), and `BOARD_EXPOSURE`.
3. **Candidate Proof Surface**:
   - Full 18-type CandidateProof ontology.
   - Separation of `WORK_HISTORY` vs. `SELF_SUMMARY` vs. `CAPABILITY_LABEL`.
   - Exact metric retention (magnitude and currency).
   - No cross-position or cross-resume synthesis.
   - Architectural separation: "Owned an $8M fee book" $\to$ `OWNERSHIP` + `FINANCIAL_SCOPE`; relationship to role-side `PNL_OWNERSHIP` belongs downstream in the Evidence Graph.
4. **Case-Level Failure Visibility**:
   - Any high-risk false positive on an adversarial boundary constitutes a validation failure.
   - An isolated false positive on a non-adversarial real JD is retained and analyzed as an architecture-significant failure rather than mechanically collapsing the entire run into "invalid."
