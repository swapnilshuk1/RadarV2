# GATE 1B BATCH 06 — ROLE REFERENCE-TRUTH MATERIALITY RUBRIC

**Document Version**: `v1.0-frozen`  
**Standard**: Model-Blind Executive Materiality Standard  
**Governing Gate**: GATE 1B (Batch 06 Human Truth Adjudication)  

---

## 1. Executive Purpose & Certification Alignment

In Gate 1B, the certification threshold of **Typed Reference Recall >= 50%** is historically anchored to the **Batch 04C/R2 Selected Material Reference Fact Set** (74 facts across 21 roles), which specifically probed high-risk executive dimensions and material role mandates. It was **never** an exhaustive inventory of every sentence, grammatical clause, or boilerplate paragraph in a job description.

To preserve the richer, higher-density annotation workflow of Batch 06 while maintaining mathematical and historical comparability with Gate 1B certification benchmarks, all extracted role facts MUST be classified into one of two reference statuses:

1. **`MATERIAL_SELECTED`** (Authoritative Certification Denominator)
2. **`SUPPORTING_NON_MATERIAL`** (Diagnostic / Contextual Facts)

```
                            ALL CANDIDATE ROLE FACTS
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
        MATERIAL_SELECTED                       SUPPORTING_NON_MATERIAL
  (Certification Denominator: >=50%)            (Reported as Diagnostic)
  - Core Mandate & Purpose                     - Boilerplate & Generic Statements
  - Material Responsibilities & Outcomes       - Secondary Technology Stacks
  - High-Risk Governance & Reporting           - Equal Opportunity & Diversity Prose
  - People, Budget, P&L Scale                  - General Office Perks / Generic Setup
```

---

## 2. Model-Blind Materiality Classification Rules

Reviewers must classify facts based **strictly on the plain text of the job description**, completely blind to any extractor capabilities, model behaviors, or engineering preferences.

> [!IMPORTANT]
> **MODEL-BLIND SELECTION INVARIANT**:
> Do not select facts based on what the extractor emits or misses. Annotators must never attempt to accommodate, anticipate, or penalize extractor behavior. Materiality is an intrinsic property of the executive role as documented in the source job posting.

### A. Criteria for `MATERIAL_SELECTED`
A reference fact MUST be tagged as `MATERIAL_SELECTED` if it materially characterizes any of the following 9 executive dimensions:

1. **Role Mandate & Purpose**: The core reason the position exists and its primary organizational mission (e.g. "Lead global process transitions and build GSS center").
2. **Material Responsibilities & Outcomes**: Primary business outcomes, deliverables, or mission-critical accountability (e.g. "Deliver $20M net ARR expansion in FY27").
3. **Mandatory Qualifications & Explicit Preferences**: Core educational degrees, mandatory certifications, years of domain leadership experience, or critical domain specializations.
4. **Authority & Decision Boundaries**: Explicit decision rights, approval limits, policy governance, or formal autonomy (e.g. "Authority to execute non-binding LOIs up to £50M enterprise value").
5. **Reporting Lines & Executive Governance**: Direct supervisor title, executive committee presentation rights, board exposure, or founder proximity (affirmed OR negated).
6. **People Leadership & Scale**: Direct line management count, matrix organization scale, total headcount overseen, or explicit IC/zero-direct-report boundaries.
7. **Financial & Commercial Scope**: Formal P&L ownership, budget administration scale, revenue quota, or cost center management.
8. **Geographic, Product, Customer & Regulatory Scope**: Regional footprint (EMEA, APAC), industry segment (FinTech, Life Sciences), client segment (Enterprise, SMB), or regulated operating environment (FINRA, FDA).
9. **Material Work Conditions**: Physical location requirements, travel expectations (>= 25%), work arrangement (On-site, Hybrid, Remote), or shift conditions.

### B. Criteria for `SUPPORTING_NON_MATERIAL`
A fact should be tagged as `SUPPORTING_NON_MATERIAL` if it represents:
1. **Corporate Boilerplate**: Generic company descriptions ("We are an industry-leading fast-growing firm..."), diversity & inclusion disclaimers, or generic mission statements.
2. **Ubiquitous Administrative Details**: Standard office tools (e.g. "Proficiency with Slack, Microsoft Office, Google Workspace") unless specifically central to a specialized engineering or operations architecture.
3. **Soft Skills & Non-Differentiating Attributes**: "Strong interpersonal skills", "Team player", "Passionate self-starter", "Excellent oral communication".
4. **Generic Benefits**: Standard health insurance coverage, 401(k) match, standard paid time off, or catered lunches.

---

## 3. Mathematical Gate Invariant

1. **Certification Denominator**:
   ```text
   Certification Typed Reference Recall = (Typed Matches on MATERIAL_SELECTED facts) / (Total MATERIAL_SELECTED facts)
   ```
   - Certification Typed Reference Recall >= 50% must be computed against `MATERIAL_SELECTED` facts.
   - Preserves historically anchored/comparable benchmarks with the Batch 04C/R2 Selected Material Reference Fact set.

2. **Diagnostic Metric**:
   ```text
   Full / Exhaustive Fact Recall = (Typed Matches on All Reference Facts) / (Total Reference Facts)
   ```
   - Full/exhaustive fact recall may be reported separately as a diagnostic metric but must not silently replace the historically comparable certification denominator.

---

## 4. Population Sealing Semantics

- **Primary Certification Set**: Annotated, dual-reviewed, and cryptographically frozen before model certification runs.
- **Secondary Remediation Holdout Set**:
  Secondary is SEALED FROM:
  - implementation agent inspection of completed truth
  - model/extractor execution
  - tuning
  - scoring
  until the permitted remediation condition occurs.
  Secondary is NOT sealed from independent human adjudicators. Both Primary and Secondary must be human-annotated, dual-reviewed where required, and cryptographically frozen before the Primary model run.

---

## 5. Annotation Template Syntax & Silent Dimensions

In the role annotation files, every fact in the `"facts"` array must explicitly include the `"materiality"` key:

```json
{
  "id": "fact_01",
  "propositionText": "Manages an annual marketing program budget of $6,500,000 across digital acquisition and tooling.",
  "sourceEvidence": ["manage an annual marketing program budget of $6,500,000 across digital acquisition, agency retainers, and tooling."],
  "canonicalTypes": ["BUDGET_SCOPE"],
  "appliesTo": "ROLE",
  "polarity": "AFFIRMED",
  "highRiskFamily": null,
  "materiality": "MATERIAL_SELECTED"
}
```

If an annotator identifies a contextual or secondary statement worthy of capture:

```json
{
  "id": "fact_02",
  "propositionText": "Uses Slack and Microsoft Teams for daily cross-functional team coordination.",
  "sourceEvidence": ["frequent communication via Slack and Teams"],
  "canonicalTypes": ["WORK_CONDITION"],
  "appliesTo": "ROLE",
  "polarity": "AFFIRMED",
  "highRiskFamily": null,
  "materiality": "SUPPORTING_NON_MATERIAL"
}
```

### High-Risk Silent Dimensions (Gate 7)
At the document root level, reviewers must specify `highRiskSilentDimensions: HighRiskFamily[]` listing any of the 9 high-risk families that are completely absent or silent in the job description:
```json
{
  "highRiskSilentDimensions": [
    "BOARD_EXPOSURE",
    "FOUNDER_CEO_PROXIMITY"
  ]
}
```
The evaluator scores Gate 7 (Insufficient-Evidence Capture Rate >= 90%) by verifying that the extraction model explicitly identifies these families in its post-admission `unknownHighRiskDimensions` set and asserts zero affirmative claims over them.
