# Gate 1A Recon — Batch 03: V2 Editorial Proposition Pipeline

Status: **OBSERVED / PARTIAL RECON**  
Gate: **1 of 3**  
Scope of this batch: evaluated dossier materialization, editorial intelligence contract, proposition composition, dossier V2 validation/provenance.  
No production behavior changed in this batch.

## Why this batch exists

Batch 01 found that RADAR already has a newer proposition-based dossier path:

```text
buildEvaluatedPresentationV2
  → buildEditorialIntelligenceContract
  → composeEditorialIntelligenceV2
  → CanonicalDossierPresentationV2
```

That discovery made it unsafe to introduce a parallel `DossierPlan` abstraction without first understanding what this existing stack already does. Batch 02 then established a likely target split between durable evaluation truth, versioned decision policy, and downstream editorial composition.

This batch therefore asks one narrow architectural question:

> Is the existing V2 editorial contract already the plan-like boundary we need, and if so, what must change before it can become a durable canonical downstream input?

## Files inspected

- `src/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer.ts`
- `src/lib/intelligence/editorial/EditorialIntelligenceContract.ts`
- `src/lib/intelligence/editorial/EditorialIntelligenceContractBuilder.ts`
- `src/lib/intelligence/editorial/EditorialPropositionComposer.ts`
- `src/lib/domain/dossier_presentation.ts`

Batch 01 findings about `EvaluationArtifact`, `present(...)`, canonical v4.3 materialization, and dossier storage are used as adjacent context, but this batch makes no production changes to those paths.

## 1. Observed V2 construction path

The evaluated materializer implements the discovered pipeline directly:

```text
EvaluationArtifact + CandidateProjection
        ↓
buildEditorialIntelligenceContract
        ↓
EditorialIntelligenceContract (v2)
        ↓
composeEditorialIntelligenceV2
        ↓
proposition composition
        ↓
CanonicalDossierPresentationV2
        ↓
validation
        ↓
materialized dossier presentation
```

The materializer carries the evaluation identity/source-evaluation fingerprint through to the dossier artifact and validates the final V2 shape before returning it. This continues the strong separation found in Batch 01 between canonical evaluation truth and separately versioned presentation truth.

## 2. The existing editorial contract already occupies the proposed `DossierPlan` slot

`EditorialIntelligenceContract` is not merely a free-form brief or a bag of display strings. It is a versioned, structured intermediate containing proposition-ready information such as:

- candidate-fit relationships;
- candidate/job evidence references;
- canonical evaluation signal references;
- decision drivers and risks;
- qualification requirements;
- candidate capability/precedent material;
- career-case/positioning material;
- synthesis inputs and support references.

The candidate-fit structure is particularly important. It can carry:

```text
job capability
candidate capability
relationship
source/basis
job evidence IDs
candidate evidence IDs
```

This is already very close to the architectural role previously described as a `DossierPlan`: a normalized, provenance-aware bridge between evaluation/policy outputs and editorial composition.

### Batch 03 decision

**Do not introduce a parallel `DossierPlan` stack.**

The existing `EditorialIntelligenceContract` should be evolved/versioned into that role unless a later batch discovers a serving constraint that makes this impossible.

A rename may eventually be desirable, but introducing a second plan abstraction now would duplicate semantics, provenance machinery, and migration burden.

## 3. Strong parts worth preserving

### 3.1 Canonical relationship consumption is already supported

When the evaluation artifact contains canonical decision-trace relationships, `EditorialIntelligenceContractBuilder` consumes those typed relationships rather than flattening them into prose. It retains relationship semantics, basis/source, job evidence IDs, and candidate evidence IDs.

That is the correct direction for the future evidence-plan boundary.

Batch 01 found that today's persisted trace mapper still collapses accepted evaluator relationships to `MATCH / EVALUATOR`. That is a limitation of the upstream trace materialization, not of the V2 editorial contract's ability to carry richer relationship semantics.

Therefore the contract can benefit directly from a future evolved canonical relation graph without requiring a parallel dossier-planning model.

### 3.2 The composer is principally downstream presentation synthesis

`composeEditorialIntelligenceV2` consumes the reviewed editorial contract. It does not fetch source data, rerun the assessment engines, or independently recalculate the canonical verdict/quality score.

Its substantive synthesis is represented through typed propositions. Most importantly, editorial inference is explicitly represented as `RADAR_INFERENCE` and carries support references back to role evidence, candidate evidence, and/or canonical evaluation signals.

That is a useful boundary:

```text
facts / canonical evaluation
        ↓
plan/contract
        ↓
explicit presentation inference
```

rather than allowing presentation prose to silently become evaluation truth.

### 3.3 The final dossier artifact has meaningful proposition provenance rules

`CanonicalDossierPresentationV2` distinguishes proposition kinds including:

- `EMPLOYER_FACT`
- `CANDIDATE_FACT`
- `CANONICAL_EVALUATION`
- `RADAR_INFERENCE`
- `EVIDENCE_LIMITATION`

The validator requires the appropriate provenance class for factual/canonical/inference propositions. The evaluated materializer also carries the source evaluation fingerprint into the presentation artifact.

This is materially stronger than the historical free-form brief architecture and should be preserved.

## 4. Why the current contract is not yet a clean durable canonical plan

The conclusion above does **not** mean that today's `EditorialIntelligenceContract` should simply be persisted unchanged and declared the final `DossierPlan`.

The builder still depends on transient and legacy-shaped inputs that violate the target separation established in Batches 01 and 02.

### 4.1 It still consumes legacy presentation-derived `artifact.opportunity` fields

The contract builder reads fields from `artifact.opportunity`, including values such as:

- evaluation state;
- verdict fallback;
- score fallback;
- decision rationale;
- recommended action;
- primary risk;
- tradeoff/career-case narrative.

This is strategically important because Batch 01 established that the current intrinsic evaluation path still runs through `present(...)` before `runEngineSingleIntrinsic()` reconstructs the `EvaluationArtifact`.

Therefore part of the supposedly newer editorial contract is still downstream of — and partially dependent on — the legacy presentation-shaped opportunity object.

The effective dependency is currently closer to:

```text
evaluation
  → legacy presenter
  → EvaluationArtifact.opportunity
  → EditorialIntelligenceContractBuilder
  → V2 proposition composer
```

for some contract fields.

That prevents the current contract builder from being considered a clean canonical planning boundary.

### 4.2 Canonical values sometimes have presentation-shaped fallbacks

The builder prefers record/canonical-looking evaluation values in several places, but can fall back to `artifact.opportunity.verdict` and `artifact.opportunity.score`.

A future plan boundary should not have two competing authorities for the same evaluation result. Verdict, quality score, decision state, policy rule IDs, and evaluation uncertainty should come from one durable evaluation/policy snapshot.

Legacy presenter fields may remain temporarily for compatibility, but they should not be authoritative inputs to the vNext editorial contract.

### 4.3 Candidate-fit evidence has a legacy fallback path

When canonical decision-trace relationships are unavailable, the builder can reconstruct candidate-fit evidence from legacy `record.trace.evidenceMapping` data and assign simplified semantics such as:

```text
relationship = MATCH
source = EVALUATOR
```

with weaker/empty job-side provenance in that fallback path.

This is sensible compatibility behavior today, but it is not the target architecture. Once the evolved canonical evaluation contains complete typed role-candidate relationships, the vNext contract should consume that source directly and fail closed or explicitly mark uncertainty rather than silently degrading to a lossy legacy mapping.

### 4.4 The contract mixes normalized plan data with prewritten narrative/editorial strategy

The builder carries or creates fields such as career-case narrative, recommended action, principal risk, positioning angles, and other editorial guidance.

Some of these are legitimate plan-level editorial directives. Others are prewritten strings inherited from the current presenter/record rather than normalized facts or explicit policy outputs.

The durable plan boundary should distinguish at least three classes clearly:

```text
1. canonical facts / relationships / decision signals
2. editorial strategy instructions derived from those signals
3. final natural-language composition
```

Today those layers are closer than they should be.

## 5. Composer responsibility: mostly correct, with one important guardrail

The proposition composer appears suitable as the downstream composition layer if its authority remains deliberately narrow.

It performs presentation-oriented operations such as:

- selecting proposition candidates;
- ordering/ranking them for editorial importance;
- choosing composition modes;
- forming capability-positioning pairs;
- creating employer/candidate/canonical/inference propositions;
- framing risks, bridges, and next moves.

The composer also performs some heuristic editorial classification, including composition-mode selection from the contract. This is acceptable **only while it remains presentation inference**.

The required architectural rule is:

> Composer-derived classification may shape presentation, but must never feed back into canonical evaluation, policy, evidence satisfaction, or persisted business truth unless it is promoted upstream through an explicit versioned evaluator/policy contract.

`RADAR_INFERENCE` is a useful mechanism for enforcing that distinction.

## 6. Provenance is strong structurally, but durable referential integrity still needs confirmation

The V2 dossier validator checks proposition shape and that required reference arrays contain non-empty IDs. For example, employer facts require role evidence references, candidate facts require candidate evidence references, canonical-evaluation propositions require canonical signal references, and RADAR inference requires a support basis.

However, the final `CanonicalDossierPresentationV2` primarily persists the composition plus evaluation identity/fingerprint. It does not embed the entire editorial contract's evidence registries.

That means the current final validation proves **reference presence and proposition shape**, not by itself that every persisted reference can still be resolved to a durable source artifact later.

This may already be guaranteed by adjacent stores/read paths, but that has not been proven in this batch.

A later gate should establish one of the following explicit invariants:

```text
A. every persisted proposition reference is resolvable through durable canonical
   evaluation / candidate / role evidence stores for the lifetime of the dossier;

or

B. the durable plan/presentation embeds enough normalized provenance to resolve
   and audit every proposition independently.
```

Do not add duplicated evidence blobs merely to solve this before the serving/read path is audited.

## 7. `DossierPlan` architecture decision

The Batch 03 evidence is strong enough to narrow the design.

### Do not build this

```text
Canonical Evaluation
        ↓
new parallel DossierPlan
        ↓
new composer
```

alongside the existing editorial stack.

### Evolve this instead

```text
Persisted EvaluationSnapshot / canonical relation graph
        ↓
EditorialIntelligenceContract vNext
  - normalized role/candidate evidence relationships
  - explicit unknowns and evidence limitations
  - canonical decision signals / rule IDs
  - decision drivers, risks, hinges
  - proposition support inventory
  - editorial strategy directives where appropriate
  - NO legacy presenter strings as evaluation authority
        ↓
EditorialPropositionComposer
  - proposition selection
  - ordering
  - phrasing
  - presentation-only RADAR_INFERENCE with explicit support
        ↓
CanonicalDossierPresentationV2 / versioned successor
```

In architectural terms, **`EditorialIntelligenceContract` is the existing DossierPlan-equivalent**. The correct move is versioned evolution and input cleanup, not duplication.

## 8. Reuse classification — Batch 03

| Component | Classification | Reason |
| --- | --- | --- |
| `buildEvaluatedPresentationV2` | `REUSE_WITH_NEW_INPUT_CONTRACT` | Orchestration shape and fingerprint discipline are sound; should ultimately consume durable evaluation/plan inputs rather than a transient artifact carrying legacy presenter state. |
| `EditorialIntelligenceContract` | `REUSE_WITH_VERSIONED_EVOLUTION` | Already occupies the plan-like architectural slot and has structured provenance-aware fields. Needs cleaner canonical inputs and sharper separation of plan data from narrative. |
| `EditorialIntelligenceContractBuilder` | `REFACTOR_SUBSTANTIALLY` | Strong canonical trace/evidence handling, but still reads legacy `artifact.opportunity` presentation fields and legacy evidence-mapping fallbacks. |
| Canonical trace → candidate-fit relationship mapping | `REUSE_WITH_NEW_INPUT_CONTRACT` | Correct structured direction; becomes stronger when upstream trace relationships stop collapsing semantics. |
| Legacy `record.trace.evidenceMapping` fallback | `COMPATIBILITY_ONLY / RETIRE_FROM_CANONICAL_PATH` | Useful migration fallback, but lossy and weaker in provenance. |
| `EditorialPropositionComposer` | `REUSE_WITH_NEW_INPUT_CONTRACT` | Mostly pure downstream synthesis with explicit `RADAR_INFERENCE` support references; presentation heuristics must remain non-authoritative. |
| `CanonicalDossierPresentationV2` | `REUSE_WITH_VERSIONED_EVOLUTION` | Strong proposition typing, evaluation fingerprinting, and provenance-shape validation; long-term reference resolvability still needs confirmation. |
| Legacy `artifact.opportunity` as editorial authority | `RETIRE_FROM_CANONICAL_PATH` | Reintroduces presentation-derived state into the newer planning/composition path. |
| Parallel new `DossierPlan` stack | `DO_NOT_INTRODUCE` | Would duplicate a role already substantially occupied by `EditorialIntelligenceContract`. |

## 9. Target architecture after Batches 01–03

The recon now supports a more concrete target:

```text
immutable source evidence
        ↓
canonical candidate projection + canonical job projection
        ↓
typed role ↔ candidate evidence relationships
        ↓
policy-independent assessment facts + explicit uncertainty
        ↓
persisted EvaluationSnapshot / evolved canonical evaluation
        ↓
narrow versioned DecisionPolicy
        ↓
EditorialIntelligenceContract vNext
        ↓
EditorialPropositionComposer
        ↓
CanonicalDossierPresentationV2 / vNext
        ↓
serving/UI renders persisted presentation
```

The intended separation is:

```text
Evaluation owns truth.
Policy owns recommendation/decision semantics.
Editorial contract owns the reviewed plan for explaining that truth.
Composer owns presentation inference and wording.
UI owns rendering only.
```

This preserves the useful V2 work already present while removing the hidden dependency on the historical presenter.

## 10. No implementation authorization yet

This batch does **not** authorize:

- adding a new `DossierPlan` type in parallel;
- persisting today's `EditorialIntelligenceContract` unchanged;
- deleting legacy compatibility paths before reachability is known;
- changing dossier V2 proposition semantics;
- changing policy or evaluation results;
- migrating stored presentations;
- altering serving/UI;
- changing production code.

Before refactoring this path, we need to understand which presentation generations are actually reachable at read/serve time and whether any consumers still depend on the legacy fields we want to retire.

## 11. Next small batch

**Batch 04 — serving/read path + legacy dossier coexistence**

Inspect:

- materialized dossier presentation query/store read path;
- service/API functions that load dossier and opportunity detail;
- UI consumers of `CanonicalDossierPresentationV2`;
- reachability of historical `BriefCompositionEngine` / old brief/dossier paths;
- any path that rebuilds advisory prose from `RecommendationRecord`, `Presented`, or legacy opportunity fields;
- how proposition evidence/canonical-signal references are resolved after persistence;
- compatibility/migration surfaces that constrain removal of legacy presentation dependencies.

Questions to answer:

1. Is V2 presentation the sole canonical dossier serving path for evaluated opportunities?
2. Which legacy presentation/brief paths remain reachable in production?
3. Can every persisted proposition reference be resolved durably at read time?
4. Does any serving/UI layer recompute or reinterpret advisory facts instead of rendering the persisted dossier artifact?
5. What is the smallest safe migration sequence for removing `artifact.opportunity` from the V2 editorial builder?

Do not start implementation refactoring until this reachability/read-path evidence is recorded.