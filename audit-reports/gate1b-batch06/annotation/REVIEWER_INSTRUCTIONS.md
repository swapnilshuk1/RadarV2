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
- **Sealed FROM**: The autonomous coding agent, model/extractor execution, prompt engineering, tuning, and scoring. The implementation agent MUST NOT inspect completed secondary ground truth or execute extractions against secondary documents until a permitted remediation condition occurs.
- **NOT Sealed FROM Independent Adjudicators**: Both Primary and Secondary populations MUST be human-annotated, dual-reviewed where required, and cryptographically frozen together BEFORE the Primary model certification run begins.

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
   - `MATERIAL_SELECTED`: Core executive dimensions (role purpose, responsibilities, qualifications, authority, reporting, scope, work conditions). The certification threshold (>=50% typed recall) is computed strictly against this denominator, preserving exact historical comparability with Batch 04C/R2.
   - `SUPPORTING_NON_MATERIAL`: Generic workplace boilerplate, standard office tools, routine administrative perks. Recorded for diagnostic reporting only.

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

Reviewers must extract candidate career milestones and executive proof points strictly adhering to [`CANDIDATE_REFERENCE_TRUTH_CONTRACT.md`](./CANDIDATE_REFERENCE_TRUTH_CONTRACT.md), aligning 1:1 with the canonical `CandidateProofClaim` contract.

### A. Proof Claim Record Structure
```json
{
  "id": "cand_fact_01",
  "title": "VP of Engineering",
  "employer": "CloudScale Technologies",
  "startDate": "2021-01",
  "endDate": null,
  "isCurrent": true,
  "proofTypes": ["HEADCOUNT_SCALE"],
  "evidenceClass": "ORGANIZATIONAL_SCOPE",
  "exactText": "Directed global engineering and infrastructure org of 420 engineers across Bengaluru, Pune, and Seattle.",
  "startOffset": 1240,
  "endOffset": 1345,
  "metric": {
    "value": 420,
    "unit": "engineers",
    "rawText": "420 engineers"
  }
}
```

### B. Controlled Candidate Vocabularies
1. **Candidate Proof Types (18 Canonical Types strictly)**:
   `REVENUE_SCALE`, `HEADCOUNT_SCALE`, `BUDGET_SCALE`, `EFFICIENCY_IMPROVEMENT`, `DEAL_TRANSACTION`, `TRANSFORMATION_SCOPE`, `STRATEGIC_INITIATIVE`, `BOARD_INTERACTION`, `FOUNDER_INTERACTION`, `GLOBAL_REACH`, `TECHNICAL_INNOVATION`, `CULTURE_TRANSFORMATION`, `REPORTING_LINE`, `DECISION_AUTHORITY`, `PROFITABILITY_METRIC`, `COST_REDUCTION`, `MARKET_SHARE`, `EQUITY_FINANCING`.

2. **Candidate Evidence Classes (3 Canonical Classes strictly)**:
   - `QUANTITATIVE_METRIC`: Verifiable numerical claim (e.g., "$120M ARR", "420 engineers", "35% reduction").
   - `ORGANIZATIONAL_SCOPE`: Structural, reporting, or geographic footprint (e.g., "Reported to CEO", "Managed 4 global sites").
   - `QUALITATIVE_IMPACT`: Strategic or transformation achievements without a standalone metric (e.g., "Led cloud migration across core banking").

### C. Candidate Scoring Rules & Invariants
1. **Exact-Text / Source-Span Invariant**: `exactText` must match character-for-character as an exact substring of the resume text, with exact `startOffset` and `endOffset`. Hallucinated or loosely paraphrased spans fail Gate 4 (`candidateSpanProvenanceMin: 1.0`).
2. **Employer Binding**: Each claim must bind strictly to the verified `employer` entity where the work occurred.
3. **Position / Title Binding**: Each claim must bind to the specific executive title held during that tenure.
4. **Date / Tenure Binding**: Each claim must bind to verified employment dates (`startDate`, `endDate`).
5. **Metric & Token Fidelity**: Numbers, percentages, currency symbols, and units must be preserved without distortion. Evaluated by Gate 8 (>=90% fidelity).
6. **Current-Role Status**: Correctly identify whether the role is active (`isCurrent: true`) or historical (`false`).
7. **Zero Cross-Position Leakage**: Attributing accomplishments achieved at Company A to Company B is a fatal contamination error.
8. **Zero Cross-Document Leakage**: Candidate claims must never reference facts from other candidate resumes or job postings.

---

## 5. DUAL HUMAN CONFIRMATION WORKFLOW

1. Reviewer 1 and Reviewer 2 annotate independently.
2. For any High-Risk Negative Boundary or High-Risk Affirmative assertion:
   - Both Reviewer 1 and Reviewer 2 must agree (100% concordance).
   - In case of disagreement, an Adjudication Reviewer reconciles the final canonical label.
3. Both Primary and Secondary reference files are finalized and cryptographically hashed before Step 4 model extraction runs.
4. Ingestion is performed via:
   `npx tsx scripts/transition/ingest-batch06-human-truth.ts`
