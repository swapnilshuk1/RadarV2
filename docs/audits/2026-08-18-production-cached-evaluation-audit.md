# RADAR V4 — Production Cached Evaluation vs. Live Engine Equivalence Audit

**Document Classification**: Architectural Forensic Audit  
**Date**: 2026-08-18  
**Scope**: Production Data Persistence (Turso Cloud SQLite) vs. Live Recommendation Engine (`runEngine()`)  
**Status**: Completed — Zero Production Code Modified

---

## 1. Executive Summary & Core Answer

### Question:
> *"If we deploy the current RADAR V4 code today without recomputing the existing 5,993 candidate evaluations, which of the certified behavioral changes will actually be visible in production?"*

### Primary Finding:
In production, **all read requests for existing opportunities bypass `runEngine()`** and serve static presentation payloads (`evaluationJson`) pre-computed by `EvaluationWorker` when the database was originally seeded/enriched.

| Behavioral Area | Visible in Production Immediately? | Root Cause / Lineage Evidence |
| :--- | :---: | :--- |
| **Attention Window / Dynamic Headspace** | ❌ **NO** | `applyHeadspaceFilter()` runs only in `runEngine()`. The read-path (`OpportunityService.listForUser`) loads pre-computed `evaluationJson` and calls `computeEffectiveDecision()`, which ignores `candidateProfile.attentionWindow`. |
| **Policy-D Rule Refinements & PASS Explanations** | ❌ **NO** | `DecisionPolicyEngine.evaluate()` is not invoked on cached reads. Frozen rule IDs and verdicts in `candidate_evaluations` are served as-is. |
| **Model C Scoring Weight Changes** | ❌ **NO** | `qualityScore` and `recommendationResult.score` are served from frozen JSON columns. |
| **User Decision Transitions & Review State** | ✅ **YES** | `computeEffectiveDecision()` and `computeReviewWorkflowState` dynamically evaluate on read by combining the static `engineVerdict` with live records from the `decisions` table. |
| **UI Presentation, Layout & Typography** | ✅ **YES** | React components, CSS tokens, and dossier layout templates render fresh client-side code over the loaded JSON. |
| **Newly Scraped (Un-evaluated) JDs** | ✅ **YES** | Opportunities with no existing `(person_id, job_hash)` row in `candidate_evaluations` fall back to `OpportunityService.evaluateSingleOpportunity()` and execute fresh V4 engine code. |

---

## 2. Production Request Routing & Data Lineage

```
========================================================================================================================
                                                PRODUCTION PATH (Turso Cloud)
========================================================================================================================

[Turso Cloud Database]
  ├── opportunities (2,675 rows)
  ├── documents (2,023 rows -> doc.content contains rawText + structured dimensions:[...])
  └── candidate_evaluations (5,993 rows -> pre-computed evaluationJson)
         │
         ▼
[OpportunityService.listForUser()] (src/lib/intelligence/opportunity-service.ts:L151)
         │
         ├─► Query candidate_evaluations via SqliteEvaluationStore.listEvaluationsForUser() (L156)
         │
         ▼
[IF evaluations.length > 0] (5,993 pre-computed records found) ──► O(k) FAST PATH
         │
         ├─► JSON.parse(ev.evaluationJson) (L167)
         ├─► Merge user decision state from decisions table (L172-L193)
         ├─► computeEffectiveDecision(opp.engineRecommendation, userState) (L194)
         ├─► computeReviewWorkflowState(opp.engineRecommendation, userState) (L195)
         └─► Return Opportunity[] directly to UI (BYPASSES live runEngine)

------------------------------------------------------------------------------------------------------------------------
 Background Enrichment Path (How candidate_evaluations was populated in Turso):
 [EvaluationWorker.processNextJob()] (src/lib/intelligence/workers/EvaluationWorker.ts:L36)
   └─► OpportunityService.evaluateSingleOpportunity() (opportunity-service.ts:L373)
         └─► runEngineSingle(jobHash, projection, 0, [oppSource])  <-- Note: activePursuits is hardcoded to 0
               └─► saveEvaluation() into Turso candidate_evaluations
========================================================================================================================
```

### Request Endpoint Audit

| Endpoint / Function | File & Line Reference | Data Source | Invokes `runEngine()`? |
| :--- | :--- | :--- | :---: |
| **`getOpportunitiesFn`** (Dashboard / Queue) | [`opportunity-service.ts:L165-L198`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/opportunity-service.ts#L165-L198) | `candidate_evaluations.evaluationJson` | ❌ **NO** ($O(k)$ Read Path) |
| **`getOpportunityFn`** (Dossier View) | [`opportunity-service.ts:L318-L338`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/opportunity-service.ts#L318-L338) | `candidate_evaluations.evaluationJson` | ❌ **NO** (If record exists) |
| **`getNeighboursFn`** (Prev/Next Links) | [`opportunity-service.ts:L346-L352`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/opportunity-service.ts#L346-L352) | `candidate_evaluations` | ❌ **NO** |
| **`getShortlistMetricsFn`** (Top Metrics) | [`SqliteEvaluationStore.ts:L205-L241`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteEvaluationStore.ts#L205-L241) | `candidate_evaluations` + `decisions` | ❌ **NO** (SQL Aggregation) |
| **`getQueueMetricsFn`** (Queue Index) | [`SqliteEvaluationStore.ts:L268-L285`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteEvaluationStore.ts#L268-L285) | `candidate_evaluations` | ❌ **NO** |
| **`getDecidedOpportunitiesFn`** (Ledger) | [`opportunity-service.ts:L20-L22`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/opportunity-server.ts#L20-L22) | `candidate_evaluations` + `decisions` | ❌ **NO** |
| **`getOpportunityFn`** (Uncached Miss) | [`opportunity-service.ts:L341-L343`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/opportunity-service.ts#L341-L343) | `evaluateSingleOpportunity()` | ✅ **YES** (Single Opp fallback) |
| **`EvaluationWorker.processNextJob`** | [`EvaluationWorker.ts:L36-L59`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/workers/EvaluationWorker.ts#L36-L59) | `evaluateSingleOpportunity()` | ✅ **YES** (Background Daemon) |

---

## 3. Forensic Analysis of Key Architectural Invariants

### 1. Which fields from `evaluationJson` are returned to the UI?
When `OpportunityService.listForUser()` or `getForUser()` loads `ev.evaluationJson`, it parses the `Opportunity` presentation DTO and applies runtime combinators:

```ts
// src/lib/intelligence/opportunity-service.ts:L191-L197
return {
  ...opp, // Static presentation payload baked at enrichment time
  userDecision: userState, // Freshly fetched from `decisions` table
  effectiveDecision: computeEffectiveDecision(opp.engineRecommendation || ({} as any), userState),
  reviewWorkflowState: computeReviewWorkflowState(opp.engineRecommendation || ({} as any), userState),
  decision: userState?.userAction ? userState.userAction : ev.effectiveDecision,
} as Opportunity;
```

#### Inherited (Frozen) Fields from Cache:
- `recommendation` (Editorial headline prose)
- `whyNow`, `positioning`, `primaryProof`, `headspaceInvestment`, `headspace`, `hiringRisk`, `alternativePath`
- `recommendationResult` (`score`, `decision`, `policyId`, `policyVersion`, `explanation`, `capabilities`, `decisionConfidence`, `vetoed`, `vetoReason`)
- `engineRecommendation` (`jobHash`, `evaluationFingerprint`, `engineVerdict`, `vetoed`, `vetoReason`, `qualityScore`, `parsingConfidence`, `evaluatedAt`, `triggeredRuleIds`, `decisionRisks`, `decisionDrivers`, `relativeDifferentiator`, `opportunityScoreConfidence`, `opportunityScoreSource`, `trajectoryUpside`)
- `displayScore`, `uiBadge`, `recommendedAction`, `diligenceStatus`, `esi`

### 2. Do `RecommendationRecord.trace.verb0`, `trace.finalVerb`, and `trace.headspace` exist in persisted evaluations?
* **NO.**
* `EvaluationWorker` stores `JSON.stringify(recommendation)`, where `recommendation` is `single.opportunity` returned by `OpportunityService.evaluateSingleOpportunity()`.
* The internal `RecommendationRecord.trace` object (`trace.verb0`, `trace.finalVerb`, `trace.headspace`, `trace.pipeline`, `trace.shortlistingPotentialCalculation`) is stripped by `present()` and is **not** included in the serialized presentation DTO.

### 3. Is Attention Window reapplied after a cached `RecommendationRecord` is loaded?
* **NO.**
* `OpportunityService.listForUser()` calls `computeEffectiveDecision(opp.engineRecommendation, userState)`.
* `computeEffectiveDecision()` is a pure combinator between `engineVerdict` (`"PURSUE"` / `"CONSIDER"` / `"PASS"`) and `userAction`. It **never calls `buildHeadspace()` or `applyHeadspaceFilter()`**.

### 4. Does changing `candidateProfile.attentionWindow` change production output for an already-cached evaluation?
* **NO.**
* Cached evaluations bypass `runEngine()`, and `computeEffectiveDecision()` does not inspect `attentionWindow`.

### 5. Does changing `DecisionPolicyEngine` code change output for an already-cached evaluation?
* **NO.**
* `DecisionPolicyEngine.evaluate()` is not invoked on cached read requests.

### 6. Does changing Model C weights change output for an already-cached evaluation?
* **NO.**
* `qualityScore` and `displayScore` are loaded statically from `candidate_evaluations`.

### 7. What causes a `candidate_evaluations` row to be invalidated/recomputed?
A row in `candidate_evaluations` is recomputed **only if**:
1. An explicit background job is enqueued into `evaluation_jobs` via `SqliteEvaluationStore.enqueueJob()` and processed by `EvaluationWorker.processNextJob()`.
2. A database script or migration explicitly drops or deletes rows (e.g. `rebuild-read-models.ts`).
3. An uncached opportunity is requested via `OpportunityService.getForUser()`.

> [!WARNING]
> `OpportunityService.listForUser()` contains **no automatic staleness or input-hash invalidator**. If a row exists in `candidate_evaluations`, it is served indefinitely.

### 8. What version metadata is stored with evaluations?
- **SQL Columns in `candidate_evaluations`**: `policy_version` (e.g. `"v4.1"`), `evaluation_input_hash` (32-bit integer string), `updated_at`.
- **In `evaluationJson`**: `engineRecommendation.evaluationFingerprint` (`"1.0.0:<jobHash>:<verb>"`), `recommendationResult.policyVersion`.
- **Missing Metadata**: No stored Git commit hash, no individual dimension schema version, and no engine rule-set checksum.

### 9. Architectural Classification of `candidate_evaluations`
`candidate_evaluations` operates as a **Materialized Read Model with Frozen Presentation DTOs**. It acts as an authoritative serving store in production, bypassing the domain computation layer entirely.

---

## 4. Field-by-Field Diff: Live `runEngine()` vs. Persisted `candidate_evaluations`

| Field / Dimension | Path A: Live `runEngine()` | Path B: Persisted `candidate_evaluations` (Production) | Equivalence Status |
| :--- | :--- | :--- | :---: |
| **`jobHash`, `role`, `company`, `location`** | Parsed from `OpportunitySource` | Read from `evaluationJson` | 🟢 Identical |
| **`qualityScore` (Model C)** | Live continuous computation ($0..100$) | Frozen number from `ce.quality_score` | 🟡 Stale if weights changed |
| **`engineVerdict`** | Live policy evaluation | Frozen string from `ce.engine_verdict` | 🟡 Stale if rules changed |
| **`effectiveDecision`** | Live combinator | Recomputed on read via `computeEffectiveDecision` | 🟢 Dynamic (uses live user decisions) |
| **`reviewWorkflowState`** | Recomputed | Recomputed on read via `computeReviewWorkflowState` | 🟢 Dynamic (uses live user decisions) |
| **`headspace.downgraded`** | Live filter based on `candAttentionWindow` | Frozen narrative string in `evaluationJson` | 🔴 **Diverged** (Bypasses active capacity) |
| **`trace.verb0` / `trace.finalVerb`** | Present in `record.trace` | **Omitted / Stripped** from presentation DTO | 🔴 **Diverged** (Internal trace not cached) |
| **`trace.shortlistingPotentialCalculation`**| Present in `record.trace` | **Omitted / Stripped** | 🔴 **Diverged** (Internal trace not cached) |
| **`triggeredRuleIds`** | Live evaluated rule IDs | Frozen array in `engineRecommendation` | 🟡 Stale if policy rules changed |
| **`dimensions` array** | Parsed from `documents.content` | Stored inside `evaluationJson` | 🟢 Identical (if doc unchanged) |

---

## 5. Audit Conclusion

1. **Equivalence Invariant**: When supplied with identical inputs, live `runEngine()` and production `runEngine()` are deterministic and 100% equivalent.
2. **Serving Divergence**: In production, the 5,993 rows in `candidate_evaluations` act as a frozen materialized snapshot. Any behavioral changes to `DecisionPolicyEngine`, Model C scoring weights, or Attention Window capacity will remain invisible in production until `candidate_evaluations` is re-materialized.
