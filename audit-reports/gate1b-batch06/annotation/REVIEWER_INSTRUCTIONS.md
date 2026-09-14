# GATE 1B BATCH 06 — EXTERNAL HUMAN REVIEWER INSTRUCTIONS

## 1. PURPOSE & GOVERNING PRINCIPLES
This document instructs independent external human adjudicators on annotating reference ground truth for the RADAR v2 Gate 1B Batch 06 Blind Validation.

**CRITICAL INDEPENDENCE RULE**:
Human truth adjudication must be strictly external and independent of the autonomous coding agent. No model outputs, proposed extractions, or candidate architecture inferences are provided to reviewers. Reviewers see only the authentic raw source documents.

---

## 2. POPULATIONS & SEALING SEMANTICS

1. **Primary Certification Population**:
   - 50 Roles (`PRIMARY_ROLE_01` to `PRIMARY_ROLE_50`)
   - 16 Candidate Resumes (`PRIMARY_CANDIDATE_01` to `PRIMARY_CANDIDATE_16`)
2. **Secondary Remediation Holdout**:
   - 25 Roles (`SECONDARY_ROLE_01` to `SECONDARY_ROLE_25`)
   - 8 Candidate Resumes (`SECONDARY_CANDIDATE_01` to `SECONDARY_CANDIDATE_08`)

### Crucial Secondary Holdout Sealing Clarification
Secondary is SEALED FROM:
- implementation agent inspection of completed truth
- model/extractor execution
- tuning
- scoring
until the permitted remediation condition occurs.

Secondary is NOT sealed from independent human adjudicators.

Both Primary and Secondary must be human-annotated, dual-reviewed where required, and cryptographically frozen before the Primary model run.

---

## 3. ROLE ANNOTATION PROTOCOL (`*_BLANK.json`)

For each role document, reviewers must extract discrete reference facts and negative boundaries according to [`ROLE_MATERIALITY_RUBRIC.md`](./ROLE_MATERIALITY_RUBRIC.md).

### A. Fact Record Structure
For each discrete factual statement affirmed or negated in the text:
```json
{
  "id": "fact_01",
  "propositionText": "Owns the $6.5M marketing department operational budget.",
  "sourceEvidence": ["manage an annual marketing program budget of $6,500,000"],
  "canonicalTypes": ["BUDGET_SCOPE"],
  "appliesTo": "ROLE",
  "polarity": "AFFIRMED",
  "materiality": "MATERIAL_SELECTED",
  "highRiskFamily": null
}
```

### B. Controlled Vocabularies
1. **Materiality Class** (Governed by [`ROLE_MATERIALITY_RUBRIC.md`](./ROLE_MATERIALITY_RUBRIC.md)):
   - `MATERIAL_SELECTED`: Facts that materially characterize any of the 9 executive dimensions:
     - role mandate/purpose
     - material responsibilities/outcomes
     - requirements/preferences
     - authority/accountability
     - reporting/governance
     - people scope
     - financial/commercial scope
     - geographic/regulatory/product/customer/channel scope
     - material work conditions
     **Invariant**: Do not select facts based on what the extractor emits or misses. Certification Typed Reference Recall >= 50% must be computed against `MATERIAL_SELECTED` facts.
   - `SUPPORTING_NON_MATERIAL`: Corporate boilerplate, standard office tools, routine administrative perks, generic non-differentiating prose. Recorded for diagnostic reporting only; must not silently replace the historically comparable certification denominator.

2. **Canonical Semantic Types (25 Canonical Types Strictly)**:
   `ROLE_PURPOSE`, `RESPONSIBILITY`, `OUTCOME`, `SUCCESS_METRIC`, `HARD_REQUIREMENT`, `PREFERRED_REQUIREMENT`, `REPORTING_LINE`, `FOUNDER_CEO_PROXIMITY`, `BOARD_EXPOSURE`, `PNL_OWNERSHIP`, `REVENUE_ACCOUNTABILITY`, `PROFITABILITY_ACCOUNTABILITY`, `BUDGET_SCOPE`, `DECISION_AUTHORITY`, `PEOPLE_LEADERSHIP`, `PEOPLE_SCALE`, `GREENFIELD_BUILD`, `TRANSFORMATION`, `GEOGRAPHIC_SCOPE`, `REGULATORY_SCOPE`, `PRODUCT_SCOPE`, `CUSTOMER_SCOPE`, `CHANNEL_SCOPE`, `COMPANY_CONTEXT`, `WORK_CONDITION`.

3. **Applicability Domain**:
   - `ROLE`: Direct mandate, authority, or condition of the hiring position.
   - `CANDIDATE_REQUIREMENT`: Mandatory prerequisite qualifications the applicant must possess.
   - `CANDIDATE_PREFERENCE`: Preferred, optional qualifications.
   - `COMPANY`: Context about the hiring company (e.g. employee count, funding, revenue).
   - `RECRUITING_PROCESS`: Interview steps, assessment protocols, background checks.

4. **Polarity**:
   - `AFFIRMED`: Stated as true and in-scope for the position.
   - `NEGATED`: Explicitly excluded, prohibited, or stated as not in scope (e.g., "no direct reports", "does not manage P&L").
   - `CONDITIONAL`: Contingent upon an explicit external dependency (e.g., "subject to Board approval", "requires CFO sign-off").

5. **High-Risk Negative Boundaries (`highRiskNegatives`)**:
   Enumerate any of the 9 canonical high-risk families that are explicitly absent or contradicted in the JD:
   - `REPORTING_LINE`, `FOUNDER_CEO_PROXIMITY`, `BOARD_EXPOSURE`, `PNL_OWNERSHIP`, `REVENUE_ACCOUNTABILITY`, `PROFITABILITY_ACCOUNTABILITY`, `DECISION_AUTHORITY`, `PEOPLE_LEADERSHIP`, `PEOPLE_SCALE`.

---

## 4. CANDIDATE RESUME ANNOTATION PROTOCOL (`*_BLANK.json`)

Reviewers must extract candidate career milestones and executive proof points strictly adhering to [`CANDIDATE_REFERENCE_TRUTH_CONTRACT.md`](./CANDIDATE_REFERENCE_TRUTH_CONTRACT.md), aligning 1:1 with the canonical `CandidateProofClaim` contract from `CandidateProofExtractorV1.ts`.

### A. Proof Claim Record Structure
```json
{
  "id": "cand_fact_01",
  "title": "Chief Technology Officer",
  "employer": "CloudScale Technologies",
  "startDate": "2021-01",
  "endDate": null,
  "isCurrent": true,
  "proofTypes": ["PEOPLE_SCOPE"],
  "evidenceClass": "WORK_HISTORY",
  "exactText": "Directed global engineering and infrastructure org of 420 engineers across Bengaluru, Pune, and Seattle.",
  "startOffset": 1240,
  "endOffset": 1345,
  "metrics": [
    {
      "exactText": "420 engineers",
      "startOffset": 1297,
      "endOffset": 1310,
      "metricType": "COUNT",
      "rawValue": "420",
      "normalizedValue": 420,
      "comparator": "EXACT",
      "unit": "engineers"
    }
  ]
}
```

### B. Controlled Candidate Vocabularies
1. **Candidate Proof Types (18 Canonical Types strictly from `CandidateProofExtractorV1.ts`)**:
   `OUTCOME`, `OWNERSHIP`, `FINANCIAL_SCOPE`, `PEOPLE_SCOPE`, `GEOGRAPHIC_SCOPE`, `ORGANIZATION_BUILD`, `TRANSFORMATION`, `MANDATE`, `PRODUCT_LAUNCH`, `CUSTOMER_GROWTH`, `REVENUE_GROWTH`, `COST_EFFICIENCY`, `PIPELINE_GENERATION`, `TECHNOLOGY_IMPLEMENTATION`, `PARTNERSHIP`, `STAKEHOLDER_LEADERSHIP`, `DOMAIN_PRECEDENT`, `CAPABILITY_LABEL`.

2. **Candidate Evidence Classes (3 Canonical Classes strictly from `CandidateProofExtractorV1.ts`)**:
   - `WORK_HISTORY`: Bullet-level accomplishments or responsibilities tied directly to an employer tenure.
   - `SELF_SUMMARY`: High-level executive profile or career summary assertions preceding work history.
   - `CAPABILITY_LABEL`: Skills, certifications, or tool competencies listed in standalone lists.

### C. Candidate Scoring Rules & Invariants
1. **Exact-Text / Source-Span Invariant**: `exactText` must match character-for-character as an exact substring of the resume text, with exact `startOffset` and `endOffset` satisfying `sourceText.slice(startOffset, endOffset) === exactText`. Hallucinated or loosely paraphrased spans fail Gate 4 (`candidateSpanProvenanceMin: 1.0`).
2. **Chronology Gate 9 Invariant**: Evaluates exact work-history binding:
   chronologyBindingAccuracy = (work-history reference claims with correct employer AND title AND tenure/current-status) / (all applicable work-history reference claims).
   Evaluated by Gate 9 (`candidateChronologyBindingMin: 0.90`). Employer-only binding is evaluated as a secondary diagnostic.
3. **Position / Title Binding**: Each claim must bind to the specific executive title held during that tenure.
4. **Date / Tenure Binding**: Each claim must bind to verified employment dates (`startDate`, `endDate`) in `YYYY-MM` or `YYYY` format.
5. **Metric Fidelity (Gate 8)**: Canonical `StructuredMetric` records preserve numerical values, currencies, units, and comparators. Evaluated by Gate 8 (`candidateMetricFidelityMin: 0.90`).
6. **Current-Role Status**: Correctly identify whether the role is active (`isCurrent: true`) or historical (`false`).
7. **Zero Cross-Position Leakage**: Attributing accomplishments achieved at Position A to Position B is a fatal contamination error.
8. **Zero Cross-Document Leakage**: Candidate claims must never reference facts from other candidate resumes or job postings.

---

## 5. DUAL HUMAN CONFIRMATION & ARTIFACT PROTOCOL

1. **Independent Review Artifacts**:
   - Reviewer 1 annotates `*_REV1.json`.
   - Reviewer 2 annotates `*_REV2.json` independently.
2. **Reconciliation Record (`*_RECONCILIATION.json`)**:
   - For all high-risk role facts, negative boundaries, and candidate work-history chronology bindings, both reviews are compared.
   - In case of divergence, an Adjudication Reviewer documents the resolution in `*_RECONCILIATION.json` with an explicit adjudicator ID.
3. **Mechanical Ingestion**:
   - `scripts/transition/ingest-batch06-human-truth.ts` verifies independent dual-review proofs (`reviewerId !== reviewer2Id`), resolves verbatim quotes to frozen span IDs, validates canonical schemas, and generates the compiled authoritative reference truth files.
4. **Cryptographic Sealing**:
   - Both Primary and Secondary reference files are finalized and cryptographically hashed before Step 4 model extraction runs.
