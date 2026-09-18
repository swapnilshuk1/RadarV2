# RADAR architecture

Current implementation reference, reconciled against `433588c` on 19 September
2026. This describes code, not a claim about the deployed release or current
backfill counts. The [product mission](PRODUCT_MISSION.md) governs
product behavior; the [documentation index](README.md) lists current operational guidance.

## Product and boundaries

RADAR produces an executive pursuit decision and a rich dossier from three
evidence planes: role/JD, explicitly bound candidate sources, and acquired company
context. The model interprets meaning; the application owns identity, provenance,
schema validation, policy constraints, lifecycle, persistence and activation.
Grounded inference, visible EXPLICIT/INFERRED cues, narrative variation and both
approved dossier templates remain product requirements.

```mermaid
flowchart TD
  A[Portal acquisition] --> B[Preserved payload and canonical opportunity version]
  B --> C[Exact enrichment dependency]
  C --> D[Durable staged evaluation job]
  D --> E[Frozen JD, bound candidate evidence and acquired context]
  E --> F[Role interpretation, screening, mapping and gap classification]
  F --> G[Context resolution, career capital and decision policy]
  G --> H[(staged_evaluations)]
  H --> I[Section composition and independent factual review]
  I --> J[(materialized_dossier_presentations)]
  J --> K[STAGED_EVALUATED publication]
  K --> L[Serving queries and DossierView]
  M[(active_evaluation_contexts)] --> L
```

Persisting an evaluation, composing a dossier and publishing a projection do not
switch the active context. Shadow work can therefore succeed without becoming
user-visible. For an already active staged context, the worker also performs
composition/publication; an inactive shadow context stops at evaluation persistence
unless composition/publication is explicitly requested.

## Canonical code map

| Responsibility | Implementation |
| --- | --- |
| Acquisition and enrichment | `scripts/scraper/`, `scripts/scrape.ts`, `scripts/enrich.ts` |
| Dependency scheduling | `src/lib/intelligence/EvaluationWorkScheduler.ts`, `scripts/scraper/persist/queue.ts` |
| Durable claims and worker lifecycle | `src/lib/intelligence/EvaluationWorker.ts` |
| Immutable production input | `src/lib/intelligence/staged/ProductionStagedInputAdapter.ts` |
| Company retrieval and acquisition recipe | `src/lib/intelligence/staged/ProductionContextProvider.ts`, `contextAcquisitionPolicy.ts` |
| Claim extraction, source fingerprints and candidate conflicts | `src/dossier/evidence.ts` |
| Role/mapping contracts and application-assigned IDs | `src/dossier/staged-role.ts` |
| Screening quote IDs and derived gates | `src/dossier/staged-screening.ts` |
| Decision orchestration, contracts and validation | `src/dossier/staged-decision.ts`, `staged-decision-contract.ts`, `staged-decision-integrity.ts` |
| Composition and factual review | `src/dossier/composition.ts`, `staged-composition.ts`, `factual-review-integrity.ts` |
| Durable composition requests | `src/lib/intelligence/staged/DurableDossierModel.ts` |
| Persistence and activation pointers | `src/data/sqlite/repositories/SqliteStagedInputStore.ts`, `SqliteStagedEvaluationStore.ts`, `SqliteRichDossierStore.ts`, `SqliteEvaluationContextStore.ts` |
| Publication and readiness | `src/lib/intelligence/staged/StagedServingPublisher.ts`, `stagedDossierHealth.ts`, `StagedRolloutReadiness.ts` |
| Both presentation templates | `src/dossier/DossierView.tsx`, using the shared `contracts.ts` model |

## Identity and provenance

| Identity | Meaning |
| --- | --- |
| `canonicalJobId` / `opportunityVersion` | The canonical job and the exact acquired version under evaluation |
| `tenantId` / `personId` | Authorization and candidate scope |
| `profileVersion` | The explicitly bound candidate projection and its reconstructible source bindings; no latest-CV substitution |
| `evaluationContextFingerprint` | Hash of tenant/person, search-plan snapshot, ontology version/fingerprint, policy and profile; v8 also includes the acquisition recipe |
| `inputFingerprint` / `sourceFingerprints` | The frozen input and its source identities, distinct from the resulting evaluation |
| Full evaluation fingerprint | `createStagedEvaluationFingerprint` binds context, input and canonical evaluation content; dossier lookup and publication use this identity |

`computeEvaluationContextFingerprint` lives in
`src/lib/domain/evaluation_fingerprint.ts`. Staged persistence is scoped by tenant,
person, job, opportunity version and context. Changing semantics must not silently
reuse an existing policy/context. Canonical staged JSON is validated on persistence
and rehydration; dossier storage also validates factual-review provenance and the
canonical decision trace.

## Semantic stages

The role interpreter emits requirements and their REQUIRED/PREFERRED strength.
The application builds immutable JD quote catalogs. Screening returns
`supportQuoteIds`, `screeningFunction` and `gateBasis`; it does not author the final
gate boolean. The application derives a gate only for REQUIRED entry qualifications
with a non-NONE basis. Candidate mapping independently answers whether supplied
candidate evidence establishes the requirement.

Unresolved gates are classified by gap nature. `MISSING_EXPERIENCE` and
`AFFIRMATIVE_CONFLICT` require BLOCKED screening and PASS; `MISSING_ARTIFACT` and
`PARTIAL_EVIDENCE` constrain screening to at most FRAGILE. Directly satisfied
requirements cannot be reopened as screening drivers. Authority and career-capital
tradeoffs remain separate from employer entry qualifications.

Candidate-source disagreements are computed without choosing a winning source.
Acquisition records distinguish retrieval from field resolution: retrieving a
source does not establish every requested fact. Missing context configuration or
provider failure is not a successful no-results search.

## Versions, recovery and serving

Current contracts are `staged-v8`, `staged-decision-v8`, `dossier-v3.7` and
`editorial-facts-v2`. Existing v6/v7 records and historical presentations retain
their own meaning. Fresh v7 acquisition/new v7 rollout is not an alternative to v8.

Migration 050 stores frozen inputs; migration 051 stores durable dossier model
checkpoints. Checkpoints bind the evaluation, composition/review recipe, model
configuration and exact request. Reused responses are validated; provider failures
are not cached. An old accepted section is not automatically valid under a new
review policy. Existing immutable presentation rows are not overwritten to conceal
corruption.

`staged_waiting_enrichment` means the worker cannot claim the dependency yet.
Inspect `evaluation_requirements` as well: a FAILED requirement needs an explicit,
validated recovery path, not a forced status update. Exact job/version/pipeline
matching matters. An idle queue does not prove population coverage.

Readiness checks the eligible, active, acquired search-plan cohort, valid dossiers,
publications and operational context receipts. It does not inventory pre-ingestion
blobs or every excluded/out-of-cohort record. Full backfill needs a separate
population reconciliation. PASS dossiers belong in the complete opportunity
surface even when they are absent from the shortlist.

## Runtime boundaries

The unused monolithic research runner, duplicate staged screening/research runner,
experimental extraction providers and unused presentation modules were removed.
The live semantic screening lab remains in `src/dossier/screening-semantic-lab.ts`
with `scripts/screening-semantic-corpus.ts`. Scraper dependencies, migrations,
historical data readers and still-called compatibility paths remain. New work uses the current paths above; the source tree contains no alternate
monolithic research runner.
