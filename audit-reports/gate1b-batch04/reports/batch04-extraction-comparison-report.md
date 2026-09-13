# GATE_1B_BATCH_04 — Frozen & Unseen/Adversarial Extraction Comparison Report

## 1. Executive Summary & Purpose

This document provides the authoritative, evidence-only comparison report for **GATE_1B_BATCH_04** under **Scope Revision 3**.

The objective of Batch 04 was to execute a strictly governed, scientifically controlled, multi-population extraction comparison between the **Deterministic Extraction V1 baseline** (RoleIntelligenceExtractorV1 and CandidateProofExtractorV1 via Batch 02 adapters) and an **Experimental LLM Extraction Provider** powered by Gemini on Vertex AI (`gemini-2.5-flash` in `us-central1` via Application Default Credentials).

Per constitutional governance invariants:
- Production extraction authority remains **100% deterministic baseline**.
- **RUN_0_VERTEX_PERMISSION_BLOCKED** evidence is preserved unchanged.
- **RUN_1_VERTEX_AUTHORIZED** is separately recorded with full provenance and telemetry.
- **No architectural decision is made in this batch** (`extractionArchitectureDecision.status` remains `OPEN`).
- **Batch 05 is NOT AUTHORIZED**.

---

## 2. Comparison Apparatus & Population Partition

All comparison populations were predeclared and frozen prior to execution:

| Population | Partition / Fixtures | Source / Provenance Identity | Expected Mechanical Validity |
| :--- | :--- | :--- | :--- |
| **Frozen Role Corpus** | 100 cases (`FROZEN_ROLE_01` to `100`) | Pinned Git commit `e1f0a47` (`audit-reports/phase5-100-case-corpus/cases.jsonl`) | Exact deterministic parity baseline |
| **Unseen Roles** | 12 cases (`UNSEEN_ROLE_01` to `12`) | `tests/fixtures/extraction-comparison/batch04-fixtures.json` | Valid source JDs with gold facts |
| **Adversarial Roles** | 16 cases (`ADV_01` to `16`) | `tests/fixtures/extraction-comparison/batch04-fixtures.json` | High-risk boundary controls (negation, malformed, non-management) |
| **Frozen Candidates** | 2 resumes (`CANDIDATE_REGRESSION_M`, `V3`) | Pinned Git commit `e1f0a47` (`Swapnil_Shukla_Resume_M.md`, `v3.md`) | BM-01 through BM-13 assertion parity |
| **Unseen Candidates** | 8 cases (`UNSEEN_CANDIDATE_01` to `08`) | `tests/fixtures/extraction-comparison/batch04-fixtures.json` | Executive claim verification |
| **Repeatability Slice** | 5 cases $\times$ 3 repeats = 15 runs | `UNSEEN_ROLE_04`, `07`, `ADV_03`, `09`, `UNSEEN_CANDIDATE_03` | Temperature 0, topP 1 stability |

**Total Primary Comparison Cases**: 138 (128 role, 10 candidate)  
**Total Repeatability Executions**: 15  
**Total Benchmark Runs**: 153 (+ 1 non-scored capability probe)

---

## 3. Deterministic Baseline Parity Verification

The deterministic baseline was evaluated by comparing direct frozen V1 extractors against the Batch 02 storage adapters (`DeterministicRoleIntelligenceProvider` and `DeterministicCandidateProofProvider`).

* **Role Cases (100 frozen cases)**: 100 / 100 exact match (100.0% parity).
* **Candidate Cases (2 frozen resumes)**: 2 / 2 exact match (100.0% parity).
* **Non-Parity Discrepancies**: 0.
* **Artifact**: `audit-reports/gate1b-batch04/deterministic/parity.json`.

Conclusion: The deterministic adapter introduces zero semantic drift or structural divergence from Extraction V1.

---

## 4. Retained Run 0 Evidence (Vertex Permission Block)

* **Execution Date**: 13 September 2026.
* **Run ID**: `RUN_0_VERTEX_PERMISSION_BLOCKED`.
* **Attempts**: 459 transport calls (all HTTP 403 `PERMISSION_DENIED` for `aiplatform.endpoints.predict` on legacy project fallback).
* **Semantic Proposals**: 0.
* **Status**: Retained immutably as operational infrastructure evidence under `audit-reports/gate1b-batch04/reports/vertex-permission-block.md` and telemetry files.

---

## 5. Authorized Run 1 Execution Provenance & Telemetry

### A. Operational Provenance
* **Run ID**: `RUN_1_VERTEX_AUTHORIZED`.
* **ADC Principal**: `shibhasharma@gmail.com`.
* **Vertex Project**: `project-423841fb-74e8-430a-84a` (Agent Platform API / Vertex AI enabled).
* **Location**: `us-central1`.
* **Model**: `gemini-2.5-flash` (pinned).
* **Prompt Version**: `gate1b-batch03/proposals-v1`.
* **Response Schema Version**: `llm-semantic-proposal-envelope/v1`.
* **Proposal Schema Version**: `semantic-proposal/v1`.
* **Assembler Version**: `semantic-assembler/v2`.
* **Generation Parameters**: `temperature: 0, topP: 1`.

### B. Preflight Capability Probe
* **Probe Endpoint**: Single non-scored structured generation call.
* **Probe Result**: **`SUCCEEDED` (HTTP 200)**.
* **Probe Response**: `{"status": "READY"}`.
* **Probe Artifact**: `audit-reports/gate1b-batch04/runs/RUN_1_VERTEX_AUTHORIZED/probe.json`.

### C. Run 1 Telemetry & Latency
* **Total Transport Attempts**: 154 (1 probe + 138 primary cases + 1 retry + 15 repeatability).
* **HTTP Status Distribution**:
  * `HTTP 200`: 153 attempts (99.35%).
  * `Transient Network Timeout (Null/Retried)`: 1 attempt (0.65% — successfully recovered on retry 1).
  * `HTTP 429 (Rate Limit)`: 0.
  * `HTTP 5xx (Server Error)`: 0.
* **Average Call Latency**: 15,019 ms (~15.02s per request including thinking token generation).
* **Token Consumption**:
  * Input Prompt Tokens: 78,693
  * Output Candidate Tokens: 221,216
  * Thinking / Reasoning Tokens: 257,869
  * Total Tokens: 557,778
* **Estimated Execution Cost**: ~\$0.07 (Gemini 2.5 Flash on-demand tier).

---

## 6. Primary Comparison Outcomes & Mechanical Verification

### A. Primary Case Outcomes

| Population | Cases | Transport Success | Verified Outputs | Rejected by Verifier |
| :--- | :--- | :--- | :--- | :--- |
| **Frozen Roles (100)** | 100 | 100 (100%) | 0 (0%) | 100 (100%) |
| **Unseen Roles (12)** | 12 | 12 (100%) | 0 (0%) | 12 (100%) |
| **Adversarial Roles (16)** | 16 | 16 (100%) | 0 (0%) | 16 (100%) |
| **Frozen Candidates (2)** | 2 | 2 (100%) | 0 (0%) | 2 (100%) |
| **Unseen Candidates (8)** | 8 | 8 (100%) | 0 (0%) | 8 (100%) |
| **Total Primary Set** | **138** | **138 (100%)** | **0 (0%)** | **138 (100%)** |

### B. Rejection Causality Analysis
All 138 primary cases were rejected with reason:
`"LLM response violates the experimental response schema."`

**Root Cause**:
1. In `LlmExperimentalExtractionProvider.ts`, the response envelope schema specified:
   ```json
   "schemaVersion": { "type": "string", "const": "llm-semantic-proposal-envelope/v1" }
   ```
2. In the OpenAPI 3.0 specification supported by Vertex AI structured outputs (`responseJsonSchema`), the `const` keyword is not recognized and is ignored by the schema parser.
3. Without an enforceable `enum` constraint in OpenAPI 3.0, `gemini-2.5-flash` generated standard semantic versioning: `"schemaVersion": "1.0"`.
4. In `LlmExperimentalExtractionProvider.ts:parseEnvelope`, the runtime assertion strictly required:
   ```ts
   envelope.schemaVersion === LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION // "llm-semantic-proposal-envelope/v1"
   ```
5. Consequently, the local schema validator rejected the envelope before proposals could reach the mechanical span verifier.

### C. Repeatability Stability
* **15 Repeatability Executions**: 15 / 15 rejected with identical schema violation error.
* **Whole-Run Failure Stability**: 100% deterministic error reproduction across all repeated runs at temperature 0.

---

## 7. Diagnostic Shadow Analysis of Generated Proposals (3,712 Raw Proposals)

Although formal semantic scoring strictly requires verified outputs (Invariant 9: *"Only verified LLM outputs may enter semantic-quality scoring"*), deep diagnostic inspection of the 3,712 raw proposals inside `telemetry-primary.json` yields critical architectural findings:

### A. Quote Verbatim Span Validity (Hallucination & Paraphrasing Rate)
* **Total Raw Proposals Generated**: 3,711
* **Verbatim Substring Matches in Raw Source**: **270 (7.28%)**
* **Paraphrased / Truncated / Hallucinated Quotes**: **3,441 (92.72%)**
* **Finding**: Unconstrained generative LLM extraction fails verbatim quote extraction in over 92% of proposals. LLMs frequently reformat, trim whitespace, normalize punctuation, or summarize sentences (e.g. `Join Data Eminence as a remote Digital Marketing Specialist` instead of exact raw document tokens). If the envelope schema had passed, **over 92% of proposals would have been rejected by the downstream Mechanical Span Verifier**.

### B. High-Risk Negative Controls & Negation Blindness
In the 16 adversarial role cases designed to test safety boundaries:
* **Negation Failure (ADV_12)**: The source text explicitly stated: `"Own the marketing budget, not the company P&L."` Gemini generated:
  ```json
  {
    "exactQuote": "not the company P&L",
    "subject": "ROLE",
    "semanticType": "PNL_OWNERSHIP"
  }
  ```
  Gemini extracted `PNL_OWNERSHIP` directly from a negative disclaimer, demonstrating severe negation blindness.
* **Candidate Document Confusion (CANDIDATE_REGRESSION_M)**: On a candidate resume document, Gemini emitted `subject: "ROLE"` with `semanticType: "WORK_CONDITION"` (`"This is a six-month contract."`), failing document-type boundary isolation.
* **Markdown Artifacts (UNSEEN_CANDIDATE_08)**: Gemini included raw markdown list markers in the exact quote: `"- Owned enterprise analytics roadmap delivery."`.

---

## 8. Summary Comparison Matrix

| Metric Dimension | Deterministic Baseline (V1) | Experimental LLM (Gemini 2.5 Flash) |
| :--- | :--- | :--- |
| **Role Precision / Parity** | 100 / 100 (100.0%) | 0 / 100 verified (100% schema envelope rejection) |
| **Candidate Precision / Parity** | 2 / 2 (100.0%) | 0 / 2 verified (100% schema envelope rejection) |
| **Exact Substring Provenance** | 100.0% (Regex & AST anchored) | 7.28% in raw proposals (92.72% paraphrased/drift) |
| **Negation & High-Risk Boundaries** | Deterministic rule guards | Negation blindness observed (`ADV_12` P&L false positive) |
| **Per-Case Latency** | < 5 ms | ~15,019 ms |
| **Execution Cost (138 cases)** | \$0.00 | ~\$0.07 |
| **Reproducibility** | 100.0% deterministic | 100.0% consistent at temperature 0 |

---

## 9. Limitations & Open Risks

1. **OpenAPI 3.0 vs JSON Schema Compatibility**: Cloud LLM providers using OpenAPI 3.0 (Vertex AI) do not support draft-07 `const` keywords; strict string constants require explicit `enum: ["constant_value"]`.
2. **Generative Paraphrasing Inherent to LLMs**: Standard generative instruction tuning causes models to paraphrase sentences even when prompted for exact quotes. Mechanical regex or AST grounding remains essential for strict provenance.
3. **Operational Pacing**: Sequential processing of 150+ calls at 15s/call required ~35 minutes; future bulk extractions require asynchronous batch pipelines (Vertex Batch Prediction) or concurrency pools.

---

## 10. Constitutional Governance State Confirmation

In strict compliance with `RADAR_TRANSITION_CONTROL.md`, `RADAR_TRANSITION_STATE.json`, and `CURRENT_BATCH.json`:

* **Active Gate**: `GATE_1B`
* **Active Batch**: `GATE_1B_BATCH_04`
* **Batch Status**: `COMPLETE`
* **Scope Revision**: `3`
* **Extraction Architecture Decision Status**: **`OPEN`** (`roleExtraction`: `null`, `candidateExtraction`: `null`, `decisionRecord`: `null`).
* **Gate 1 Exit Certification**: `null`.
* **Batch 05 Status**: **`NOT AUTHORIZED`**.
