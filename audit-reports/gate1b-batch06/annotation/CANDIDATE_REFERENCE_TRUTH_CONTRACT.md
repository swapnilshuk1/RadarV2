# Gate 1B Batch 06 — Controlled Candidate Reference Truth Contract

**Date**: 2026-09-14  
**Status**: Authoritative Pre-Adjudication Freeze  
**Governing Seam**: `src/lib/intelligence/extraction/CandidateProofExtractorV1.ts` & `scripts/transition/evaluator-batch06.ts`

---

## 1. PURPOSE & ARCHITECTURAL INVARIANT

This contract defines the controlled annotation vocabulary, structural schema, and scoring rules for candidate resume reference ground truth in Gate 1B Batch 06.

> [!IMPORTANT]
> **CANONICAL ALIGNMENT INVARIANT (NO PARALLEL ONTOLOGY)**:
> Annotators and evaluators must NOT invent an ad-hoc or parallel candidate ontology for Batch 06. Every reference fact must map 1:1 to the canonical `CandidateProofClaim` domain model defined in `CandidateProofExtractorV1.ts`.

---

## 2. CONTROLLED CANDIDATE VOCABULARIES

### A. Allowed Candidate Proof Types (18 Canonical Types)
Reference annotators may ONLY assign proof types from the canonical 18-type enum defined in `CandidateProofExtractorV1.ts`:

| Proof Type | Canonical Definition | Valid Resume Example |
| :--- | :--- | :--- |
| `OUTCOME` | Quantified or qualified business or organizational result achieved | "Drove 40% reduction in customer onboarding churn" |
| `OWNERSHIP` | Direct accountability, charter, or organizational domain owned | "Owned global checkout and payments infrastructure" |
| `FINANCIAL_SCOPE` | Direct P&L, budget, expenditure, or fiscal allocation scale | "Managed an annual cloud infrastructure budget of $28M" |
| `PEOPLE_SCOPE` | Headcount, direct reports, or organizational team size managed | "Directed global engineering organization of 420 engineers" |
| `GEOGRAPHIC_SCOPE` | Multi-country, regional, or distributed site operating footprint | "Operated across 4 engineering hubs in India, US, and EU" |
| `ORGANIZATION_BUILD` | Greenfield team building, hiring, or department standup from scratch | "Built the payments engineering department from 35 to 190 engineers" |
| `TRANSFORMATION` | Major structural, operational, or architectural change programs | "Spearheaded migration of legacy monolith to GCP microservices" |
| `MANDATE` | Specific executive mission, charge, or board-given mandate | "Chartered by the CEO to stand up the enterprise AI division" |
| `PRODUCT_LAUNCH` | Zero-to-one product creation, commercial release, or market introduction | "Launched enterprise fraud detection platform processing 10M daily events" |
| `CUSTOMER_GROWTH` | Net client acquisition, enterprise account expansion, or retention scale | "Expanded enterprise client base from 50 to 220 logos" |
| `REVENUE_GROWTH` | Direct top-line ARR, GMV, or sales growth generated | "Grew product line ARR from $15M to $65M within 3 years" |
| `COST_EFFICIENCY` | Unit-cost reduction, margin improvement, or vendor cost optimization | "Drove infrastructure unit costs down 38% via automated FinOps" |
| `PIPELINE_GENERATION` | Qualified sales pipeline, demand generation, or deal flow created | "Generated $45M in qualified enterprise pipeline in first 18 months" |
| `TECHNOLOGY_IMPLEMENTATION` | Hyperscale system deployment, platform re-platforming, or tech stack build | "Deployed distributed Apache Kafka clusters handling 2B msgs/day" |
| `PARTNERSHIP` | Strategic alliances, major joint ventures, or ecosystem deals executed | "Formed strategic co-selling partnership with Microsoft Azure" |
| `STAKEHOLDER_LEADERSHIP` | Board, C-suite, investor, auditor, or regulator leadership | "Presented quarterly technical audit roadmap to Board Audit Committee" |
| `DOMAIN_PRECEDENT` | First-of-kind industry milestone, patent grant, or standard established | "Awarded 3 patents in distributed consensus protocols" |
| `CAPABILITY_LABEL` | Skill badges, technical competencies, or tool domain labels | "Kubernetes, Terraform, Multi-Region High Availability" |

### B. Allowed Candidate Evidence Classes (3 Canonical Classes)
Each claim must declare exactly one evidence class from `CandidateProofExtractorV1.ts`:
1. **`WORK_HISTORY`**: Accomplishments, responsibilities, or scale points tied directly to a specific employer tenure bullet under Professional Experience.
2. **`SELF_SUMMARY`**: High-level claims, career summaries, or identity statements from the Executive Profile / Summary masthead above Professional Experience.
3. **`CAPABILITY_LABEL`**: Isolated skill keywords, certifications, tools, or technical competencies listed in Core Competencies or Skills sections.

---

## 3. CANDIDATE FACT RECORD STRUCTURE

Each reference claim in `*_BLANK.json` must adhere to this JSON structure:

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

---

## 4. ANNOTATION INVARIANTS & EVALUATOR SCORING RULES

Reviewers and the evaluator must adhere strictly to these 10 binding rules:

### 1. Exact-Text & Character Offset Grounding (Gate 4)
- `exactText` MUST be a character-for-character exact substring of the raw resume text.
- `startOffset` and `endOffset` must index the exact slice in the source file: `sourceText.slice(startOffset, endOffset) === exactText`. Zero whitespace normalization, zero substring containment fallback.
- Paraphrasing, summarizing, or approximating text spans is strictly forbidden.
- Evaluator enforces **`candidateSpanProvenanceMin: 1.0`** (100% mechanical text containment; 0 tolerance for hallucinated or floating spans).

### 2. Chronology & Position Binding Invariant (Gate 9)
- Every proof claim must bind strictly to the verified employer, executive title, and tenure dates/current status:
  $$\text{candidateChronologyBinding} = \frac{\text{work-history reference claims with correct employer AND title AND tenure/current-status}}{\text{all applicable work-history reference claims}}$$
- Evaluator enforces **`candidateChronologyBindingMin: 0.90`** (>= 90% accuracy). Employer-only binding is evaluated as a secondary diagnostic.
- **Strict Normalized Equality**: Evaluator compares `employer`, `title`, `startDate`, `endDate` using normalized exact string equality (trim, lowercase, whitespace collapse). No substring containment (`.includes()`) is permitted as a certification pass criterion.
- **Grounded Source Range Matching**: Candidate claims are matched to reference facts via grounded source ranges / span containment (`c.startOffset >= rf.startOffset && c.endOffset <= rf.endOffset` or reciprocal containment/overlap), disambiguating duplicate identical text by character offsets.

### 3. Position / Title Binding Invariant
- Every proof claim must bind to the specific executive title held during that tenure (e.g. "Chief Technology Officer", "VP Engineering").
- Reviewers must not conflate titles across distinct positions at the same employer.

### 4. Date / Tenure Binding Invariant
- `startDate` and `endDate` must record verified employment dates in `YYYY-MM` or `YYYY` format.
- If employment is ongoing, `endDate` must be `null` and `isCurrent` must be `true`.

### 5. Metric, Value, Unit & Currency Fidelity (Gate 8)
- For quantitative claims, numerical values, currency symbols (`$`, `₹`, `EUR`, `GBP`), scale words (`M`, `Cr`, `B`, `K`), and units (`engineers`, `transactions`, `bps`, `%`) must be faithfully preserved in `StructuredMetric` entries.
- Evaluator enforces **`candidateMetricFidelityMin: 0.90`** (>= 90% token retention).
- Matching requires exact canonical `StructuredMetric` schema equality across `metricType`, `normalizedValue` ($\Delta < 1e-6$), `unit`, `currency`, and `comparator`. Text-contains-number fallback is eliminated.

### 6. Current-Role Status
- Correctly classify whether the tenure is active (`isCurrent: true`) or completed (`isCurrent: false`).
- Self-summary claims without a date inherit the candidate's present career level.

### 7. Zero Cross-Position Leakage
- Accomplishments, metrics, or teams from Position A must NEVER be attributed to Position B, even within the same company.
- A claim assigned to the wrong employer or position tenure constitutes a fatal contamination failure.

### 8. Zero Cross-Document Leakage
- Candidate claims must never reference facts, employers, or metrics from other candidate resumes or job postings.

### 9. Structural Isolation of Self-Summary from Work History
- Claims in the Executive Profile / Summary section must be tagged as `SELF_SUMMARY`.
- Promoting a self-summary assertion to `WORK_HISTORY` without verified bullet provenance under an employer is evaluated as an evidence-class error.

### 10. Metric Comparators
- When a metric includes qualifiers ("at least", "over", "approximately", "between X and Y"), reviewers should record the comparator (`EXACT`, `AT_LEAST`, `MORE_THAN`, `APPROXIMATELY`, `RANGE`) in the `StructuredMetric` record to preserve semantic intent.

---

## 5. DUAL HUMAN CONFIRMATION & ARTIFACT PROTOCOL

1. **Independent Dual Review Artifacts**:
   - Reviewer 1 annotates `*_REV1.json`.
   - Reviewer 2 annotates `*_REV2.json` independently.
   - Both reviewers must have distinct reviewer IDs (`reviewer1Id !== reviewer2Id`).
2. **Authoritative Reconciliation Record (`*_RECONCILIATION.json`)**:
   - `*_RECONCILIATION.json` is the complete final authoritative annotation for the resume.
   - Ingestion compiles ONLY the complete reconciliation document.
   - Every reconciled claim includes provenance mapping back to REV1 and REV2 (`rev1ClaimIds`, `rev2ClaimIds`) and resolution status (`"AGREED"` or `"ADJUDICATED"`).
   - Document header includes `reviewer1Id`, `reviewer2Id`, `adjudicatorId`, `rev1ArtifactHash`, `rev2ArtifactHash`, and `dualReviewVerified: true`.
3. **Mechanical Ingestion & Anti-Triple-Counting**:
   - `scripts/transition/ingest-batch06-human-truth.ts` enforces dual reviews, validates artifact hashes, and compiles only `*_RECONCILIATION.json`.
   - Any unclassified `.json` files in the directory trigger validation failure.
4. **Sealing Semantics**:
   - **Primary Population**: Annotated, dual-reviewed, and cryptographically frozen before model extraction runs.
   - **Secondary Holdout**: SEALED FROM implementation agent inspection of completed truth, model/extractor execution, tuning, and scoring until the permitted remediation condition occurs.
   - **Secondary is NOT sealed from independent human adjudicators**: Both Primary and Secondary must be human-annotated, dual-reviewed where required, and cryptographically frozen before the Primary model run.

