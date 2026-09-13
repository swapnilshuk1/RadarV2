# GATE_1B_BATCH_06 — Scope Revision 2: Blind-Validation Integrity Invariants

**Gate**: GATE 1B (Substrate, Provenance, and Extraction Architecture Decision)  
**Batch**: GATE_1B_BATCH_06 (Extraction Architecture Implementation & Blind Pre-Certification)  
**Scope Revision**: 2  
**Status**: ACTIVE  
**Date**: September 13, 2026  

---

## 1. Rationale & Purpose

Prior to commencing implementation under Batch 06, this Scope Revision 2 establishes five non-negotiable execution invariants to protect the epistemic and empirical integrity of the upcoming blind certification test.

This revision introduces zero production code changes and does not reopen the extraction architecture decision (`DECIDED`). It closes execution-integrity gaps in reference truth authorship, holdout isolation, evaluator immutability, audit path scoping, and failure classification semantics.

---

## 2. Governed Invariants Established in Scope Revision 2

### Invariant 1: Human Truth Ownership & Mandatory Adjudication Boundary
- **Autonomous Agent Prohibition**: The autonomous implementation agent **MUST NOT** author or adjudicate final reference truth fixtures.
- **Agent Role**: The agent is restricted to packaging raw source documents, compiling metadata, and preparing structured annotation schemas and blank review templates.
- **Independent Primary Adjudication**: Primary reference truth must be supplied by an independent human reviewer who has **zero access** to pipeline, model, or extractor outputs.
- **Mandatory Dual Human Review**: Every high-risk semantic assertion (`PNL_OWNERSHIP`, `COMMERCIAL_ACCOUNTABILITY`, `REPORTING_LINE`, `FOUNDER_CEO_PROXIMITY`, `BOARD_EXPOSURE`, `DECISION_AUTHORITY`, `PEOPLE_LEADERSHIP`, `PEOPLE_SCALE`), negative boundary disclaimer, polarity label (`AFFIRMED` vs `NEGATED`), and applicability boundary (`ROLE` vs `CANDIDATE_REQUIREMENT`) must receive an independent second human confirmation.
- **Adjudication Provenance**: Adjudication provenance (reviewer IDs/hashes, timestamps) must be recorded without leaking unnecessary personal data.
- **Mandatory Adjudication Halt**: If the required independent human annotations are unavailable, the agent **MUST STOP** at the adjudication boundary in Step 3 rather than synthesizing or self-authoring "human" reference labels.

### Invariant 2: Two Disjoint Pre-Frozen Holdout Populations (Primary + Secondary)
Before executing the pipeline against any unseen evaluation fixture, two completely disjoint, stratified populations must be assembled, adjudicated, and cryptographically locked:

1. **Primary Certification Set**:
   - $\ge 50$ Role JDs: Stratified across 30 fresh natural JDs and 20 adversarial boundary stress cases across diverse document lengths (<5k, 5k–20k, >20k chars).
   - 15–20 Candidate Resumes: Structurally diverse executive profiles with multi-role tenures, dense quantitative metrics, and non-linear career paths.
   - SHA-256 fixture hashes committed to repository manifests prior to any pipeline run.
2. **Secondary Remediation Holdout Set**:
   - Completely disjoint set of role and candidate documents sampled from identical stratification criteria.
   - Independently adjudicated by human reviewers and dual-reviewed for high-risk constraints under identical blind rules.
   - SHA-256 fixture hashes committed alongside the primary set *before* any pipeline execution occurs.
   - **Sealed Holdout Invariant**: The secondary remediation holdout remains strictly sealed and uninspected unless a pre-registered `IMPLEMENTATION-TUNABLE` failure occurs during Step 5.
3. **No Retesting on Primary**: Under no circumstances may an agent tune prompts or canonical projection rules on the primary set and then re-score the primary set as certification evidence.

### Invariant 3: Historical Evaluator Immutability
- The historical evaluator artifacts:
  - `scripts/transition/evaluator-v2.ts`
  - `scripts/transition/evaluator-r2.ts`
  are permanently sealed, immutable historical evidence representing the Batch 04C/R1/R2 audit baseline.
- Batch 06 must create a new, independently auditable evaluator artifact (e.g., `scripts/transition/evaluator-batch06.ts`) derived directly from the frozen error taxonomy.
- Neither historical evaluator file may be modified.

### Invariant 4: Scope Prefix Alignment & Audit Protection
- Authorized audit output for Batch 06 is strictly confined to:
  ```text
  audit-reports/gate1b-batch06/
  ```
- Mutation of historical audit reports (`audit-reports/gate1b-batch04/`, `gate1b-batch04b/`, `gate1b-batch04c/`) is strictly prohibited. `CURRENT_BATCH.json` allowedPathPrefixes is updated to reflect this exact subpath.

### Invariant 5: Precise Failure Semantics & Non-Conflation
- A zero-tolerance breach (e.g., $>0$ high-risk false affirmatives, polarity inversion, or boundary leak) constitutes a **FATAL SAFETY FAILURE**:
  - Step 5 result: **FAIL**.
  - Immediate halt; zero promotion to shadow mode.
  - Mandatory architecture review before any further work.
- An observed failure does **not** logically or mathematically prove that the entire architecture class (propositions $\rightarrow$ verifier $\rightarrow$ admission $\rightarrow$ projection) is flawed; a defective verifier implementation or suboptimal prompt can fail without disproving the underlying architecture.
- Reopening or replacing the architecture decision occurs only if an architectural review determines that a core architectural assumption, rather than the specific software implementation, has been falsified.

---

## 3. Scope Boundary Summary

- **Implementation Step 1 through 5**: Remains authorized as a unified governed program once human adjudication fixtures are in place.
- **Step 1 Implementation**: **NOT BEGUN** in this revision.
- **Immediate Mandate**: Commit Scope Revision 2, verify transition control, push to remote, and halt for pre-implementation baseline acknowledgment.
