# GATE_1B_BATCH_05 — Architecture Decision Record

**Gate**: GATE 1B (Substrate, Provenance, and Extraction Architecture Decision)  
**Batch**: GATE_1B_BATCH_05 (Extraction Architecture Decision & Acceptance Contract)  
**Status**: COMPLETE / FROZEN  
**Decision Status**: `EXTRACTION_ARCHITECTURE = DECIDED`  
**Implementation Status**: `NOT YET PRODUCTION-CERTIFIED`  

---

## 1. Governing Principle & Confidence Ladder

> **"No further architecture experimentation is needed before implementation. The architecture is reopened only if pre-registered certification evidence falsifies a core architectural assumption."**

### Confidence Ladder
$$\text{Architecture Selected} \longrightarrow \text{Implementation Frozen} \longrightarrow \text{Blind Offline Validated} \longrightarrow \text{Shadow-Mode Validated} \longrightarrow \text{Production Certified} \longrightarrow \text{Periodic / Signal Re-certification}$$

RADAR has completed extensive multi-phase empirical evaluations across 21 role documents and 2 candidate documents (documented in the authoritative transition closure records: `docs/transition/GATE_1B_BATCH_04_CLOSURE.md`, `docs/transition/GATE_1B_BATCH_04B_CLOSURE.md`, and `docs/transition/GATE_1B_BATCH_04C_CLOSURE.md`, with complete raw benchmark runs preserved in the local evaluation workspace). 

The accumulated evidence is conclusive. Architectural exploration is closed.

---

## 2. Selected Role Extraction Architecture

### Architectural Identity & Model Neutrality
The selected role extraction architecture is strictly **provider- and model-neutral**. It is defined by its semantic contract, pipeline dataflow, and structural boundaries. Specific foundation models (e.g., Gemini 2.5 Flash with 65k output capacity) serve as the **candidate model implementation** to be implemented and certified in Batch 06, while the architectural invariants reside in the five-layer semantic contract.

### Pipeline Specification

$$\text{Deterministic Provenance} \longrightarrow \text{Rich Grounded Semantic Propositions} \longrightarrow \text{High-Risk Semantic Verifier} \longrightarrow \text{Structural Admission} \longrightarrow \text{Deterministic Canonical Projection} \longrightarrow \text{RoleIntelligence}$$

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 1. DETERMINISTIC SOURCE & PROVENANCE LAYER                                      │
│    - Owns: Source identity, SHA-256 hash, immutable source text,                │
│            deterministic segmentation, span IDs, exact text, offsets.           │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2. RICH GROUNDED SEMANTIC PROPOSITION LAYER (Large-Context Extraction Engine)   │
│    - Owns: Sentence/clause decomposition, semantic interpretation,              │
│            applicability (ROLE, CANDIDATE_REQUIREMENT, CANDIDATE_PREFERENCE,     │
│            COMPANY, RECRUITING_PROCESS), polarity (AFFIRMED, NEGATED,           │
│            CONDITIONAL), condition description, canonical type candidates,      │
│            multi-span grounding, unmapped material concepts.                    │
│    - Implementation Note: Batch 06 candidate model instance: Gemini 2.5 Flash   │
│      with calibrated 65k output capacity.                                       │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 3. HIGH-RISK SEMANTIC VERIFIER LAYER                                            │
│    - Owns: Evaluating whether a proposed high-risk semantic claim is entailed    │
│            by its cited source evidence spans.                                  │
│    - Tri-state Result:                                                          │
│        • ENTAILED     → Proceeds toward affirmative admission.                  │
│        • CONTRADICTED → Preserved as negative/boundary constraint; NEVER         │
│                         admitted as affirmative canonical truth.                │
│        • INSUFFICIENT → Preserved as explicit UNKNOWN; NEVER affirmative.       │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 4. STRUCTURAL ADMISSION LAYER                                                   │
│    - Owns: Deterministic type, subject, and boundary compatibility rules.       │
│    - Enforces that true propositions are only admitted into valid targets:      │
│        • CANDIDATE_REQUIREMENT cannot project into ROLE authority fields.       │
│        • CANDIDATE_PREFERENCE cannot become a ROLE fact.                        │
│        • COMPANY context cannot become ROLE authority.                          │
│        • RECRUITING_PROCESS cannot become ROLE authority.                       │
│        • NEGATED propositions cannot become affirmative canonical truth         │
│          (routed to negative boundaries / veto constraints).                    │
│        • CONDITIONAL propositions cannot silently become unconditional.         │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 5. DETERMINISTIC CANONICAL PROJECTION LAYER                                     │
│    - Owns: Schema validation, 25-type ontology validation, deduplication,       │
│            normalization, fail-closed assembly, canonical RoleIntelligence      │
│            artifact creation.                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Role Ontology Decision

- **Retain all 25 canonical `RoleSemanticTypes`**:
  `ROLE_PURPOSE`, `RESPONSIBILITY`, `OUTCOME`, `SUCCESS_METRIC`, `HARD_REQUIREMENT`, `PREFERRED_REQUIREMENT`, `REPORTING_LINE`, `FOUNDER_CEO_PROXIMITY`, `BOARD_EXPOSURE`, `PNL_OWNERSHIP`, `REVENUE_ACCOUNTABILITY`, `PROFITABILITY_ACCOUNTABILITY`, `BUDGET_SCOPE`, `DECISION_AUTHORITY`, `PEOPLE_LEADERSHIP`, `PEOPLE_SCALE`, `GREENFIELD_BUILD`, `TRANSFORMATION`, `GEOGRAPHIC_SCOPE`, `REGULATORY_SCOPE`, `PRODUCT_SCOPE`, `CUSTOMER_SCOPE`, `CHANNEL_SCOPE`, `COMPANY_CONTEXT`, `WORK_CONDITION`.
- **Role Ontology Function**: The 25 types are **canonical projection dimensions**, not the entire semantic vocabulary of extraction.
- **Extraction Protocol**: The pipeline is `source → rich semantic proposition → canonical projection`, **never** `source → single canonical ontology label`.
- **Modality & Polarity Invariant**: Negative and conditional propositions are first-class domain facts. They are preserved durably for downstream negative boundary checking and veto logic; they must never simply disappear.

---

## 4. Rejected Role Architectures

1. **Deterministic V1 as Sole Role Semantic Extractor**:
   - *Reason for Rejection*: Fails the recall ceiling. Achieves only 32.4% typed recall (dropping to 22.2% on long documents) and misses 76.9% of high-risk executive facts. Lacks a polarity channel.
2. **Direct Source-ID LLM $\rightarrow$ Canonical Ontology (Architecture B)**:
   - *Reason for Rejection*: Schema lacks polarity and condition channels, emitting 17 unrepresentable facts on negated spans. Forces lossy 1:1 classification without capturing nuances.
3. **Pure LLM Canonical Authority**:
   - *Reason for Rejection*: Unchecked LLM generation permits cross-boundary hallucination, prerequisite leakage, and ungrounded claims. Canonical authority must remain deterministic and verifiable.
4. **Current R2 Structural Architecture-D Gate as a Sufficient Safety Mechanism by Itself**:
   - *Reason for Rejection*: While structural admission retained 90.9% of atoms and filtered prerequisite leakage, it cannot resolve subtle relationship-scope ambiguities (e.g. client/portfolio-company CEO contact vs internal CEO reporting) without an explicit semantic verifier.
5. **Silent Canonical Fallback**:
   - *Invariant*: If the selected role semantic path fails, the system must **NEVER** silently substitute sparse deterministic RoleIntelligence and persist it as equivalent canonical truth. Failure behavior must remain explicit, fail-closed, and retryable.

---

## 5. Candidate Architecture Decision

### Decision: `CANDIDATE_EXTRACTION_ARCHITECTURE = DETERMINISTIC_FOR_CURRENT_TRANSITION`

- **SELECT**: Deterministic `CandidateProof` lineage as the canonical candidate extraction path for the current transition.
- **Deterministic Ownership**:
  - Document structure and section parsing
  - Work-history structure and chronology
  - Employer / title / date binding
  - Position containment hierarchy
  - Source byte/character offsets and exact text provenance
  - Quantitative metric tokens, currencies, and numeric normalization
- **REJECT**: Direct candidate LLM extraction as the canonical replacement.
- **Empirical Grounding & Rationale**: Deterministic `CandidateProof` currently leads the tested direct-LLM alternative and retains stronger structural and provenance guarantees; final production certification remains pending. On the tested reference resumes, it preserved core quantitative anchors and employer bindings without span boundary hallucinations, whereas the direct LLM dropped metrics from multiple claims and severed employer associations.
- **Scope Limit**: Deterministic `CandidateProof` is not claimed to be permanently optimal for all future semantic tasks. Future LLM enrichment remains permitted only as a separately versioned and validated architecture.

---

## 6. Shared Reference Taxonomies

To eliminate competing definitions across documents, the following taxonomies are immutable:

### A. High-Risk Semantic Areas
1. `PNL_OWNERSHIP`
2. `COMMERCIAL_ACCOUNTABILITY` *(Validation umbrella grouping spanning `REVENUE_ACCOUNTABILITY` & `PROFITABILITY_ACCOUNTABILITY`. NOTE: This is strictly a validation taxonomy grouping and NOT a new `RoleSemanticType`; it must NEVER appear in canonical artifacts or schemas).*
3. `REPORTING_LINE`
4. `FOUNDER_CEO_PROXIMITY`
5. `BOARD_EXPOSURE`
6. `DECISION_AUTHORITY`
7. `PEOPLE_LEADERSHIP`
8. `PEOPLE_SCALE`

### B. Structural Boundaries
1. `ROLE` vs `COMPANY`
2. `CANDIDATE_REQUIREMENT` vs `ROLE` (The Prerequisite Wall)
3. `CANDIDATE_PREFERENCE` vs `ROLE`
4. `RECRUITING_PROCESS` vs `ROLE`
5. `NEGATED` vs `AFFIRMED` (Negative Boundary Constraint)
6. `CONDITIONAL` vs `UNCONDITIONAL` (Condition Retention)

### C. Evaluation Error Classes
1. `WRONG_ASSERTION`: Emitted affirmative assertion directly contradicting reference truth or declared high-risk negative boundary.
2. `MISSED_ASSERTION`: Reference truth fact with zero overlapping source span citations in emitted assertions.
3. `WRONG_TYPE`: Source span successfully cited, but assigned an incorrect canonical semantic type.
4. `WRONG_APPLICABILITY`: Subject incorrectly classified (e.g. candidate requirement asserted as role authority).
5. `WRONG_POLARITY`: Explicit polarity contradiction (e.g. negated fact asserted as affirmed).
6. `POLARITY_UNREPRESENTABLE`: Architecture emitted fact covering a negated span, but schema possesses no polarity channel.
7. `APPLICABILITY_UNREPRESENTABLE`: Architecture emitted fact, but schema possesses no subject/applicability channel.

---

## 7. Next Steps & Governance Handoff

- **Batch 05 Responsibility**: Record architecture decision and author Batch 06 Validation Runbook. (COMPLETED).
- **Batch 06 Authorization**: Batch 06 is **NOT AUTHORIZED** by this document. Implementation and certification will take place strictly under a future Batch 06 authorization manifest.
