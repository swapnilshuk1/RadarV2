# GATE_1B_BATCH_06 — Scope Revision 3: Pre-Adjudication Contract & Tooling Repair

**Gate**: GATE 1B (Substrate, Provenance, and Extraction Architecture Decision)  
**Batch**: GATE_1B_BATCH_06 (Extraction Architecture Implementation & Blind Pre-Certification)  
**Scope Revision**: 3  
**Status**: ACTIVE  
**Date**: September 14, 2026  

---

## 1. Directive & Invariant Boundary

> **MANDATORY INVARIANT**:  
> No blind model execution and no change to the selected architecture class. This revision repairs implementation, evaluator, truth-schema, and governance contracts only.

Prior to releasing blind evaluation packets to external human reviewers, Scope Revision 3 establishes eight mandatory contract and tooling repairs across the extraction pipeline, evaluator, truth schemas, and adjudication tooling.

---

## 2. Eight Governed Contract & Tooling Repairs

### Repair 1: Taxonomy & Semantic Verifier Frozen to 9 Canonical Families
- **Code Location**: src/lib/intelligence/extraction/HighRiskSemanticVerifier.ts
- **Specification**:
  - The high-risk taxonomy is permanently frozen to exactly 9 canonical families:
    1. REPORTING_LINE
    2. FOUNDER_CEO_PROXIMITY
    3. BOARD_EXPOSURE
    4. PNL_OWNERSHIP
    5. REVENUE_ACCOUNTABILITY
    6. PROFITABILITY_ACCOUNTABILITY
    7. DECISION_AUTHORITY
    8. PEOPLE_LEADERSHIP
    9. PEOPLE_SCALE
  - Non-canonical alias COMMERCIAL_ACCOUNTABILITY is completely eliminated from the verifier and evaluators.
  - Commercial cue heuristics are strictly narrowed to explicit revenue/commercial keywords (\brevenue target\b|\bquota\b|\barr\b|\bsales target\b|\bnet new arr\b). Generic phrases such as commercial growth remain untyped/insufficient unless explicit financial evidence is grounded.

### Repair 2: Structural Admission Engine Post-Admission UNKNOWN Set
- **Code Location**: src/lib/intelligence/extraction/StructuralAdmissionEngine.ts
- **Specification**:
  - StructuralAdmissionBatchResult explicitly emits:
    `	s
    unknownHighRiskDimensions: readonly HighRiskSemanticFamily[];
    `
  - evaluateBatch() computes this set by diffing the 9 canonical families against admitted verified claims for the document.
  - Silent or missing dimensions are thereby explicitly classified as UNKNOWN rather than leaving Gate 7 to rely on passive omission.

### Repair 3: Mechanical Span Resolution for Role Reference Truth
- **Code Location**: scripts/transition/ingest-batch06-human-truth.ts
- **Specification**:
  - Human adjudicators annotate natural verbatim quotes (sourceEvidenceQuotes).
  - Ingestion tooling invokes esolveEvidenceQuotesToSpanIds() using the frozen MechanicalSourceSegmenter to mechanically map each human quote to overlapping spanId tokens (S001, S002, etc.).
  - Evaluators compare assertions and reference facts by exact span ID element equality, eliminating fuzzy string matching while preserving human quote provenance.

### Repair 4: Canonical Candidate Reference Truth Contract (StructuredMetric[] + plural proofTypes[])
- **Code Location**: udit-reports/gate1b-batch06/annotation/CANDIDATE_REFERENCE_TRUTH_CONTRACT.md, scripts/transition/evaluator-batch06.ts
- **Specification**:
  - Reference truth adopts the canonical candidate extraction schema:
    - metrics: StructuredMetric[] containing exactText, startOffset, endOffset, metricType, awValue, 
ormalizedValue, comparator, currency, scale, and unit.
    - proofTypes: CandidateProofType[] supporting multiple typed claims from the 18 canonical types.
  - Reduced or parallel ad-hoc schemas (metric: string, singular proofType) are rejected for Batch 06 truth. Historical backward compatibility is strictly isolated to fixture replay.

### Repair 5: Exact Chronology Gate 9 Evaluation Formula
- **Code Location**: scripts/transition/evaluator-batch06.ts
- **Specification**:
  - Pre-registered Gate 9 evaluates full chronology binding accuracy across applicable work-history reference claims:
    \text{candidateChronologyBinding} = \frac{\sum \text{applicable claims matching employer AND title AND tenure/isCurrent}}{\sum \text{total applicable work-history claims}}
  - Threshold: $\ge 0.90$ (90.0%).
  - Employer-only binding accuracy is retained strictly as an informational diagnostic.

### Repair 6: Gate 7 Explicit Silent-Dimension Capture Rate
- **Code Location**: scripts/transition/evaluator-batch06.ts
- **Specification**:
  - Pre-registered Gate 7 evaluates explicit abstention / UNKNOWN set classification for declared highRiskSilentDimensions:
    \text{insufficientEvidenceCaptureRate} = \frac{\sum \text{silent dimensions with zero affirmative assertions}}{\sum \text{total declared silent dimensions}}
  - Threshold: $\ge 0.90$ (90.0%).
  - Any affirmative assertion emitted on a declared silent dimension breaches Gate 7 and triggers Gate 1 / Gate 2 safety violations.

### Repair 7: Verifiable Dual-Review Protocol & Independent Review Artifacts
- **Code Location**: udit-reports/gate1b-batch06/annotation/REVIEWER_INSTRUCTIONS.md, scripts/transition/ingest-batch06-human-truth.ts
- **Specification**:
  - Dual human review requires independent physical files:
    - *_REV1.json: Reviewer 1 independent annotation.
    - *_REV2.json: Reviewer 2 independent annotation.
    - *_RECONCILIATION.json: Adjudicated consensus truth with conflict resolutions.
  - Ingestion tooling rejects documents where eviewerId === reviewer2Id or where dual review verification is absent on high-risk boundaries.

### Repair 8: Mechanical Literal Candidate Character Offset Provenance
- **Code Location**: scripts/transition/evaluator-batch06.ts
- **Specification**:
  - Candidate claim provenance is verified by strict literal slice equality:
    `	s
    rawSourceText.slice(c.startOffset, c.endOffset) === (c.exactText ?? ")
 `
 - Zero whitespace normalization (.replace(/\s+/g,  ) eliminated).
 - Zero substring containment fallback (.includes() eliminated).
 - Missing or inverted offsets strictly fail verification and increment offsetVerificationFailures.

---

## 3. Verification & Parity Confirmation

1. **Synthetic Unit Test Suite (scripts/transition/evaluator-batch06.test.ts)**:
 - 15 comprehensive unit tests verifying all contract repairs (span resolution, canonical metrics, plural proof types, Gate 9 chronology formula, Gate 7 silent dimensions, literal provenance, and ingestion rejection rules).
 - Executed via 
px vitest run --config scripts/transition/vitest.evaluator.config.ts: **26 tests passed (100%)**.
2. **Historical Parity (scripts/transition/compare-evaluators-on-historical.ts)**:
 - Verified 100% bit-perfect parity with evaluator-r2.ts across all 5 architectures and 21 historical fixtures.
 - Exactly reproduces the authoritative 5 observed false affirmatives for Arch C 65k with 0 delta.
3. **Compilation**:
 - 
px tsc -p tsconfig.verify.json --noEmit exits cleanly with code 0.

---

## 4. Next Phase: Human Adjudication Release

With the pre-adjudication contracts, schemas, and tooling repaired and verified:
1. Primary blind population manifest (50 roles, 16 candidate resumes) and secondary remediation manifest (25 roles, 8 candidate resumes) are assembled and locked.
2. Reviewer instruction packets, materiality rubrics, and blank templates are staged for human adjudicators.
3. The autonomous agent halts at the human adjudication boundary. Human review proceeds out-of-band.
