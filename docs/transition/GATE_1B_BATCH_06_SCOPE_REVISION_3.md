# GATE_1B_BATCH_06 — Scope Revision 3: Pre-Adjudication Contract & Tooling Repair

**Gate**: GATE 1B (Substrate, Provenance, and Extraction Architecture Decision)  
**Batch**: GATE_1B_BATCH_06 (Extraction Architecture Implementation & Blind Pre-Certification)  
**Scope Revision**: 3  
**Status**: ACTIVE  
**Date**: September 14, 2026  
**Remote Head**: `70f3009f2412201ae956ca6539e1e56d190bc1e2`  

---

## 1. Directive & Invariant Boundary

> **MANDATORY INVARIANT**:  
> No blind model execution and no change to the selected architecture class. This revision repairs implementation, evaluator, truth-schema, and governance contracts only.

Prior to releasing blind evaluation packets to external human reviewers, Scope Revision 3 establishes eight mandatory contract and tooling repairs across the extraction pipeline, evaluator, truth schemas, and adjudication tooling.

---

## 2. Eight Governed Contract & Tooling Repairs

### Repair 1: Taxonomy & Semantic Verifier Frozen to 9 Canonical Families
- **Code Location**: `src/lib/intelligence/extraction/HighRiskSemanticVerifier.ts`
- **Specification**:
  - The high-risk taxonomy is permanently frozen to exactly 9 canonical families:
    1. `REPORTING_LINE`
    2. `FOUNDER_CEO_PROXIMITY`
    3. `BOARD_EXPOSURE`
    4. `PNL_OWNERSHIP`
    5. `REVENUE_ACCOUNTABILITY`
    6. `PROFITABILITY_ACCOUNTABILITY`
    7. `DECISION_AUTHORITY`
    8. `PEOPLE_LEADERSHIP`
    9. `PEOPLE_SCALE`
  - Non-canonical alias `COMMERCIAL_ACCOUNTABILITY` is completely eliminated from the verifier and evaluators.
  - Commercial cue heuristics are strictly narrowed to explicit revenue/commercial keywords (`\brevenue target\b|\bquota\b|\barr\b|\bsales target\b|\bnet new arr\b`). Generic phrases such as "commercial growth" remain untyped/insufficient unless explicit financial evidence is grounded.

### Repair 2: Structural Admission Engine Post-Admission UNKNOWN Set & Semantics
- **Code Location**: `src/lib/intelligence/extraction/StructuralAdmissionEngine.ts`, `src/lib/intelligence/extraction/AsymmetricHybridRoleExtractor.ts`
- **Specification**:
  - `StructuralAdmissionBatchResult` and `HybridRoleExtractionResult` explicitly emit:
    ```ts
    readonly unknownHighRiskDimensions: readonly HighRiskSemanticFamily[];
    ```
  - `evaluateBatch()` computes this set by diffing the 9 canonical families against covered families. Covered families include:
    - Admitted affirmative facts (`ADMITTED_AFFIRMATIVE`)
    - Admitted negative boundaries (`ADMITTED_BOUNDARY_ONLY`), extracting the target high-risk family from the proposition or verification result (negated P&L is classified as a boundary, NOT unknown)
    - Admitted conditional facts (`ADMITTED_CONDITIONAL`)
  - Silent or missing dimensions are thereby explicitly classified as `UNKNOWN` rather than leaving Gate 7 to rely on passive omission.

### Repair 3: Mechanical Span Resolution for Role Reference Truth & Duplicate Disambiguation
- **Code Location**: `scripts/transition/ingest-batch06-human-truth.ts`
- **Specification**:
  - Human adjudicators annotate natural verbatim quotes (`sourceEvidence`).
  - Ingestion tooling invokes `resolveEvidenceQuotesToSpanIds()` using the frozen `MechanicalSourceSegmenter` to mechanically map each human quote to overlapping `spanId` tokens (`S001`, `S002`, etc.).
  - Evaluators compare assertions and reference facts by exact span ID element equality, eliminating fuzzy string matching while preserving human quote provenance.
  - Duplicate quotes appearing multiple times in the raw source text strictly require explicit character offsets: `{ exactText: string, startOffset: number, endOffset: number }`. Ambiguous duplicate quotes without explicit offsets fail ingestion validation.

### Repair 4: Canonical Candidate Reference Truth Contract (StructuredMetric[] + plural proofTypes[])
- **Code Location**: `audit-reports/gate1b-batch06/annotation/CANDIDATE_REFERENCE_TRUTH_CONTRACT.md`, `scripts/transition/evaluator-batch06.ts`
- **Specification**:
  - Reference truth adopts the canonical candidate extraction schema:
    - `metrics: StructuredMetric[]` containing `exactText`, `startOffset`, `endOffset`, `metricType`, `rawValue`, `normalizedValue`, `comparator`, `currency`, `scale`, and `unit`.
    - `proofTypes: CandidateProofType[]` supporting multiple typed claims from the 18 canonical types.
  - Reduced or parallel ad-hoc schemas (`metric: string`, singular `proofType`) are rejected for Batch 06 truth. Historical backward compatibility is strictly isolated to fixture replay.

### Repair 5: Exact Chronology Gate 9 Evaluation Formula & Normalized Exact Equality
- **Code Location**: `scripts/transition/evaluator-batch06.ts`
- **Specification**:
  - Pre-registered Gate 9 evaluates full chronology binding accuracy across applicable work-history reference claims:
    $$\text{candidateChronologyBinding} = \frac{\sum \text{applicable claims matching employer AND title AND tenure/isCurrent}}{\sum \text{total applicable work-history claims}}$$
  - Threshold: $\ge 0.90$ (90.0%).
  - Chronology comparison enforces normalized exact equality (trim, lowercase, whitespace collapse) across `employer`, `title`, `startDate`, `endDate`, and boolean equality for `isCurrent`. Bidirectional substring matching (`.includes()`) is eliminated as a certification criterion.
  - Employer-only binding accuracy is retained strictly as an informational diagnostic.

### Repair 6: Gate 7 Explicit Silent-Dimension Capture Rate from Document Aggregation
- **Code Location**: `scripts/transition/evaluator-batch06.ts`
- **Specification**:
  - Pre-registered Gate 7 evaluates explicit abstention / UNKNOWN set classification for declared `highRiskSilentDimensions`:
    $$\text{insufficientEvidenceCaptureRate} = \frac{\sum \text{silent dimensions with zero affirmative assertions}}{\sum \text{total declared silent dimensions}}$$
  - Threshold: $\ge 0.90$ (90.0%).
  - Gate 7 is derived strictly from document-level aggregations (`docSilentTotal` and `docSilentCaptured`). External caller overrides have been removed.
  - Any affirmative assertion emitted on a declared silent dimension breaches Gate 7 and triggers Gate 1 / Gate 2 safety violations.

### Repair 7: Verifiable Dual-Review Triplet & Authoritative Complete Reconciliation Truth
- **Code Location**: `audit-reports/gate1b-batch06/annotation/REVIEWER_INSTRUCTIONS.md`, `scripts/transition/ingest-batch06-human-truth.ts`
- **Specification**:
  - Dual human review requires independent physical files:
    - `*_REV1.json`: Reviewer 1 independent annotation.
    - `*_REV2.json`: Reviewer 2 independent annotation.
    - `*_RECONCILIATION.json`: Complete final authoritative annotation + provenance/mapping back to REV1/REV2 + resolution for disagreements.
  - Ingestion tooling compiles ONLY the complete reconciliation document and cryptographically verifies that `*_REV1.json` and `*_REV2.json` exist, their SHA-256 hashes match, and `reviewer1Id !== reviewer2Id`.
  - Non-triplet JSON files are rejected, preventing document triple-counting.

### Repair 8: Mechanical Literal Candidate Character Offset Provenance & Span Containment
- **Code Location**: `scripts/transition/evaluator-batch06.ts`
- **Specification**:
  - Candidate claim provenance is verified by strict literal slice equality:
    ```ts
    rawSourceText.slice(c.startOffset, c.endOffset) === (c.exactText ?? "");
    ```
  - Zero whitespace normalization (`.replace(/\s+/g, " ")` eliminated).
  - Zero substring containment fallback (`.includes()` eliminated).
  - Missing or inverted offsets strictly fail verification and increment `offsetVerificationFailures`.
  - Candidate reference claim matching utilizes grounded source ranges / span containment (`c.startOffset >= rf.startOffset && c.endOffset <= rf.endOffset` or reciprocal containment/overlap), disambiguating identical text by offsets.

---

## 3. Verification & Parity Confirmation

1. **Synthetic Unit Test Suite (`scripts/transition/evaluator-batch06.test.ts`, `hybrid-role-extractor.test.ts`)**:
   - Comprehensive unit tests verifying all contract repairs (span resolution, canonical metrics, plural proof types, Gate 9 chronology formula, Gate 7 silent dimensions, literal provenance, and ingestion rejection rules).
   - Executed via `npx vitest run --config scripts/transition/vitest.evaluator.config.ts`.
2. **Historical Parity (`scripts/transition/compare-evaluators-on-historical.ts`)**:
   - Verified 100% bit-perfect parity with `evaluator-r2.ts` across all 5 architectures and 21 historical fixtures.
   - Exactly reproduces the authoritative 5 observed false affirmatives for Arch C 65k with 0 delta.
3. **Compilation**:
   - `npx tsc -p tsconfig.verify.json --noEmit` exits cleanly with code 0.

---

## 4. Next Phase: Human Adjudication Release

With the pre-adjudication contracts, schemas, and tooling repaired and verified:
1. Primary blind population manifest (50 roles, 16 candidate resumes) and secondary remediation manifest (25 roles, 8 candidate resumes) are assembled and locked.
2. Reviewer instruction packets, materiality rubrics, and blank templates are staged for human adjudicators.
3. The autonomous agent halts at the human adjudication boundary. Human review proceeds out-of-band.
