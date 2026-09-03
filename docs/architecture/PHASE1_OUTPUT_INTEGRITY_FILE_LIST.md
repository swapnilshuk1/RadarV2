# Phase 1 output-integrity file list

Status: **C1 review artifact — implementation not authorized**

Phase 1 is limited to stopping false evaluation data. It must make the
existing canonical evaluated/unavailable artifact authoritative and lossless.
It must not repair acquisition, candidate projection, attention eligibility,
score weights, policy thresholds, or live contexts.

## Primary production files

These are the exact primary files named by the governing implementation plan:

- `src/lib/domain/canonical_acquisition.ts`
- `src/lib/domain/evaluation_context.ts`
- `src/lib/domain/evaluation_fingerprint.ts`
- `src/lib/domain/evaluation_payloads.ts`
- `src/lib/intelligence/engine.ts`
- `src/lib/intelligence/evaluation/PayloadMapper.ts`
- `src/lib/intelligence/EvaluationWorker.ts`
- `src/lib/intelligence/context-materialization.ts`

Only if serving requires explicit unavailable-state mapping may the implementer
touch the canonical serving repository under `StorageProvider` or the serving
decision/category resolver. That conditional file list must be reported before
editing.

## Tests to inspect and, only after Phase 1 authorization, update

- `tests/intelligence/payload-mapper.test.ts`
- `tests/intelligence/engine-intrinsic.test.ts`
- `tests/intelligence/canonical-acquisition-integrity.test.ts`
- `tests/intelligence/worker-profile-resolution.test.ts`
- `tests/intelligence/serving-verdict-integrity.test.ts`
- `tests/policy/atomic-plan-activation.test.ts`

The Phase 0 fixtures under
`tests/fixtures/pipeline-contracts/` are diagnostic inputs. They do not
authorize adding a new certification stage or a phase-numbered test file.

## Required output-integrity proofs

1. `NOT_EVALUABLE` persists with `decision = null` and `qualityScore = null`.
2. `SPARSE_SPEC` persists with `decision = null` and `qualityScore = null`.
3. Evaluated `PASS` requires a genuine finite score in `[0, 100]`.
4. Missing, malformed, unsupported, or invalid artifacts fail closed.
5. Worker and activation backfill produce equivalent canonical payload semantics
   for identical inputs.
6. Repeated persistence updates the same evaluation identity without creating
   duplicate evaluations.
7. No numeric score is persisted, served, ranked, or used in policy unless it
   originates from the canonical evaluated artifact and is finite and within
   `[0, 100]`.
8. No persisted recommendation decision exists unless it originates from a
   completed canonical evaluated artifact.

## Explicitly out of scope

- No acquisition validator or portal changes.
- No attention-gate or ontology changes.
- No candidate projection changes.
- No score-weight or policy-threshold changes.
- No live rematerialization, migration, database write, active-context pointer
  update, scraper run, deployment, or certification-manifest change.

## Expected Cvent disposition

The Phase 0 Cvent specimen is expected to remain truthful but unavailable at
this phase boundary: `NOT_EVALUABLE / null decision / null score`. Repairing its
`EMPTY_CAPABILITIES` projection defect belongs to the later projection phase;
manufacturing a score or decision to make it look healthy is a Phase 1 failure.
