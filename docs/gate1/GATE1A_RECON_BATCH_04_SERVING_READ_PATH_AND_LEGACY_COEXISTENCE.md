# Gate 1A Recon — Batch 04: Serving / Read Path + Legacy Dossier Coexistence

Status: **OBSERVED / PARTIAL RECON**  
Gate: **1 of 3**  
Scope of this batch: canonical dossier persistence/readback, serving reachability, V1/V2 coexistence, request-time recomputation risk, provenance dereference, and retirement prerequisites.  
No production behavior changed in this batch.

## Why this batch exists

Batch 03 established that RADAR already has a plan-like editorial boundary:

```text
EditorialIntelligenceContract
  → EditorialPropositionComposer
  → CanonicalDossierPresentationV2
```

and concluded that a parallel `DossierPlan` stack should not be introduced. It also left several serving questions unresolved:

1. Is `CanonicalDossierPresentationV2` actually the sole served dossier artifact?
2. Are legacy dossier/brief paths still reachable?
3. Does the request/UI path recompute advisory facts rather than render persisted canonical presentation?
4. Can persisted proposition provenance references still be resolved after materialization?
5. What is the smallest safe sequence for removing `artifact.opportunity` from the V2 builder?

This batch answers those questions by tracing persistence, readback, service, route, UI, rematerialization, and legacy-builder reachability.

## Files inspected

The serving/read path and adjacent compatibility code inspected in this batch include:

- `src/data/sqlite/repositories/SqliteDossierPresentationStore.ts`
- `src/data/sqlite/repositories/SqliteOpportunityQueries.ts`
- `src/data/sqlite/provider.ts`
- `src/lib/intelligence/opportunity-server.ts`
- `src/lib/intelligence/opportunity-service.ts`
- `src/lib/intelligence/serving/CanonicalServingReadModel.ts`
- `src/lib/intelligence/serving/EvaluationServingEngine.ts`
- `src/lib/intelligence/serving/singleflight.ts`
- `src/routes/opportunity.$jobHash.tsx`
- `src/components/radar/opportunity/surfaces/CanonicalDossierV2Surface.tsx`
- `src/lib/intelligence/EvaluationWorker.ts`
- `src/lib/intelligence/evaluation/PayloadMapper.ts`
- `src/lib/domain/evaluation_payloads.ts`
- `src/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer.ts`
- `src/lib/domain/dossier_presentation.ts`
- `src/lib/intelligence/editorial/EditorialIntelligenceContract.ts`
- `src/lib/intelligence/editorial/EditorialIntelligenceContractBuilder.ts`
- `src/lib/intelligence/editorial/EditorialPropositionComposer.ts`
- `src/lib/intelligence/dossier/CanonicalDossierBuilder.ts`
- `src/lib/intelligence/editorial/BriefCompositionEngine.ts`
- `src/lib/intelligence/rematerialization/EvaluationRematerializer.ts`
- `src/lib/intelligence/dossier/rematerialization-support.ts`
- `src/data/sqlite/migrations/044_materialized_dossier_presentations.sql`

Batch 01–03 findings are used only as adjacent architectural context. This batch makes no production changes.

## 1. Observed canonical serving path

The current opportunity-detail serving path is substantially cleaner than the historical in-browser advisory path.

The request path is effectively:

```text
/opportunity/$jobHash
        ↓
opportunity-server
        ↓
OpportunityService
        ↓
canonical opportunity/dossier queries
        ↓
SqliteOpportunityQueries.getDossier(...)
        ↓
SqliteDossierPresentationStore
        ↓
persisted CanonicalDossierPresentationV2
        ↓
CanonicalDossierV2Surface
```

The V2 UI surface renders persisted dossier composition/propositions. It is not a client-side rerun of the assessment engines, decision policy, or editorial composer.

This is an important distinction from earlier RADAR presentation defects: the V2 surface is acting as a renderer of persisted presentation truth rather than as a second intelligence engine.

### Batch 04 decision

**Treat the V2 serving/read path as a strong reusable shell.**

The serving layer should continue to consume persisted canonical evaluation + persisted canonical presentation and should not acquire new semantic responsibilities during the redesign.

## 2. V2 is preferred, but it is not yet the sole reachable dossier generation

The current opportunity route explicitly prefers `dossierPresentationV2` when available.

However, the same route still contains a reachable branch for the older dossier presentation and also retains a minimal evaluated fallback when a full dossier presentation is unavailable.

Therefore the accurate state is:

```text
preferred canonical V2 presentation
        +
reachable V1 compatibility presentation
        +
minimal evaluated fallback
```

not:

```text
V2 is the only served dossier path
```

This matters because architectural cleanup cannot assume that deleting the V1 builder or its dependencies is behavior-preserving.

### Classification

| Component/path | Classification | Reason |
| --- | --- | --- |
| V2 persisted dossier read path | `REUSE_AS_IS / EVOLVE CONTRACT ONLY` | Correct read-time authority: render persisted presentation rather than recompute advice. |
| V1 route branch | `COMPATIBILITY_ONLY / RETIRE AFTER CUTOVER PROOF` | Still reachable in the current request path. |
| Minimal evaluated fallback | `KEEP_FAIL_CLOSED / REVIEW UX` | Useful degraded behavior, but must not synthesize missing dossier semantics. |

## 3. The normal evaluation worker writes V2 presentation separately from canonical evaluation

The worker path preserves the separation already observed in Batch 01:

```text
canonical evaluated payload
        ↓ validation
persist canonical evaluation

and separately

buildEvaluatedPresentationV2(...)
        ↓ validation
persist CanonicalDossierPresentationV2
```

The dossier presentation is therefore not the evaluation record itself and does not overwrite canonical evaluation truth.

The serving/read path then validates identity/fingerprint compatibility before treating stored presentation as canonical for the requested opportunity/candidate context.

This separation remains one of the strongest existing architectural choices and should survive the redesign.

## 4. The V2 store/read path is fail-closed in the places that matter

The inspected read path contains several useful defensive boundaries:

- evaluation/presentation identity is tied to canonical opportunity/candidate context;
- source evaluation fingerprint is carried into the dossier presentation;
- presentation version is explicit;
- evaluated payload validity is checked before serving evaluated truth;
- malformed/unsupported evaluated payloads are not silently adapted into a plausible recommendation;
- serving models distinguish unavailable/invalid data from valid evaluated results.

The redesign should preserve this philosophy:

> malformed, stale, mismatched, or semantically unsupported canonical artifacts should degrade to an explicit unavailable/unknown state rather than being repaired by presentation code.

## 5. No V2 request-time advisory recomputation was found

The V2 route/surface does not call assessment engines, `DecisionPolicyEngine`, `EditorialIntelligenceContractBuilder`, or `EditorialPropositionComposer` in order to reconstruct advice during a page request.

`CanonicalDossierV2Surface` renders the materialized composition/proposition text already stored in the canonical dossier presentation.

`CanonicalServingReadModel` and `EvaluationServingEngine` do perform canonical read normalization / compatibility mapping, but that is materially different from re-evaluating the candidate or inventing new dossier claims.

### Architectural invariant to preserve

```text
request/read path may:
  - validate
  - select
  - normalize compatibility fields
  - render

request/read path must not:
  - reassess candidate fit
  - recalculate verdict
  - recreate evidence relationships
  - compose new advisory claims
  - generate new dossier prose
```

This should become an explicit Gate 2/serving invariant later.

## 6. Legacy `BriefCompositionEngine` is still a real dependency, but not the V2 request-time composer

The old `BriefCompositionEngine` remains reachable through the legacy V1 `CanonicalDossierBuilder` / rematerialization compatibility stack.

That is different from saying V2 requests invoke `BriefCompositionEngine`.

The correct interpretation is:

```text
V2 normal path:
EditorialIntelligenceContract
  → EditorialPropositionComposer
  → persisted CanonicalDossierPresentationV2
  → render persisted output

legacy compatibility path:
CanonicalDossierBuilder
  → BriefCompositionEngine
  → V1 presentation/rematerialization support
```

Therefore `BriefCompositionEngine` should be treated as a **compatibility island pending retirement**, not as a component to fold into the target architecture.

### Batch 04 decision

Do **not** refactor `BriefCompositionEngine` into the new architecture.

Instead:

1. determine exactly which stored rows/read states still require V1;
2. establish V2 coverage/backfill/cutover criteria;
3. remove the V1 route branch;
4. then remove the legacy builder/composer dependency if no other consumer remains.

## 7. Persisted V2 proposition text is durable; complete provenance dereference is not yet self-contained

Batch 03 established that V2 propositions carry typed provenance references such as:

- role/job evidence IDs;
- candidate evidence IDs;
- canonical evaluation signal references;
- inference support references.

Batch 04 confirms an important limitation of the materialized artifact:

> the persisted `CanonicalDossierPresentationV2` retains the proposition text and its reference IDs, but it does not itself persist the entire editorial contract/evidence registry necessary to resolve every reference independently.

The current UI does not attempt to dereference those IDs; it renders the persisted proposition text. Therefore this is **not currently a serving correctness bug**.

It is, however, a durability/auditability question.

The system should eventually guarantee one of these explicit invariants:

### Option A — durable external resolution

Every persisted proposition reference remains resolvable through immutable canonical role/candidate/evaluation evidence stores for the lifetime of the dossier.

### Option B — self-contained durable plan provenance

The persisted editorial-plan/presentation artifact contains enough normalized provenance to audit each proposition without depending on transient builder state.

The redesign should not duplicate full evidence blobs into every dossier merely for convenience. The choice should be made after the durable evidence ownership model is finalized.

## 8. Why `artifact.opportunity` cannot be removed by signature cleanup alone

Batch 03 identified `artifact.opportunity` as a legacy-shaped dependency inside `EditorialIntelligenceContractBuilder`.

Batch 04 clarifies why it still exists: it is supplying information needed during V2 editorial construction, including role metadata and role-description/requirements-derived material used as editorial evidence/fallback context.

Therefore this would be unsafe:

```text
remove artifact.opportunity parameter
→ patch compiler errors
→ keep existing behavior via ad hoc lookups/defaults
```

That would simply move the hidden authority elsewhere.

The correct replacement is an explicit immutable editorial input boundary.

A future builder should receive something conceptually like:

```text
EditorialRoleInput
  role identity / snapshot identity
  canonical title/company/category
  canonical role propositions / requirements
  durable role evidence references
  source snapshot/version

EditorialCandidateInput
  canonical candidate proof references
  candidate evidence IDs
  candidate snapshot/version

EvaluationSnapshot
  canonical role-candidate relationships
  assessment facts + uncertainty
  quality/score semantics

DecisionPolicyOutput
  verdict
  policy version
  triggered rules
  decision reasons / hinges
```

The exact type names should wait for contract reconciliation, but the ownership split should not.

## 9. Smallest safe sequence for removing `artifact.opportunity`

The observed code supports the following migration order.

### Step 1 — define the immutable editorial source contract

Create a versioned input boundary containing the role/candidate/evaluation/policy information actually needed by `EditorialIntelligenceContractBuilder`.

Do not source missing values from presentation objects.

### Step 2 — populate that input from canonical persisted truth

The worker/rematerializer should obtain title/company/category/role description/requirements/evidence references from the canonical role/job snapshot and canonical evidence stores, not from `present(...)` output.

### Step 3 — prove parity and fail-closed behavior

Add tests demonstrating that:

- V2 contract construction no longer requires `artifact.opportunity`;
- no verdict/score/policy field falls back to presenter state;
- missing canonical source evidence is represented as unknown/unavailable rather than fabricated;
- evaluation/presentation fingerprints remain stable and validated.

### Step 4 — make provenance durability explicit

Before declaring the new contract canonical, guarantee durable resolution of proposition references through canonical evidence stores or persist a normalized provenance registry with the plan.

### Step 5 — remove `artifact.opportunity` authority

Only after Steps 1–4 should the V2 builder stop reading the legacy presentation-shaped opportunity object.

### Step 6 — retire V1 separately

Removing `artifact.opportunity` from V2 and retiring the V1 route are related but distinct migrations.

Do not combine them unless coverage proves that all required stored opportunities can be served through V2.

## 10. V1 retirement prerequisites

Before removing the legacy dossier serving branch, establish at least:

1. **Reachability inventory** — which records/states can still return V1 today?
2. **Backfill/rematerialization strategy** — can eligible V1 records be deterministically materialized as V2 from canonical evaluation inputs?
3. **Unavailable-state behavior** — what happens when a legacy record cannot be converted?
4. **Fingerprint/identity parity** — conversion must preserve exact candidate/opportunity/evaluation identity.
5. **Read-path tests** — V2 must remain fail-closed for stale/mismatched/invalid presentations.
6. **No runtime recomposition** — migration must not create a page-load composition fallback.
7. **Explicit cutover** — remove V1 serving only after coverage is demonstrated, rather than keeping an unbounded silent fallback forever.

This is a migration/cutover problem, not a reason to retain V1 semantic ownership in the target architecture.

## 11. Reuse classification — Batch 04

| Component | Classification | Reason |
| --- | --- | --- |
| `SqliteDossierPresentationStore` | `REUSE_WITH_VERSIONED_EVOLUTION` | Strong persisted presentation boundary; preserve fingerprint/version/identity discipline. |
| `SqliteOpportunityQueries.getDossier()` canonical V2 read | `REUSE_WITH_VERSIONED_EVOLUTION` | Correct place to select/validate persisted canonical artifacts; keep semantic invention out. |
| `OpportunityService` / server read orchestration | `REUSE_AS_IS / CONTRACT EVOLUTION ONLY` | Serving orchestration is not the intelligence problem. |
| `CanonicalServingReadModel` | `REUSE_WITH_VERSIONED_EVOLUTION` | Useful fail-closed read normalization; must remain non-authoritative for new semantic claims. |
| `EvaluationServingEngine` | `REUSE_WITH_CAUTION` | Compatibility mapping is useful but must not become a second evaluator. |
| `CanonicalDossierV2Surface` | `REUSE_AS_IS / UI EVOLUTION ONLY` | Renders persisted V2 content rather than recalculating advice. |
| V1 route branch | `COMPATIBILITY_ONLY / RETIRE` | Explicitly reachable; remove only after cutover proof. |
| `CanonicalDossierBuilder` V1 | `COMPATIBILITY_ONLY / RETIRE` | Legacy materialization path, not target architecture. |
| `BriefCompositionEngine` | `COMPATIBILITY_ONLY / RETIRE` | Do not refactor into vNext; eliminate after V1 dependencies are gone. |
| V2 proposition reference arrays | `REUSE_WITH_DURABILITY_INVARIANT` | Good provenance shape; lifetime resolvability must be guaranteed. |
| `artifact.opportunity` as V2 builder authority | `RETIRE_FROM_CANONICAL_PATH` | Presentation-shaped state is still supplying semantic/editorial inputs that should come from canonical source contracts. |

## 12. Answers to the five Batch 04 questions

### 12.1 Is V2 the sole canonical served dossier?

**No.**

It is the preferred current path, but a V1 compatibility branch and minimal evaluated fallback remain reachable.

### 12.2 Which legacy paths remain reachable?

The current route can still render the older dossier presentation. The V1 builder / `BriefCompositionEngine` stack also remains as a compatibility/rematerialization dependency.

It is **not** the V2 request-time composition path.

### 12.3 Can every persisted proposition reference be durably resolved at read time from the V2 row alone?

**No.**

The persisted proposition text and reference IDs survive, but the V2 presentation row does not itself contain the complete evidence/contract registry needed to independently dereference every ID.

### 12.4 Does V2 serving/UI recompute advisory facts?

**No request-time advisory recomputation was found in the inspected V2 path.**

The UI renders persisted V2 composition/propositions. Read normalization and compatibility mapping occur, but the assessment/policy/editorial engines are not rerun to recreate advice on page load.

### 12.5 What is the smallest safe route to remove `artifact.opportunity`?

Introduce an explicit immutable editorial source-input contract, populate it from canonical role/candidate/evaluation/policy truth, prove parity and fail-closed behavior, guarantee provenance durability, then remove `artifact.opportunity` from the V2 builder.

Retire V1 serving as a separate cutover after coverage/backfill is proven.

## 13. Target architecture after Batches 01–04

The recon now supports this target with substantially less ambiguity:

```text
immutable source documents / evidence
        ↓
canonical role snapshot + RoleIntelligence
        ↓
canonical CandidateProof
        ↓
typed role ↔ candidate evidence relationships
        ↓
policy-independent EvaluationSnapshot
        ↓
versioned DecisionPolicy output
        ↓
EditorialIntelligenceContract vNext
  (reviewed explanation plan)
        ↓
EditorialPropositionComposer
        ↓
CanonicalDossierPresentationV2 / successor
        ↓
persisted presentation store
        ↓
serving/read validation
        ↓
UI renders persisted truth
```

The key ownership rule is now clear across write and read paths:

```text
Extraction owns source interpretation.
Evidence graph owns role-candidate relationships.
Evaluation owns assessment truth + uncertainty.
Policy owns recommendation semantics.
Editorial contract owns the explanation plan.
Composer owns presentation inference/wording.
Persistence owns durable versioned artifacts.
Serving owns validation/selection.
UI owns rendering.
```

No later layer should quietly recreate an earlier layer's semantic authority.

## 14. No implementation authorization yet

This batch does **not** authorize:

- deleting V1 dossier serving;
- deleting `BriefCompositionEngine`;
- removing `artifact.opportunity` by local signature refactor;
- embedding duplicate evidence blobs into every dossier;
- changing evaluation or policy outputs;
- changing V2 proposition semantics;
- rematerializing stored dossiers;
- changing route/UI behavior;
- changing production code.

The evidence is now sufficient to design the migration sequence, but the source-contract/provenance/cutover prerequisites should be reconciled first.

## 15. Next small batch

**Batch 05 — immutable editorial input boundary + provenance durability + V1 retirement prerequisites**

The next batch should answer, from code and schema:

1. What exact canonical role/job artifact should replace the editorial builder's use of `artifact.opportunity`?
2. Which role/candidate/evaluation evidence IDs are already lifetime-stable and resolvable, and which are only transient/compositional?
3. Does the current schema preserve source snapshots strongly enough for old dossiers to remain auditable after re-extraction/re-evaluation?
4. Which V1 rows/states require backfill, rematerialization, explicit unavailable behavior, or permanent legacy retention?
5. What exact vNext contract fields are required before `EditorialIntelligenceContractBuilder` can become presentation-independent?

Only after that reconciliation should production implementation begin.
