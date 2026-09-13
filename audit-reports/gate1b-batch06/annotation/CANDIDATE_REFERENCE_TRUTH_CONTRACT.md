# Gate 1B Batch 06 — Controlled Candidate Reference Truth Contract

**Date**: 2026-09-13  
**Status**: Authoritative Pre-Adjudication Freeze  
**Governing Seam**: `src/lib/intelligence/extraction/CandidateProofExtractorV1.ts` & `scripts/transition/evaluator-batch06.ts`

---

## 1. PURPOSE & ARCHITECTURAL INVARIANT

This contract defines the controlled annotation vocabulary, structural format, and scoring rules for candidate resume reference ground truth in Gate 1B Batch 06.

> [!IMPORTANT]
> **CANONICAL ALIGNMENT INVARIANT**:
> Annotators and evaluators must NOT invent an ad-hoc or parallel candidate ontology for Batch 06. Every reference fact must map 1:1 to the canonical `CandidateProofClaim` domain model defined in `CandidateProofExtractorV1.ts`.

---

## 2. CONTROLLED CANDIDATE VOCABULARIES

### A. Candidate Proof Types (18 Canonical Types)
Reference annotators may ONLY assign proof types from this closed 18-type enum:

| Proof Type | Canonical Definition | Valid Example |
| :--- | :--- | :--- |
| `REVENUE_SCALE` | Top-line revenue ownership, growth quotas, ARR scale | "$120M annual revenue run-rate" |
| `HEADCOUNT_SCALE` | Direct and indirect engineering / org team size | "Led organization of 420 engineers" |
| `BUDGET_SCALE` | Operational or capital expenditure budget managed | "Managed $18M annual operating budget" |
| `EFFICIENCY_IMPROVEMENT` | Process acceleration, cycle-time or cost reductions | "Reduced cloud infrastructure unit cost by 32%" |
| `DEAL_TRANSACTION` | M&A transactions, major strategic enterprise deals | "Closed 4 enterprise transactions valued at $45M" |
| `TRANSFORMATION_SCOPE` | Greenfield architecture builds, cloud migrations | "Architected zero-to-one distributed ledger platform" |
| `STRATEGIC_INITIATIVE` | High-stakes cross-functional programs led | "Spearheaded company-wide SOC2 Type II compliance" |
| `BOARD_INTERACTION` | Formal presentations or interactions with Board of Directors | "Presented quarterly technical roadmap to Audit Committee" |
| `FOUNDER_INTERACTION` | Direct daily reporting or collaboration with Founder / CEO | "Partnered directly with Co-Founders on product strategy" |
| `GLOBAL_REACH` | Multi-geography, distributed sites, international footprint | "Managed distributed operations across 4 global sites" |
| `TECHNICAL_INNOVATION` | Patents, core IP, breakthroughs, proprietary platforms | "Awarded 3 distributed consensus patents" |
| `CULTURE_TRANSFORMATION` | Org design, retention initiatives, engineering academies | "Reduced annualized engineering turnover from 24% to 8%" |
| `REPORTING_LINE` | Structural reporting relationship to executive leadership | "Reported directly to Chief Technology Officer" |
| `DECISION_AUTHORITY` | Autonomous sign-off, procurement approval, hiring veto | "Held final technical sign-off on all platform RFCs" |
| `PROFITABILITY_METRIC` | EBITDA expansion, operating margin enhancement | "Improved gross margins by 450 bps" |
| `COST_REDUCTION` | Direct expenditure reduction, vendor renegotiations | "Eliminated $4.2M in annual SaaS licensing fees" |
| `MARKET_SHARE` | Category leadership, customer acquisition, rank | "Expanded enterprise market share from 12% to 28%" |
| `EQUITY_FINANCING` | Venture rounds, private placements, IPO readiness | "Supported Series C due diligence resulting in $65M raise" |

### B. Candidate Evidence Classes (3 Canonical Classes)
Each claim must declare exactly one evidence class:
1. `QUANTITATIVE_METRIC`: Verifiable numerical claim (e.g. "$120M ARR", "420 engineers", "32% reduction").
2. `ORGANIZATIONAL_SCOPE`: Structural, hierarchy, reporting line, or geographical footprint claims.
3. `QUALITATIVE_IMPACT`: Narrative leadership achievements without standalone numerical metrics.

---

## 3. CANDIDATE FACT RECORD STRUCTURE

Each reference claim in `*_BLANK.json` must adhere to this JSON structure:

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

---

## 4. ANNOTATION INVARIANTS & EVALUATOR SCORING RULES

### 1. Exact-Text & Character Offset Grounding (Gate 4)
- `exactText` MUST be an exact character-for-character substring of the resume raw text.
- `startOffset` and `endOffset` must index the exact character range in the source document.
- Paraphrasing, summarizing, or hallucinated text spans are strictly forbidden.
- Evaluator enforces `candidateSpanProvenanceMin: 1.0` (100% mechanical text containment).

### 2. Employer Binding Invariant (Gate 9)
- Every proof claim must be bound to the exact entity name (`employer`) under whose section the bullet appears.
- Evaluator enforces `candidateEmployerBindingMin: 0.90` (>= 90% accuracy).

### 3. Position / Title Binding Invariant
- Every proof claim must bind to the specific executive title held during that tenure.

### 4. Date / Tenure Binding Invariant
- `startDate` and `endDate` must record verified employment dates in `YYYY-MM` format.
- If employment is ongoing, `endDate` must be `null` and `isCurrent` must be `true`.

### 5. Metric & Value Fidelity (Gate 8)
- For quantitative claims, `metric.value`, `metric.unit`, and `metric.rawText` must be faithfully extracted.
- Currency symbols (`$`, `₹`, `EUR`), scale words (`M`, `Cr`, `B`), and percentage points must not be modified or stripped.
- Evaluator enforces `candidateMetricFidelityMin: 0.90` (>= 90% token retention).

### 6. Zero Cross-Position Contamination
- Accomplishments, metrics, or teams from Job A must never be attributed to Job B.
- A claim assigned to the incorrect employer section constitutes a fatal contamination failure.

### 7. Zero Cross-Document Leakage
- Candidate claims must never incorporate facts or phrases from other candidate resumes or job postings.

---

## 5. RECONCILIATION & ADJUDICATION WORKFLOW

1. **Independent Dual Annotation**: Two adjudicators annotate candidate documents independently.
2. **Reconciliation**:
   - Position chronologies and employer bindings must have 100% agreement.
   - Proof types must match canonical definitions. In case of disagreement, an Adjudication Reviewer selects the authoritative canonical type.
3. **Cryptographic Freeze**: Completed candidate ground truth is hashed and committed prior to model extraction.
