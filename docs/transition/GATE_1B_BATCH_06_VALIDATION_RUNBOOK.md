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
- **The R1 `18` Violations in Architecture C**: In the provisional R1 evaluation, Architecture C was reported with 18 high-risk violations. This was caused primarily by a defect in `evaluator-v2`: it ran an unconstrained substring search over free-text `negativeBoundaries` strings looking for substrings like `"P&L"` and `"REPORTING"`. Whenever a document mentioned these keywords in boundary descriptions (such as *"Vertical P&L does not mean whole-company P&L"* or *"No named CEO/founder proximity or reporting line is stated"*), the evaluator falsely injected `PNL_OWNERSHIP` and `REPORTING_LINE` into `highRiskNegatives` for that document—even when the posting legitimately contained Board reporting or vertical P&L responsibility. This heuristic flaw artificially generated 13 spurious violations on valid extractions (e.g. 4 on `DEV_CONTROL_01`, 2 on `DIVERSE_ROLE_03`, 2 on `DIVERSE_ROLE_04`).
- **The R2 `5` Authoritative Baseline for Architecture C**: In R2, `evaluator-r2` eliminated this naive substring heuristic, evaluating high-risk violations strictly against explicit reference-fact negative polarity and curated negative boundaries. This stripped away the 13 spurious evaluator artifacts and isolated Architecture C's **true count of 5 semantic false affirmative errors** (relationship-scope and IC vs leadership ambiguities in `ADV_ROLE_05`, `ADV_ROLE_06`, and `ADV_ROLE_08`).
- **Architecture B's Separate Correction (42 $\rightarrow$ 0 False Affirmatives, 17 Unrepresentable Negations)**: In R1, Architecture B had 42 violations because its adapter lacked a polarity channel and defaulted all assertions to `AFFIRMED`. In R2, missing polarity was properly mapped to `POLARITY_UNREPRESENTABLE`, revealing 0 false affirmative assertions and 17 unrepresentable negations.
- **Freezing Rule**: The evaluator must preserve this strict conceptual separation between structural representation inability (`POLARITY_UNREPRESENTABLE`), evaluator substring parsing artifacts, and actual semantic false claims (`WRONG_ASSERTION`).

### B. Evaluator Hash Lockdown
- Evaluator implementation (`scripts/transition/evaluator-r2.ts` or its Batch 06 successor) must be committed and hashed via SHA-256.
- **Invariant**: Once the blind validation corpus is assembled, **ZERO** modifications to the evaluator code, text matching thresholds, or failure categorization logic are permitted.

---

## Step 2: Build and Freeze Verification + Structural Admission

### A. High-Risk Semantic Verifier Design
- Must evaluate proposed propositions targeting high-risk semantic areas (`PNL_OWNERSHIP`, `COMMERCIAL_ACCOUNTABILITY`, `REPORTING_LINE`, `FOUNDER_CEO_PROXIMITY`, `BOARD_EXPOSURE`, `DECISION_AUTHORITY`, `PEOPLE_LEADERSHIP`, `PEOPLE_SCALE`).
- *Note on Commercial Accountability*: `COMMERCIAL_ACCOUNTABILITY` is an umbrella validation grouping spanning `REVENUE_ACCOUNTABILITY` and `PROFITABILITY_ACCOUNTABILITY`. It is strictly a validation taxonomy grouping and NOT a new `RoleSemanticType`; it must NEVER appear in canonical artifacts or schemas.
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

## Step 3: Assemble, Adjudicate, and Freeze a Genuinely Blind Validation Population

The validation process follows a strict chronological order to ensure zero data leakage and guarantee that reference truth is completely decoupled from model generation:

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 1. POPULATION SELECTION: Sample unseen JDs & executive resumes.                 │
│    - Role population: ≥50 JDs (30 natural unseen + 20 counterfactual).          │
│    - Candidate population: 15–20 structurally diverse resumes.                  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2. INDEPENDENT TRUTH ADJUDICATION: Create human reference truth.                │
│    - Strict isolation: Adjudicators have ZERO access to model or extractor      │
│      outputs. Annotate ground truth purely from raw source text.                │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 3. DUAL-REVIEW OF HIGH-RISK & NEGATIVE BOUNDARIES: Second adjudicator pass.     │
│    - Every high-risk semantic label, prerequisite constraint, and negative      │
│      boundary must receive two independent human confirmations.                 │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 4. CRYPTOGRAPHIC HASH LOCKDOWN: Commit SHA-256 manifests.                       │
│    - Lock population manifests, source documents, and reference truth fixtures  │
│      with SHA-256 hashes in `docs/transition/` BEFORE pipeline runs.            │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 5. FROZEN PIPELINE EXECUTION: Single execution pass.                            │
│    - Execute frozen candidate extraction pipeline strictly once.                │
│    - Concurrently run baseline deterministics on identical fixtures.            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### A. Role Validation Corpus Specifications
- **Size**: Minimum 50 documents (restoring the agreed comprehensive evaluation population).
- **Composition**:
  - 30 Fresh, naturally occurring executive JDs across diverse portals (LinkedIn, Naukri, Workday, Lever, Greenhouse) that were never included in Batches 01–05.
  - 20 Authored counterfactual and adversarial test documents designed to rigorously stress high-risk semantic boundaries (e.g., fractional CXO roles, advisory board vs fiduciary board, client CEO contact vs internal CEO line, explicitly disclaimed P&L, subsidiary vs group scope).
- **Stratification**: Must cover all 8 high-risk semantic areas and all 6 structural boundary failure modes across varied document lengths (<5k, 5k–20k, >20k chars).

### B. Candidate Validation Corpus Specifications
- **Size**: 15–20 structurally diverse executive resumes.
- **Composition**:
  - Multi-page resumes with complex multi-role tenures at a single company.
  - Highly non-linear career trajectories (founder $\rightarrow$ advisor $\rightarrow$ operating partner).
  - Dense quantitative metrics (currencies across INR, USD, EUR, team scales, conversion lifts).
  - Explicit non-traditional structures (board seats, advisory positions, consulting projects).

### C. Truth Freezing Invariant
Reference truth must be cryptographically locked before execution commences. Modifying reference truth fixtures after observing model outputs constitutes an immediate invalidation of the certification run.

---

## Step 4: Pre-Register Pass/Fail Thresholds & Explicit Rationales

Before executing the blind validation suite, the following quantitative certification gates must be committed immutably to `docs/transition/CURRENT_BATCH.json`.

### A. Certification Thresholds Table

| Metric Category | Target Invariant | Certification Threshold | Requirement Class |
| :--- | :--- | :--- | :--- |
| **High-Risk False Affirmatives** | Zero tolerance on refuted or unentailed claims | **$0$ across entire blind role population** | Safety Requirement |
| **Polarity Inversion Errors** | Zero negated claims asserted as affirmative | **$0$ negated-to-affirmative promotions** | Safety Requirement |
| **Subject / Applicability Errors** | Zero candidate prerequisites leaked to role authority | **$0$ prerequisite-to-authority violations** | Safety Requirement |
| **Typed Reference Recall** | Substantial superiority over Deterministic V1 | **$\ge 50.0\%$ overall** ($>15\%$ gain over V1) | Comparative Requirement |
| **Long-Document Typed Recall** | Robustness on long documents ($>20\text{k}$ chars) | **$\ge 35.0\%$ on long-document stratum** | Comparative Requirement |
| **Insufficient-Evidence Capture Rate** | Explicit capture of absent/silent authority | **$\ge 90.0\%$ capture on silent high-risk dimensions** | Comparative Requirement |
| **Candidate Metric Token Fidelity** | Exact numerical token retention | **$\ge 90.0\%$ numeric/currency fidelity** | Comparative Requirement |
| **Candidate Chronology Binding** | Correct position-to-employer attribution | **$\ge 90.0\%$ employer-role binding accuracy** | Comparative Requirement |
| **Candidate Span Provenance** | Zero hallucinated text offsets | **$100\%$ byte/character offset provenance** | Safety Requirement |
| **End-to-End Extraction Latency** | Production cloud container SLA | **$\le 15.0\text{s}$ per document (P95)** | Operational Budget |
| **Token Cost Economy** | Cloud operational budget | **$\le \$0.04$ per processed document** | Operational Budget |

### B. Explicit Threshold Derivation & Rationale

#### 1. Normative Safety Requirements
- **High-Risk False Affirmative Assertions ($0$)**: Zero tolerance. Improperly asserting an executive authority (such as unentailed P&L ownership, false board reporting, or fabricated founder proximity) is fundamentally fatal to executive matching. Allowing $\le 1$ created a severe tolerance asymmetry against polarity and applicability violations. With the High-Risk Semantic Verifier active, all unentailed or refuted propositions on high-risk dimensions must evaluate to `CONTRADICTED` or `INSUFFICIENT`, resulting in zero affirmative false assertions across the entire blind population.
- **Polarity Inversions ($0$)**: Asserting an explicitly negated constraint (e.g., *"Does not hold P&L responsibility"* or *"No board interaction"*) as an affirmative executive mandate directly corrupts executive matching decisions. Zero-tolerance is a non-negotiable safety invariant.
- **Subject / Applicability Errors ($0$)**: Promoting a candidate requirement (e.g., *"Must have managed \$50M budget in prior roles"*) into an affirmative role authority (e.g., *"Role commands \$50M budget"*) manufactures phantom scale and distorts role seniority. Zero-tolerance preserves the structural prerequisite wall.
- **Candidate Span Provenance ($100\%$)**: Every candidate claim and proof node must resolve to verified character offsets within the source resume document. Zero tolerance for hallucinated spans.

#### 2. Empirical Comparative Requirements (vs Deterministic V1 Baseline)
- **Typed Reference Recall ($\ge 50.0\%$)**: In Gate 1B empirical benchmarking across 21 documents, Deterministic V1 achieved 32.4% typed recall, whereas rich proposition architectures (C and D) achieved 51.4%–52.7%. The $\ge 50.0\%$ threshold requires an absolute $\ge +17.6\%$ recall lift over V1, ensuring the hybrid architecture delivers its empirical value proposition on unseen text.
- **Long-Document Typed Recall ($\ge 35.0\%$)**: On documents exceeding 20,000 characters, Deterministic V1 collapsed to 22.2% recall, and 8k-capacity LLM collapsed to 5.6%. Expanding output capacity to 65k restored recall to 38.9%. The $\ge 35.0\%$ threshold empirically verifies that token truncation and long-document degradation remain permanently solved.
- **Insufficient-Evidence Capture Rate ($\ge 90.0\%$)**:
  $$\text{Insufficient-Evidence Capture Rate} = \frac{|\{d \in \mathcal{D}_{\text{HR\_SILENT}} : \text{Pipeline emits } \texttt{UNKNOWN} \text{ or blocks affirmative assertion}\}|}{|\mathcal{D}_{\text{HR\_SILENT}}|}$$
  where $\mathcal{D}_{\text{HR\_SILENT}}$ is the set of all high-risk semantic dimensions (across all 8 high-risk categories for all blind documents) where the underlying source text contains genuinely insufficient or silent evidence. Threshold is $\ge 90.0\%$. In at least 90% of instances where evidence is absent, the pipeline must explicitly surface the dimension as `UNKNOWN` rather than manufacturing an affirmative or speculative claim.
- **Candidate Metric Token Fidelity ($\ge 90.0\%$) & Chronology Binding ($\ge 90.0\%$)**:
  On tested reference resumes, Deterministic V1 achieved 7/8 metric retention and 5/9 employer bindings without span hallucinations, while direct LLM dropped numbers from 4 claims. Setting explicit $\ge 90.0\%$ numerical and chronological accuracy bars ensures that the deterministic candidate pipeline maintains strict fidelity before production certification.

#### 3. Operational Target Budgets (Product SLOs)
- **P95 Latency ($\le 15.0\text{s}$)**: Classified as a **Product Ingestion SLO Target**. In asynchronous batch enrichment, maintaining a P95 extraction latency under 15.0s prevents worker queue congestion, bounds memory retention under concurrent worker execution, and ensures responsive ingestion throughput across scraped portals. It is an operational SLA target, rather than a derived runtime invariant of scraper lease parameters.
- **Cost per Document ($\le \$0.04$)**: Classified as a **Product / Operational Target Budget (SLO)**. Current standard Gemini 2.5 Flash pricing is $\$0.30 / 1\text{M}$ input tokens and $\$2.50 / 1\text{M}$ output tokens, with internal reasoning / thought tokens billed at the output rate. In prior unbounded runs, rich proposition extraction plus thinking tokens generated ~15,000–25,000 output/thought tokens per document ($\sim\$0.04–\$0.06$ in output billing alone). Therefore, the $\$0.04/\text{doc}$ ceiling is not a passive artifact of nominal pricing, but a strict operational budget. Satisfying it requires Batch 06 implementation engineering to enforce disciplined thinking budgets (`thinkingConfig.thinkingBudget`), concise prompt structures, and payload optimization to keep per-document extraction economically viable at scale.

### C. Pre-Registered Failure Classification & Consequence Table

To prevent post-hoc rationalization of test results, the failure consequence is classified upfront:

| Failure Category | Specific Metric Trigger | Classification | Governing Action / Consequence |
| :--- | :--- | :--- | :--- |
| **Fatal High-Risk Assertion** | $> 0$ High-Risk False Affirmatives | **ARCHITECTURE-FALSIFYING** | Immediate Halt. Falsifies assumption that semantic verifier can prevent ungrounded executive claims. Reopen architecture decision. |
| **Fatal Polarity Leak** | $> 0$ Polarity Inversions (Negated $\rightarrow$ Affirmed) | **ARCHITECTURE-FALSIFYING** | Immediate Halt. Falsifies multi-channel polarity architecture. Reopen architecture decision. |
| **Fatal Boundary Leak** | $> 0$ Applicability Inversions (`CANDIDATE_REQUIREMENT` $\rightarrow$ `ROLE`) | **ARCHITECTURE-FALSIFYING** | Immediate Halt. Falsifies structural admission prerequisite wall. Reopen architecture decision. |
| **Fatal Provenance Failure** | $< 100\%$ Candidate Span Provenance (any hallucinated span) | **ARCHITECTURE-FALSIFYING** | Immediate Halt. Falsifies zero-hallucination provenance invariant. Reopen architecture decision. |
| **Recall Catastrophe** | Overall Typed Recall $< 40.0\%$ | **ARCHITECTURE-FALSIFYING** | Immediate Halt. Falsifies assumption that rich propositions unlock executive recall over deterministic baseline ($32.4\%$). Reopen architecture decision. |
| **Long-Doc Truncation** | Long-Doc Typed Recall $< 25.0\%$ | **ARCHITECTURE-FALSIFYING** | Immediate Halt. Falsifies output capacity / segmentation scaling on realistic postings. Reopen architecture decision. |
| **Candidate Integrity Collapse** | Candidate Metric Fidelity $< 80\%$ OR Binding $< 80\%$ | **ARCHITECTURE-FALSIFYING** | Immediate Halt. Falsifies integrity of candidate deterministic lineage. Reopen candidate architecture decision. |
| **Marginal Recall Deficit** | $40.0\% \le \text{Typed Recall} < 50.0\%$ | **IMPLEMENTATION-TUNABLE** | Permitted 1 bounded tuning cycle: calibrate canonical type projection rules or prompt few-shots. Re-evaluate once on secondary holdout set. |
| **Insufficient-Evidence Slump** | $80.0\% \le \text{Insufficient-Evidence Rate} < 90.0\%$ | **IMPLEMENTATION-TUNABLE** | Permitted 1 bounded tuning cycle: adjust verifier entailment sensitivity or default fallback rules. |
| **Marginal Candidate Variance** | $80.0\% \le \text{Metric / Chronology Accuracy} < 90.0\%$ | **IMPLEMENTATION-TUNABLE** | Permitted 1 regex/pattern refinement cycle in deterministic candidate extractor. |
| **Operational Budget Exceeded** | P95 Latency $> 15.0\text{s}$ OR Cost $> \$0.04$/doc | **IMPLEMENTATION-TUNABLE** | Permitted 1 engineering remediation cycle: optimize parallelization, payload compression, or batch chunking. |

*Rule: An architecture-falsifying failure terminates Batch 06 immediately. Implementation-tunable failures permit exactly ONE documented remediation cycle before final certification vote.*

---

## Step 5: Run Once, Score Once

1. **Pre-Run Hash Verification**: Confirm that the SHA-256 hashes of the blind population manifest and independent reference truth fixtures match the frozen hashes committed in Step 3.C.
2. **Blind Execution**: Run the frozen candidate extraction pipeline strictly once across all blind role and candidate documents.
3. **Deterministic Baseline Dual Run**: Concurrently run frozen `RoleIntelligenceExtractorV1` and `CandidateProofExtractorV1` on the identical corpus.
4. **Scoring**: Evaluate against the frozen independent human reference truth using the hashed Step 1 evaluator.
5. **Result Determination**:
   - If ALL Step 4 thresholds are met $\rightarrow$ **PASS** $\rightarrow$ Proceed to Step 6.
   - If an ARCHITECTURE-FALSIFYING threshold is breached $\rightarrow$ **FAIL** $\rightarrow$ Stop immediately. Core architectural assumption is falsified. Reopen architecture decision.
   - If only IMPLEMENTATION-TUNABLE thresholds are breached $\rightarrow$ Execute the single permitted remediation cycle per Section 4.C. If remediation fails $\rightarrow$ **FAIL**. Stop and report to governance.

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
