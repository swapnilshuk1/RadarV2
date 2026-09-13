# GATE 1B BATCH 06 — EXTERNAL HUMAN REVIEWER INSTRUCTIONS

## 1. PURPOSE & GOVERNING PRINCIPLES
This document instructs independent external human adjudicators on annotating reference ground truth for the RADAR v2 Gate 1B Batch 06 Blind Validation.

**CRITICAL INDEPENDENCE RULE**:
Human truth adjudication must be strictly external and independent of the autonomous coding agent. No model outputs, proposed extractions, or candidate architecture inferences are provided to reviewers. Reviewers see only the authentic raw text.

## 2. POPULATIONS
1. **Primary Certification Population**:
   - 50 Roles (`PRIMARY_ROLE_01` to `PRIMARY_ROLE_50`)
   - 16 Candidate Resumes (`PRIMARY_CANDIDATE_01` to `PRIMARY_CANDIDATE_16`)
2. **Secondary Remediation Holdout**:
   - 25 Roles (`SECONDARY_ROLE_01` to `SECONDARY_ROLE_25`)
   - 8 Candidate Resumes (`SECONDARY_CANDIDATE_01` to `SECONDARY_CANDIDATE_08`)
   *(Note: The secondary holdout remains sealed unless a single permitted remediation cycle is authorized)*.

---

## 3. ROLE ANNOTATION PROTOCOL (`*_BLANK.json`)
For each role document, reviewers must extract discrete reference facts and negative boundaries:

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
  "highRiskFamily": null
}
```

### B. Controlled Vocabularies
1. **Canonical Semantic Types (25 Roles Types strictly)**:
   `TITLE`, `SENIORITY`, `DEPARTMENT`, `REPORTING_LINE`, `PEOPLE_MANAGEMENT`, `TEAM_SIZE`, `BUDGET_RESPONSIBILITY`, `BUDGET_SIZE`, `PNL_RESPONSIBILITY`, `PNL_SIZE`, `REVENUE_RESPONSIBILITY`, `REVENUE_SIZE`, `GEOGRAPHIC_SCOPE`, `TRAVEL_REQUIREMENT`, `WORK_MODEL`, `LOCATION`, `EMPLOYMENT_TYPE`, `COMPENSATION_BASE`, `COMPENSATION_VARIABLE`, `EQUITY_OFFERING`, `EDUCATION_REQUIREMENT`, `EXPERIENCE_YEARS`, `INDUSTRY_EXPERIENCE`, `TECHNICAL_SKILL`, `SOFT_SKILL`.

2. **Applicability Domain**:
   - `ROLE`: Direct mandate, authority, or condition of the hiring position.
   - `CANDIDATE_REQUIREMENT`: Mandatory prerequisite qualifications the applicant must possess.
   - `CANDIDATE_PREFERENCE`: Preferred, optional qualifications.
   - `COMPANY`: Context about the hiring company (e.g. employee count, funding, revenue).
   - `RECRUITING_PROCESS`: Interview steps, assessment protocols, background checks.

3. **Polarity**:
   - `AFFIRMED`: Stated as true and in-scope for the position.
   - `NEGATED`: Explicitly excluded, prohibited, or stated as not in scope (e.g., "no direct reports", "does not manage P&L").
   - `CONDITIONAL`: Contingent upon an explicit external dependency (e.g., "subject to Board approval", "requires CFO sign-off").

4. **High-Risk Negative Boundaries (`highRiskNegatives`)**:
   Enumerate any of the 10 high-risk dimensions that are explicitly absent or contradicted in the JD:
   - `REPORTING_LINE`, `FOUNDER_CEO_PROXIMITY`, `BOARD_EXPOSURE`, `PNL_OWNERSHIP`, `COMMERCIAL_ACCOUNTABILITY`, `REVENUE_ACCOUNTABILITY`, `PROFITABILITY_ACCOUNTABILITY`, `DECISION_AUTHORITY`, `PEOPLE_LEADERSHIP`, `PEOPLE_SCALE`.

---

## 4. CANDIDATE RESUME ANNOTATION PROTOCOL (`*_BLANK.json`)
For each executive resume:
1. Identify all employment positions under `## PROFESSIONAL EXPERIENCE` with exact Employer, Title, and Dates.
2. For each bullet point, record key proof claims with exact verbatim substring evidence:
```json
{
  "id": "cand_fact_01",
  "exactText": "Directed global engineering and infrastructure org of 420 engineers across Bengaluru, Pune, and Seattle.",
  "proofType": "PEOPLE_MANAGEMENT",
  "evidenceClass": "TEAM_SCALE",
  "metric": "420 engineers",
  "employer": "CloudScale Technologies",
  "dates": "Jan 2021 – Present",
  "isCurrent": true
}
```

---

## 5. DUAL HUMAN CONFIRMATION WORKFLOW
1. Reviewer 1 and Reviewer 2 annotate independently.
2. For any High-Risk Negative Boundary or High-Risk Affirmative assertion:
   - Both Reviewer 1 and Reviewer 2 must agree (100% concordance).
   - In case of disagreement, an Adjudication Reviewer reconciles the final canonical label.
3. Once completed, save adjudicated files and run:
   `npx tsx scripts/transition/ingest-batch06-human-truth.ts`
