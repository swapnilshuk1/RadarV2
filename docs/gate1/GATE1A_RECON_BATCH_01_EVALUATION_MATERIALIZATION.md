# Gate 1A Recon — Batch 01: Evaluation → Canonical Materialization

Status: **OBSERVED / PARTIAL RECON**  
Gate: **1 of 3**  
Scope of this batch: evaluation worker, engine orchestration, canonical evaluation payload, dossier presentation materialization/storage.  
No production behavior changed in this batch.

## Why this batch exists

Gate 1A is being executed in deliberately small reviewable batches. This document records only conclusions supported by the code inspected in this batch. It is not a declaration that the whole RADAR pipeline has been mapped.

## Files inspected

- `src/lib/intelligence/EvaluationWorker.ts`
- `src/lib/intelligence/engine.ts`
- `src/lib/intelligence/evaluation/PayloadMapper.ts`
- `src/lib/domain/evaluation_payloads.ts`
- `src/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer.ts`
- `src/lib/intelligence/editorial/EditorialIntelligenceContractBuilder.ts` (partial inspection in this batch; full editorial audit deferred)
- `src/lib/domain/dossier_presentation.ts`
- `src/data/sqlite/repositories/SqliteDossierPresentationStore.ts`

## 1. Observed runtime path

For an evaluable job, the current worker path is:

```text
EvaluationWorker.processJob
  ↓
resolve immutable EvaluationContext
  ↓
resolveExactCandidateProjectionForScope(profileVersion)
  ↓
validateCandidateProjection
  ↓
runEngineSingleIntrinsic
  ↓
runEngineSingle
  ↓
runEngine
  ↓
EvidenceGate
  ↓
JobProjectionBuilder.build
  ↓
IdentityAssessmentEngine
CapabilityAssessmentEngine
OpportunityAssessmentEngine
CareerAssessmentEngine
LifestyleAssessmentEngine
CareerValueEngine
ShortlistingPotentialCalculator
  ↓
DecisionPolicyEngine
  ↓
RecommendationRecord
  ↓
present(...)
  ↓
runEngineSingleIntrinsic reconstructs EvaluationArtifact
  ↓
EvaluationWorker augments jobProjection with presentation evidence
  ↓
buildCanonicalEvaluatedPayload
  ↓
materializeCanonicalPayload
  ↓
buildEvaluatedPresentationV2
  ↓
transaction:
  materialized_evaluations
  + materialized_dossier_presentations
  + evaluation job completion
  + requirement satisfaction
```

Unavailable paths fail closed into canonical unavailable evaluation payloads. A missing candidate projection is persisted as `NOT_EVALUABLE`, rather than evaluated against a synthetic/default candidate.

## 2. Strong existing boundaries worth preserving

### 2.1 Immutable evaluation identity is already explicit

The worker binds evaluation to:

- tenant
- person
- canonical job
- opportunity version
- evaluation context fingerprint
- profile version
- policy version
- ontology version/fingerprint

The candidate projection is resolved by the exact profile version pinned in the evaluation context.

### 2.2 Canonical evaluation persistence is versioned and fail-closed

`PayloadMapper` produces only validated `v4.3` evaluated/unavailable payloads. An evaluated payload requires:

- an allowed decision (`PURSUE | CONSIDER | PASS`)
- finite score in `[0,100]`
- valid diligence state
- exact intrinsic job projection
- complete evaluation provenance

Invalid/incomplete artifacts resolve to non-advisory states rather than being silently converted to recommendations.

### 2.3 Evaluation and presentation are persisted as separate artifacts

The worker persists:

1. `materialized_evaluations` — canonical evaluation truth; and
2. `materialized_dossier_presentations` — a separately versioned presentation artifact.

`SqliteDossierPresentationStore` enforces exact identity and exact nullable source-evaluation fingerprint matching. This is a useful boundary and should be retained unless later recon finds a concrete reason to replace it.

### 2.4 Dossier V2 already has proposition-level provenance structure

`CanonicalDossierPresentationV2` validates proposition kinds and provenance references:

- `EMPLOYER_FACT`
- `CANDIDATE_FACT`
- `CANONICAL_EVALUATION`
- `RADAR_INFERENCE`
- `EVIDENCE_LIMITATION`

It also requires role/candidate/canonical signal IDs appropriate to each proposition kind. This is materially closer to the target `DossierPlan` architecture than the historical free-form brief path.

## 3. Architectural coupling discovered

### 3.1 `runEngineSingleIntrinsic` is not actually presentation-independent

Despite its name, `runEngineSingleIntrinsic` currently calls `runEngineSingle`, which calls `runEngine`. `runEngine` does the evaluator work **and then calls `present(...)` for every produced record**. `runEngineSingleIntrinsic` subsequently pulls the `record` and `opportunity` back out of the resulting `Presented` object and separately rebuilds the job projection.

So the effective dependency is currently:

```text
worker intrinsic evaluation
  → evaluator
  → presenter
  → Presented
  → reconstruct EvaluationArtifact
```

rather than:

```text
worker intrinsic evaluation
  → evaluator artifact
  → optional presenter downstream
```

This is a real separation-of-concerns issue. It does **not** mean canonical persistence is currently wrong; the worker still validates/materializes canonical v4.3 truth. It means the evaluator orchestration is unnecessarily coupled to a presentation path and should be considered for refactoring in Gate 1/2.

### 3.2 `engine.ts` mixes several generations of responsibility

The same module currently contains:

- browser/localStorage opportunity fixture handling;
- fixture/corpus injection APIs;
- evaluation caching;
- EvidenceGate;
- job projection construction;
- all assessment-engine invocation;
- shortlisting calculation;
- DecisionPolicyEngine invocation;
- RecommendationRecord construction;
- comparative queue ranking;
- presentation generation.

The future transition should not blindly discard the underlying engines, but this orchestration surface is too broad to be the long-term canonical intelligence boundary.

### 3.3 Canonical decision trace is a useful seed, but not yet the target evidence graph

`CanonicalDecisionTraceV1` already defines relationships and components. However, the current mapper collapses every accepted evaluator mapping to:

```text
relationship = MATCH
basis = EVALUATOR
```

although the domain type permits `MATCH | ADJACENT | GAP | UNKNOWN`.

It also omits evaluator relationship confidence/reason from the persisted trace. Decision-driver/risk components are persisted with empty `evidenceIds`.

Therefore the current trace is **not sufficient as the future `RoleCandidateEvidenceGraph` or `EvaluationSnapshot`**, but it is important prior art and should likely be evolved/reused rather than ignored.

### 3.4 Canonical v4.3 evaluation payload is intentionally narrower than future dossier needs

The evaluated payload currently persists:

- canonical identity/provenance
- decision
- score
- diligence status
- job projection
- optional decision trace

It does **not** persist the complete set of intermediate assessments or an explicit structured representation of:

- identity assessment
- capability assessment
- career-value/trajectory assessment
- lifestyle/friction assessment
- ranked decision drivers with grounded evidence
- explicit unresolved uncertainties
- decision hinges
- pursuit strategy

Today the worker can still create dossier presentation because `buildEvaluatedPresentationV2` is invoked **in-process while the full evaluation artifact and candidate projection remain available**.

This distinction matters for the target architecture: if `DossierPlan` is to be a durable, canonical downstream input rather than a transient worker-only derivation, later gates must determine which evaluation semantics should become explicit persisted outputs.

## 4. Important discovery: a newer dossier path already exists

The codebase is not simply using the historical `BriefCompositionEngine` path described in earlier architecture work.

The worker currently calls:

```text
buildEvaluatedPresentationV2
  → buildEditorialIntelligenceContract
  → composeEditorialIntelligenceV2
  → CanonicalDossierPresentationV2
```

and stores that artifact through `SqliteDossierPresentationStore`.

This means Gate 1 must compare the proposed `DossierPlan → composition` target against this **existing V2 proposition-based editorial architecture** before proposing a replacement. Rebuilding a parallel dossier-planning stack without auditing this path would be wasteful.

Full inspection of `EditorialIntelligenceContractBuilder` and `EditorialPropositionComposer` is therefore a priority for a later small batch.

## 5. Preliminary reuse classification — only for this batch

| Component | Preliminary classification | Reason |
| --- | --- | --- |
| `EvaluationWorker` identity/context resolution | `REUSE_AS_IS` / minor adaptation likely | Strong immutable scope/version discipline and fail-closed candidate resolution. |
| `PayloadMapper` canonical validation/materialization | `REUSE_WITH_NEW_INPUT_CONTRACT` | Strong canonical boundary; future evaluation payload may need additive structured outputs. |
| `CanonicalEvaluatedPayloadV4_3` | `REUSE_WITH_VERSIONED_EVOLUTION` | Stable truth payload, but too narrow for the complete future reasoning substrate. |
| `CanonicalDecisionTraceV1` | `REUSE_WITH_NEW_INPUT_CONTRACT` | Strong seed for graph provenance, but current relationship semantics are collapsed. |
| Assessment engines | `UNCERTAIN — NEEDS MORE EVIDENCE` | Invoked centrally and appear authoritative, but individual semantics have not yet been audited in this batch. |
| `DecisionPolicyEngine` | `UNCERTAIN — NEEDS MORE EVIDENCE` | Clearly authoritative today, but policy semantics need direct inspection. |
| `engine.ts` orchestration | `REFACTOR_SUBSTANTIALLY` | Mixes evaluation, fixtures/cache, record assembly, comparison, and presentation. |
| `CanonicalDossierPresentationV2` | `REUSE_WITH_NEW_INPUT_CONTRACT` candidate | Provenance-aware and separately persisted; may already implement much of intended DossierPlan boundary. |
| `SqliteDossierPresentationStore` | `REUSE_AS_IS` candidate | Exact version/identity/fingerprint checks and separate presentation truth. |

These classifications are preliminary and may be revised after adjacent-track inspection.

## 6. No implementation decision yet

This batch does **not** authorize:

- changing the evaluator;
- changing v4.3 payload semantics;
- replacing `CanonicalDecisionTraceV1`;
- introducing `RoleCandidateEvidenceGraph` in parallel;
- rewriting dossier composition;
- wiring an LLM extractor;
- altering serving/UI.

The next batches must determine whether existing types/components can be evolved into the target architecture rather than duplicated.

## 7. Next small batch

**Batch 02 — Assessment + policy semantics**

Inspect the actual implementations of:

- `IdentityAssessmentEngine`
- `CapabilityAssessmentEngine`
- `OpportunityAssessmentEngine`
- `CareerAssessmentEngine`
- `CareerValueEngine`
- `LifestyleAssessmentEngine`
- `ShortlistingPotentialCalculator`
- `DecisionPolicyEngine`
- relevant semantic/evidence-match types

Questions to answer:

1. Which judgments are genuinely grounded in authoritative job/candidate projections?
2. Which judgments rely on title/string heuristics, defaults, or synthetic evidence?
3. Does capability matching already represent a usable evidence graph?
4. Which outputs should become the future `EvaluationSnapshot` rather than be recomputed later?
5. Which current policy semantics should be preserved vs separated from evaluation/composition?

Do not start Batch 03 until Batch 02 findings are recorded.