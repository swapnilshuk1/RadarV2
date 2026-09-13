# GATE_1B_BATCH_06 — Validation & Production Certification Runbook

**Gate**: GATE 1B (Substrate, Provenance, and Extraction Architecture Decision)  
**Batch**: GATE_1B_BATCH_06 (Implementation & Production Certification)  
**Status**: DRAFTED IN BATCH 05 / PENDING BATCH 06 AUTHORIZATION  
**Purpose**: Prescribe the exact, immutable 7-step execution protocol for Batch 06 to prove that the selected extraction architecture is safe, robust, and production-ready.

---

## The 7-Step Validation Flow

$$\text{Step 1: Reconcile Evaluator} \longrightarrow \text{Step 2: Build & Freeze Engine} \longrightarrow \text{Step 3: Blind Population} \longrightarrow \text{Step 4: Pre-register Thresholds} \longrightarrow \text{Step 5: Run Once, Score Once} \longrightarrow \text{Step 6: Shadow Mode} \longrightarrow \text{Step 7: Production Certification}$$

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: RECONCILE AND FREEZE THE EVALUATOR                                      │
│ - Freeze definitions, scoring harness, and SHA-256 hash.                        │
│ - Strict invariant: Zero evaluator code changes after blind data is generated.  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: BUILD AND FREEZE VERIFICATION + STRUCTURAL ADMISSION                    │
│ - Implement High-Risk Verifier (ENTAILED / CONTRADICTED / INSUFFICIENT).        │
│ - Implement Structural Admission (Prerequisite wall, negative boundaries).      │
│ - Freeze prompts, schemas, models, and verifier weights.                        │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: ASSEMBLE A GENUINELY BLIND VALIDATION POPULATION                        │
│ - Fresh unseen natural executive JDs + authored counterfactual/adversarial JDs. │
│ - 15–20 structurally diverse candidate resumes with dense metrics & chronologies│
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: PRE-REGISTER PASS/FAIL THRESHOLDS                                       │
│ - Commit immutable numerical gates before execution. Zero post-hoc shifting.   │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: RUN ONCE, SCORE ONCE                                                    │
│ - Execute frozen pipeline against blind population without human-in-the-loop.   │
│ - Calculate pass/fail strictly against pre-registered thresholds.               │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 6: PASS → SHADOW MODE DEPLOYMENT                                           │
│ - Execute dual-run shadow pipeline in staging/production for N documents.       │
│ - Measure real-world latency, cost, and human audit agreement.                  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 7: CERTIFY AND DEFINE RE-CERTIFICATION                                     │
│ - Formal Gate 1B exit certification.                                            │
│ - Establish signal-based drift triggers for scheduled/automated re-evaluation.  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Reconcile and Freeze the Evaluator

### A. Root-Cause Reconciliation of R1 `18` vs R2 `5` High-Risk Failures
- **The R1 `18` Discrepancy**: In the provisional R1 evaluation, Architecture B's lack of a polarity channel was treated as 18 affirmative high-risk errors. The adapter defaulted missing polarity to `AFFIRMED`, which artificially classified 18 unrepresentable negations as active affirmative false claims.
- **The R2 `5` Authoritative Baseline**: In R2, missing polarity was properly mapped to `POLARITY_UNREPRESENTABLE`. Architecture B had 0 false affirmative assertions, but 17 unrepresentable negations. Meanwhile, Architectures C and D emitted exactly 5 true false affirmative assertions on negative boundaries (all 5 being relationship-scope ambiguities: portfolio-company advisory engagement vs internal firm CEO reporting in `ADV_ROLE_02`, `04`, `06`, `07`, `08`).
- **Freezing Rule**: The evaluator must preserve this strict conceptual separation between structural representation inability (`POLARITY_UNREPRESENTABLE`) and actual false claims (`WRONG_ASSERTION`).

### B. Evaluator Hash Lockdown
- Evaluator implementation (`scripts/transition/evaluator-r2.ts` or its Batch 06 successor) must be committed and hashed via SHA-256.
- **Invariant**: Once the blind validation corpus is assembled, **ZERO** modifications to the evaluator code, text matching thresholds, or failure categorization logic are permitted.

---

## Step 2: Build and Freeze Verification + Structural Admission

### A. High-Risk Semantic Verifier Design
- Must evaluate proposed propositions targeting high-risk semantic areas (`PNL_OWNERSHIP`, `COMMERCIAL_ACCOUNTABILITY`, `REPORTING_LINE`, `FOUNDER_CEO_PROXIMITY`, `BOARD_EXPOSURE`, `DECISION_AUTHORITY`, `PEOPLE_LEADERSHIP`, `PEOPLE_SCALE`).
- Built from the **general high-risk taxonomy**, never fine-tuned or hardcoded against the 5 known R2 failure instances.
- Must emit one of three explicit states:
  1. `ENTAILED`: Claim is logically supported by cited source spans $\rightarrow$ proceeds to structural admission.
  2. `CONTRADICTED`: Claim is refuted by source spans (e.g., explicit disclaimer) $\rightarrow$ routed to negative boundaries; NEVER admitted into positive role scope.
  3. `INSUFFICIENT`: Evidence is ambiguous, partial, or missing $\rightarrow$ marked as explicit `UNKNOWN`; NEVER admitted into positive role scope.

### B. Structural Admission Layer Design
- Must remain strictly decoupled from semantic verification.
- Enforces structural domain walls:
  - `CANDIDATE_REQUIREMENT` $\rightarrow$ Project strictly as `HARD_REQUIREMENT`; strictly block role authority projection.
  - `CANDIDATE_PREFERENCE` $\rightarrow$ Project strictly as `PREFERRED_REQUIREMENT`.
  - `COMPANY` $\rightarrow$ Project strictly as `COMPANY_CONTEXT`.
  - `RECRUITING_PROCESS` $\rightarrow$ Block role authority projection.
  - `NEGATED` $\rightarrow$ Retain in negative boundary index for veto checks.
  - `CONDITIONAL` $\rightarrow$ Retain explicit condition string; block unconditional role authority.

### C. Pre-Execution Freeze
- All prompts, system instructions, schemas, model parameters (`temperature: 0.0`), and verifier logic must be committed with SHA-256 manifests before proceeding to Step 3.

---

## Step 3: Assemble a Genuinely Blind Validation Population

### A. Role Validation Corpus
- **Size**: Minimum 30 documents.
- **Composition**:
  - 15 Fresh, naturally occurring executive JDs across diverse portals (LinkedIn, Naukri, Workday, Lever, Greenhouse) that were never included in Batches 01–05.
  - 15 Authored counterfactual and adversarial test documents designed to rigorously stress high-risk semantic boundaries (e.g., fractional CXO roles, advisory board vs fiduciary board, client CEO contact vs internal CEO line, explicitly disclaimed P&L).
- **Stratification**: Must cover all 8 high-risk semantic areas and all 6 structural boundary failure modes.

### B. Candidate Validation Corpus
- **Size**: 15–20 structurally diverse executive resumes.
- **Composition**:
  - Multi-page resumes with complex multi-role tenures at a single company.
  - Highly non-linear career trajectories (founder $\rightarrow$ advisor $\rightarrow$ operating partner).
  - Dense quantitative metrics (currencies across INR, USD, EUR, team scales, conversion lifts).
  - Explicit non-traditional structures (board seats, advisory positions, consulting projects).

---

## Step 4: Pre-Register Pass/Fail Thresholds

Before executing the blind validation suite, the following quantitative certification gates must be committed immutably to `docs/transition/CURRENT_BATCH.json`:

| Metric Category | Target Invariant | Certification Threshold |
| :--- | :--- | :--- |
| **High-Risk False Affirmatives** | Zero tolerance on refuted high-risk claims | **$\le 1$ across entire blind role population** |
| **Typed Reference Recall** | Substantial superiority over Deterministic V1 | **$\ge 50.0\%$ overall** ($>15\%$ gain over V1) |
| **Long-Document Typed Recall** | Robustness on long documents ($>20\text{k}$ chars) | **$\ge 35.0\%$ on long-document stratum** |
| **Subject / Applicability Errors** | Zero candidate prerequisites leaked to role authority | **$0$ prerequisite-to-authority violations** |
| **Polarity Inversion Errors** | Zero negated claims asserted as affirmative | **$0$ negated-to-affirmative promotions** |
| **Explicit UNKNOWN Rate** | Missing authority must be explicit, not invented | **$\ge 90\%$ explicit capture of omitted high-risk areas** |
| **Candidate Metric Preservation** | Exact numerical token retention | **$\ge 95\%$ numeric/currency fidelity** |
| **Candidate Chronology Binding** | Correct position-to-employer attribution | **$\ge 95\%$ employer-role binding accuracy** |
| **End-to-End Extraction Latency** | Production cloud container SLA | **$\le 15.0\text{s}$ per document (P95)** |
| **Token Cost Economy** | Cloud operational budget | **$\le \$0.04$ per processed document** |

*Rule: No post-result threshold relaxation or selective rerun is permitted.*

---

## Step 5: Run Once, Score Once

1. **Blind Execution**: Run the frozen pipeline once across all blind role and candidate documents.
2. **Deterministic Baseline Dual Run**: Concurrently run frozen `RoleIntelligenceExtractorV1` and `CandidateProofExtractorV1` on the identical corpus.
3. **Scoring**: Evaluate against independent human reference truth using the hashed Step 1 evaluator.
4. **Result Determination**:
   - If ALL Step 4 thresholds are met $\rightarrow$ **PASS** $\rightarrow$ Proceed to Step 6.
   - If ANY Step 4 threshold fails $\rightarrow$ **FAIL** $\rightarrow$ Stop. The core architecture assumption is falsified. Re-open architecture decision.

---

## Step 6: Shadow Mode Deployment

Upon passing Step 5, the pipeline enters a non-blocking **Shadow Mode** in staging/pre-production:

- **Sample Size**: Minimum 200 consecutive live scraped opportunities.
- **Duration**: Minimum 7 calendar days.
- **Dual-Run Protocol**:
  - Live production continues serving existing certified baseline.
  - Candidate pipeline runs in background; emitted artifacts are recorded in shadow storage.
- **Audit Requirement**:
  - 10% stratified random sample (min 20 documents) subjected to double-blind human audit.
  - Zero toleration for unentailed high-risk claims in the audited sample.
- **Rollback / Exit Criteria**:
  - Immediate abort if P95 latency exceeds 20s or cost exceeds \$0.06/doc.
  - Formal exit granted only when audit confirms zero fatal high-risk regressions.

---

## Step 7: Certify and Define Re-Certification

### A. Production Promotion
- Upon satisfying Step 6 shadow criteria, the hybrid extraction pipeline is promoted to canonical production authority.
- `GATE_1B` is certified and formally closed. Gate 2 (EvidenceGraph & Advisory Evaluation) is unlocked.

### B. Signal-Based Drift Monitoring & Re-Certification Triggers
Production extraction must be automatically flagged for re-certification upon any of the following operational drift signals:
1. **Rising UNKNOWN Rate**: $>25\%$ shift in high-risk UNKNOWN classifications over a rolling 7-day window.
2. **Verifier Disagreement Spike**: Verifier rejection rate exceeding $15\%$ of emitted propositions.
3. **Structural Rejection Drift**: Structural admission rejecting $>20\%$ of rich propositions.
4. **Document Layout Evolution**: Introduction of new portal HTML formats or scrapers.
5. **Provider / Model Shift**: Upstream Gemini model version changes or temperature adjustments.
6. **Cost / Latency Drift**: Latency or token usage drifting $>30\%$ above certification baseline.

*Governance Invariant: Operational monitoring may trigger re-validation. It must NEVER automatically mutate production prompts, schemas, thresholds, or admission rules without human review and transition check approval.*
