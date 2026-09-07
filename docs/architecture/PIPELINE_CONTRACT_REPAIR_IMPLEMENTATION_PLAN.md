# RADAR Pipeline Contract Repair — Implementation Plan

Status: **PROPOSED — NO EXECUTION AUTHORIZED BY THIS DOCUMENT**  
Prepared: 02 Sep 2026  
Scope: candidate evidence, acquisition validation, job projection, attention eligibility, evaluation materialization, controlled rematerialization, and later vacancy canonicalization

## 1. Outcome

Repair the end-to-end path so that RADAR can make this guarantee:

```text
verified candidate evidence
        +
captured and validated job document
        ↓
evidence-grounded candidate and job projections
        ↓
deterministic eligibility decision
        ↓
canonical evaluation artifact
        ↓
lossless materialization and serving
```

The work must eliminate synthetic scores and decisions, retain unavailable states faithfully, prevent malformed documents from entering evaluation, and increase attention-gate recall without turning the attention gate into a second scorer.

This plan does not authorize implementation, database writes, scraping, deployment, or rematerialization. Each phase has an explicit approval checkpoint.

## 2. Non-negotiable invariants

1. A scrape is not an opportunity universe, shortlist, or evaluation context.
2. All acquisition runs add to or enrich the cumulative canonical opportunity pool.
3. No numeric score may be persisted, served, ranked, or used in policy unless it originates from the canonical evaluated artifact and is finite and within `[0, 100]`.
4. No persisted recommendation decision may exist unless it originates from a completed canonical evaluated artifact.
5. `NOT_EVALUABLE`, `SPARSE_SPEC`, acquisition failure, and pending extraction have null decision and null score.
6. `PASS` means a completed evaluation reached a negative verdict; it never means evaluation was unavailable.
7. Candidate attained seniority, demonstrated capabilities, inferred capabilities, and target trajectory are separate concepts.
8. “Explicit” evidence must point to a source quotation that states the asserted fact. Inference is labelled inference; absence remains unknown.
9. Attention eligibility is deterministic, explainable, and optimized for recall. It rejects only demonstrated incompatibility.
10. Acquisition query expansion and eligibility are compiled separately from one versioned search-intent ontology.
11. Evaluation identity remains `(canonicalJobId, opportunityVersion, contextFingerprint)` and rematerialization remains idempotent.
12. Canonical opportunities and user decisions are never deleted, duplicated, or reassigned as part of context changes.
13. UI fallbacks are presentation-only and are never persisted as domain data.

## 3. Current collision and recoverability checkpoint

The working tree currently contains unfinished or parallel changes in files this plan would need to modify, including:

- `src/lib/acquisition/CanonicalIngestionService.ts`
- `src/lib/intelligence/AttentionGate.ts`
- `src/lib/intelligence/profile-server.ts`
- `src/lib/intelligence/context-materialization.ts` (untracked)
- `src/lib/intelligence/search-plan-activation.ts` (untracked)
- `src/data/sqlite/repositories/SqliteEvaluationContextStore.ts`
- `tests/intelligence/m43-attention-gate.test.ts`
- `tests/intelligence/m9-canonical-loop.test.ts`
- `tests/intelligence/m10-continuous-pipeline.test.ts`
- `tests/policy/atomic-plan-activation.test.ts`
- certification manifest and inventory files

### Required preflight

Before Phase 0 begins:

1. Confirm that parallel changes are finalized or paused.
2. Record `git status --short`, `git diff --stat`, and a patch of all current user changes.
3. Attribute every modified/untracked target file to its current workstream.
4. Establish a user-approved recoverable baseline commit or worktree.
5. Do not reset, checkout, overwrite, stash, or reformat unrelated changes.
6. Re-read the final versions of all target files after the baseline is established; do not rely on this planning snapshot.

**Checkpoint C0:** user approves the baseline and Phase 0 test-fixture work.

## 4. Existing abstractions to reuse

Implementation must extend these existing authorities:

- `src/lib/intelligence/evaluation/PayloadMapper.ts`
  - canonical evaluated/unavailable payload validation;
  - already recognizes `NOT_EVALUABLE` as unavailable.
- `src/lib/intelligence/engine.ts`
  - `runEngineSingleIntrinsic` and `EvaluationArtifact`.
- `src/lib/acquisition/validator.ts`
  - transport and acquisition-response validation.
- `scripts/scraper/utils/http-fetch.ts`
  - substantive-content, script pollution, and non-job boilerplate detection.
- `src/lib/intelligence/builders/JobProjectionBuilder.ts`
  - canonical job projection boundary.
- `src/lib/intelligence/builders/CandidateProjectionBuilder.ts`
  - canonical candidate projection boundary.
- `scripts/scraper/run/search-planner.ts`
  - ontology-driven acquisition planning.
- `src/lib/intelligence/search-plan-activation.ts`
  - prepare, materialize, coverage-check, then activate lifecycle.

Do not add a second evaluation mapper, a third content validator, a parallel candidate scorer, or a scrape-specific serving repository.

## 5. Phase 0 — Contract matrix and immutable diagnostic fixtures

### Purpose

Turn the production findings into deterministic, offline contract evidence before changing runtime behavior.

### Work

1. Create sanitized fixtures for:
   - Cvent: rich, valid JD that currently reaches `EMPTY_CAPABILITIES`;
   - WPP Media and Weber Shandwick: relevant false-negative titles;
   - MSM Unify: compound `Chief Strategy and Transformation Officer` title;
   - a weak technical/finance role for hard-exclusion control;
   - PDF byte stream;
   - redirect notice;
   - unrelated careers page;
   - sparse but genuine JD.
2. Preserve source title, company, location, canonical source URL, content type, captured text, and expected document classification.
3. Record the human audit label separately from expected engine output:
   - strong;
   - moderate/stretch;
   - weak;
   - not assessable.
4. Add a contract matrix describing expected state at each boundary:

```text
fixture → acquisition state → projection state → eligibility state
        → evaluation state → decision → score
```

5. Keep fixtures offline and sanitized. No test may contact a portal, Turso, or production services.

### Authoritative test homes

Modernize existing suites; do not create phase-numbered suites:

- `tests/intelligence/payload-mapper.test.ts`
- `tests/intelligence/engine-intrinsic.test.ts`
- `tests/intelligence/semantic-evidence-integrity-regression.test.ts`
- `tests/intelligence/m43-attention-gate.test.ts`
- `tests/intelligence/canonical-acquisition-integrity.test.ts`
- `tests/acquisition/portal-acquisition-reality.test.ts`

Fixture files may be added under the existing `tests/fixtures/` organization after checking its current conventions.

### Prohibited

- No production code changes.
- No migration.
- No database query or write.
- No scraper execution.
- No certification manifest change merely to include a failing test.

### Exit criteria

- Every diagnostic specimen has a deterministic expected boundary state.
- Cvent is represented by the full substantive JD, not a simplified title-only fixture.
- Invalid captures are distinguishable from genuinely sparse job specifications.

**Checkpoint C1:** approve the contract matrix and the Phase 1 output-integrity file list.

## 6. Phase 1 — Stop false evaluation data

### Invariant

Only a completed canonical evaluated artifact may produce `PURSUE`, `CONSIDER`, `PASS`, or a numeric score.

### Current defects addressed

- `EvaluationWorker` calls `runEngineSingle`, translates unknown verbs, and defaults missing priority to 50.
- `context-materialization` independently maps `NOT_EVALUABLE` to `PASS` and defaults missing priority to 50.
- Materialized `EvaluationState` does not currently include `NOT_EVALUABLE` even though the canonical unavailable payload does.

### Implementation

1. Extend the materialized evaluation domain to recognize `NOT_EVALUABLE` as an unavailable state.
2. Update evaluation consistency validation so every unavailable state requires:
   - `decision = null`;
   - `qualityScore = null`.
3. Use `runEngineSingleIntrinsic` in both worker evaluation and activation backfill.
4. Route both paths through `PayloadMapper`:
   - evaluated verbs use `buildCanonicalEvaluatedPayload`;
   - unavailable states use `buildCanonicalUnavailablePayload`.
5. Add one shared translation from canonical payload to `MaterializedEvaluation`; do not duplicate switch statements in worker and backfill.
6. Use `RecommendationRecord.qualityScore`, never queue priority or presentation priority.
7. Fail closed on:
   - absent artifact;
   - unsupported verb;
   - invalid score;
   - missing context provenance;
   - invalid job/opportunity identity.
8. Preserve the intrinsic `JobProjection` from the scoring execution in the serialized evaluation artifact.
9. Ensure serving and metrics distinguish:
   - evaluated pass;
   - unavailable;
   - sparse;
   - acquisition pending/failed.
10. Remove all `?? 50`, default `CONSIDER`, and `NOT_EVALUABLE → PASS` translations from persistence paths.

### Expected files

Primary:

- `src/lib/domain/canonical_acquisition.ts`
- `src/lib/domain/evaluation_context.ts`
- `src/lib/domain/evaluation_fingerprint.ts`
- `src/lib/domain/evaluation_payloads.ts`
- `src/lib/intelligence/engine.ts`
- `src/lib/intelligence/evaluation/PayloadMapper.ts`
- `src/lib/intelligence/EvaluationWorker.ts`
- `src/lib/intelligence/context-materialization.ts`

Only if current serving code requires explicit unavailable mapping:

- canonical serving repository implementation under `StorageProvider`
- decision/category resolver used by serving

Tests:

- `tests/intelligence/payload-mapper.test.ts`
- `tests/intelligence/engine-intrinsic.test.ts`
- `tests/intelligence/canonical-acquisition-integrity.test.ts`
- `tests/intelligence/worker-profile-resolution.test.ts`
- `tests/intelligence/serving-verdict-integrity.test.ts`
- `tests/policy/atomic-plan-activation.test.ts`

### Prohibited

- No score-weight or policy-threshold changes.
- No acquisition or attention-gate changes.
- No candidate projection changes in this phase.
- No live rematerialization.
- No active-context pointer update.

### Focused verification

Run only explicit offline files using the repository's deterministic Vitest configuration. Do not invoke unscoped default `npx vitest run`.

Required proofs:

1. `NOT_EVALUABLE` persists with null decision and score.
2. `SPARSE_SPEC` persists with null decision and score.
3. Evaluated `PASS` requires a genuine finite score.
4. Missing or invalid artifacts fail closed.
5. Worker and activation backfill produce byte-equivalent canonical payload semantics for identical inputs.
6. Repeating persistence updates the same evaluation identity without duplication.

### Exit criteria

- No persistence path contains a synthetic default score or decision.
- Cvent remains unavailable at this stage, but it is represented truthfully as `NOT_EVALUABLE / null / null`.
- Focused tests pass.

**Checkpoint C2:** approve Phase 2 candidate-projection repair.

## 7. Phase 2 — Candidate evidence and projection truth

### Invariant

Candidate projection facts must be traceable to candidate evidence; target aspirations do not alter attained identity.

### Implementation

1. Define separate projection fields for:
   - attained title/seniority;
   - demonstrated capabilities;
   - inferred capabilities with confidence;
   - target trajectory, if needed by evaluation, or keep target exclusively in SearchPlan.
2. Correct C-suite classification:
   - remove generic `leadership` as a C-suite signal;
   - require a current Chief/CxO title or explicit attained C-suite fact;
   - emit evidence IDs that name the actual matched fact.
3. Preserve the real current title through projection persistence; remove the hardcoded `Executive` value.
4. Preserve an evidence-grounded archetype rather than using the first theme string.
5. Remove or downgrade unsupported attached-resume claims:
   - EBITDA accountability;
   - board reporting;
   - M&A;
   - enterprise-wide P&L;
   - enterprise sales as a primary capability.
6. Represent account/portfolio commercial ownership at its demonstrated boundary.
7. Keep C-suite as a search target, not an attained candidate fact.
8. Increment profile version whenever the authoritative projection changes so evaluation freshness works correctly.

### Expected files

- `src/lib/domain/candidate_projection.ts`
- `src/lib/intelligence/classifiers/CandidateSeniorityClassifier.ts`
- `src/lib/intelligence/builders/CandidateProjectionBuilder.ts`
- commercial/decision-authority classifiers only where direct evidence proves a defect
- `src/data/sqlite/repositories/TenantScopedPersonStore.ts`
- profile/document projection entry point that owns the verified source title

Tests should remain in existing candidate/projection suites, including:

- candidate pipeline tests
- `tests/intelligence/worker-profile-resolution.test.ts`
- deterministic candidate-level fixtures
- canonical identity tests only in offline mode; the opt-in live identity test remains operator-only

### Prohibited

- No manual editing of a persisted production projection.
- No candidate-specific scoring exception.
- No copying search targets into factual seniority.
- No default capabilities inserted to make evaluation pass.

### Exit criteria

For the attached resume fixture:

- attained level is SVP/VP executive, not C-suite;
- current title is preserved;
- archetype reflects commercial growth, digital transformation, and marketing;
- unsupported claims are absent or explicitly inferred with lower confidence;
- deterministic rebuild produces the same projection and fingerprint.

**Checkpoint C3:** approve acquisition/document and JobProjection repair.

## 8. Phase 3 — Validated job documents and grounded JobProjection

### Invariant

Transport success, document usability, extraction completeness, and evidence sufficiency are separate states.

### Implementation A — consolidate document validation

1. Consolidate, do not duplicate:
   - `src/lib/acquisition/validator.ts` response checks;
   - `scripts/scraper/utils/http-fetch.ts` content-quality checks.
2. Define a `ValidatedJobDocument` contract with at least:
   - canonical/source identity;
   - source URL and final URL;
   - media/content type;
   - transport state;
   - extraction state;
   - usability state;
   - title/company/location agreement signals;
   - substantive word/character counts;
   - boilerplate/script ratio;
   - failure class and retryability;
   - extracted text and provenance.
3. Classify representative outcomes:
   - valid substantive JD;
   - valid but genuinely sparse JD;
   - redirect/login/bot page;
   - unrelated careers/search page;
   - script/portal-shell pollution;
   - supported PDF pending extraction;
   - corrupt or mislabelled binary payload.
4. Central validation at canonical ingestion is authoritative. Portal-level quality is evidence, not an override.
5. A valid PDF must be retained via BlobStore and sent to text extraction; binary PDF bytes must not be stored as JD text.
6. Use existing acquisition/recovery fields where they can represent the states without ambiguity.
7. If durable orthogonal states cannot be represented, stop and propose a separately approved incremental migration `033_...`; do not silently overload existing values.

### Implementation B — grounded JobProjection

1. Make `JobProjectionBuilder` consume `ValidatedJobDocument`, not arbitrary portal-shaped objects.
2. Replace the small fixed capability phrase list with the existing ontology/semantic resolvers.
3. Produce capabilities with:
   - canonical concept;
   - source quotation/span;
   - evidence relationship;
   - confidence;
   - explicit/inferred/unknown state.
4. Remove synthetic “Explicit” dimensions that quote only a title for unstated commercial scope or decision authority.
5. Keep unknown structural dimensions unknown.
6. Add a projection version/fingerprint to the evaluation artifact so repeated evaluation is attributable to a concrete projection implementation and content version.
7. Do not persist person-specific information in JobProjection; it remains opportunity-version-specific and reusable across tenants/persons.

### Expected files

- `src/lib/acquisition/validator.ts`
- `scripts/scraper/utils/http-fetch.ts`
- `src/lib/acquisition/CanonicalIngestionService.ts`
- `src/lib/domain/canonical_acquisition.ts`
- `src/lib/intelligence/builders/JobProjectionBuilder.ts`
- existing semantic/ontology resolvers only where required
- BlobStore and text-parser integration only for supported document extraction
- incremental migration only after an explicit schema checkpoint

Tests:

- `tests/acquisition/portal-acquisition-reality.test.ts`
- `tests/scraper/scraper-acquisition-contract.test.ts`
- `tests/intelligence/canonical-acquisition-integrity.test.ts`
- `tests/intelligence/semantic-evidence-integrity-regression.test.ts`
- `tests/certification/journey_a_acquisition_to_evaluation.test.ts`

### Acceptance specimens

- Cvent: valid document, grounded marketing/Martech/AI/people-leadership capabilities, non-empty projection.
- WPP/Weber: valid agency/digital/commercial capabilities.
- PDF bytes: not treated as readable JD text.
- redirect/unrelated page: recovery/failure, never evaluation.
- genuinely sparse JD: `SPARSE_SPEC`, not acquisition corruption and not a scored pass.

### Prohibited

- No LLM-only validator.
- No content-length-only `COMPLETE` classification.
- No portal-specific JobProjection logic.
- No fabricated evidence to satisfy integrity gates.
- No live scrape during implementation verification.

**Checkpoint C4:** approve deterministic eligibility redesign.

## 9. Phase 4 — Shared ontology and deterministic attention eligibility

### Invariant

Attention eligibility controls evaluation spend and obvious incompatibility; it does not estimate opportunity quality.

### Design

Compile two outputs from one versioned `SearchIntent + ontology`:

```text
SearchIntent + ontology
        ├── AcquisitionQueryPlan
        └── EligibilitySpec
```

`AcquisitionQueryPlan` remains portal/query oriented. `EligibilitySpec` is semantic and contains:

- role families;
- functions;
- seniority range;
- locations/work models;
- industries where explicitly constrained;
- hard exclusions;
- adjacent/stretch families;
- ontology/version identity.

Do not use generated query strings as eligibility rules.

### Implementation

1. Extend the existing search-plan compiler to emit the immutable eligibility specification alongside acquisition queries.
2. Persist it in the search-plan snapshot/criteria payload with ontology identity.
3. Replace raw title substring matching with normalized JobProjection concepts.
4. Prefer tri-state output:
   - `ELIGIBLE`;
   - `REVIEW`;
   - `INELIGIBLE`.
5. If storage remains binary, map `ELIGIBLE` and `REVIEW` to `CANDIDATE`; reserve `NOT_CANDIDATE` for explicit hard contradiction.
6. Store structured reason codes and matched concepts, not only free-form strings.
7. Hard rejections may include:
   - explicit incompatible function/domain;
   - explicit unacceptable location/work model;
   - material seniority mismatch outside configured tolerance;
   - excluded employer;
   - invalid/unusable JobProjection.
8. Unknown information must not become an automatic rejection.
9. Keep the gate deterministic and free of scoring weights and LLM calls.

### Expected files

- `src/lib/domain/evaluation_context.ts`
- search intent/search plan domain types
- `scripts/scraper/run/search-planner.ts`
- `src/lib/intelligence/search-plan-activation.ts`
- `src/lib/intelligence/ScraperPlanResolver.ts`
- `src/lib/intelligence/AttentionGate.ts`
- `src/lib/acquisition/CanonicalIngestionService.ts`
- `src/lib/intelligence/context-materialization.ts`

Tests:

- `tests/intelligence/m43-attention-gate.test.ts`
- `tests/intelligence/m9-canonical-loop.test.ts`
- `tests/intelligence/m10-continuous-pipeline.test.ts`
- `tests/pipeline/autonomous-pipeline.test.ts`
- `tests/certification/journey_a_acquisition_to_evaluation.test.ts`
- `tests/policy/atomic-plan-activation.test.ts`

### Cohort acceptance criteria

Using the approved executable diagnostic fixtures and the original audited
cohort as distinct evidence sources:

- all strong-role fixtures represented in the executable corpus are `ELIGIBLE` or `REVIEW`;
- the hard-exclusion fixture is `INELIGIBLE` with the correct reason code;
- acquisition-failure and sparse fixtures remain acquisition/recovery states, not attention decisions;
- a read-only shadow applies the new `EligibilitySpec` to all historical audit records for which the audit preserves sufficient input, and compares the result with the recorded historical attention decision and human label;
- the shadow must not fabricate fixtures, labels, job projections, or historical document state;
- compound titles such as `Chief Strategy and Transformation Officer` normalize correctly;
- no score or recommendation is calculated in AttentionGate.

### Alternate decision checkpoint

Benchmark the local deterministic evaluator on 100, 1,000, and the full canonical pool of validated fixture projections. If evaluation is cheap enough, consider making AttentionGate a scheduling-priority/hard-veto mechanism rather than a general exclusion boundary.

**Checkpoint C5:** approve controlled cohort rematerialization preparation.

## 10. Phase 5 — Offline replay and controlled production recovery

### Step A — offline replay

1. Replay the approved executable contract fixtures with the corrected candidate projection and a prepared context. Perform a separate read-only shadow of the original audited cohort wherever sufficient historical projection/input data exists. Do not fabricate missing fixtures or labels.
2. Do not activate or write to production.
3. Produce a comparison report containing:
   - document-state distribution;
   - projection completeness;
   - eligibility/review/ineligible counts;
   - evaluated/unavailable/sparse counts;
   - valid score distribution for executable evaluated artifacts only;
   - human-vs-machine strong/moderate eligibility recall from the historical shadow, clearly labelled by its available historical input fidelity;
   - false-positive and false-negative examples;
   - idempotency proof.
4. Do not tune score thresholds in this replay.

### Step B — production recovery, separately authorized

Before writes:

1. Record canonical opportunity counts, versions, decisions, active context, active plan, and evaluation counts.
2. Confirm Turso backup/restore or point-in-time recovery capability.
3. Prepare a new immutable candidate profile version, search-plan snapshot, and evaluation context.
4. Keep the currently active context serving while the new context is materialized.

Authorized write boundary:

- new immutable profile/search-plan/context records;
- idempotent search-plan candidate projections;
- idempotent materialized evaluations;
- active pointer change only after coverage and quality verification.

Explicitly prohibited:

- deleting canonical opportunities;
- deleting or rewriting user decisions;
- changing source listing identity;
- serving archived-context evaluations as fallback;
- activating incomplete coverage;
- running a new scrape as part of recovery.

Activation gate:

```text
prepare context
→ project existing canonical pool
→ materialize all eligible/review items
→ validate unavailable/null integrity
→ validate coverage and shortlist projection
→ activate atomically
```

Post-activation proof:

- canonical opportunity count is unchanged;
- no duplicate opportunity/version/evaluation identities;
- decisions are preserved;
- shortlist is a projection of the cumulative pool under the new context;
- no unavailable record carries a decision or score;
- repeated rematerialization is idempotent.

**Checkpoint C6:** approve the Phase 5 Step A offline-evidence review: the
executable contract replay and the explicitly bounded historical eligibility
shadow. This checkpoint does not validate a statistical score distribution or
authorize score-policy changes; scoring-policy changes remain out of scope.

## 11. Phase 6 — Cross-source vacancy canonicalization (separate project)

This is intentionally last because it changes identity semantics and has the largest schema/rollback risk.

### Target model

```text
canonical vacancy
  ├── LinkedIn source listing
  ├── Indeed source listing
  └── Naukri source listing
```

### Requirements

1. Preserve every source listing and acquisition event.
2. Introduce vacancy equivalence using, in descending authority:
   - employer requisition ID;
   - canonical employer/ATS URL;
   - employer identity;
   - normalized title/role family;
   - location/work model;
   - posting time window;
   - content fingerprint.
3. Assign match confidence and evidence.
4. Never merge solely because title/company strings look similar.
5. Support reversible split/merge adjudication.
6. Prove Sterlite, Pylon and Benovymed cases individually.
7. Preserve evaluation and decision lineage when a vacancy cluster changes.
8. Write an ADR and incremental migration plan before implementation.

**Checkpoint C7:** separately approve the canonical-vacancy ADR and schema work.

## 12. Certification strategy

### During phases

1. Run only focused, explicitly named offline tests for the boundary being changed.
2. Do not use unscoped default `npx vitest run`; previous default/full discovery has reached live behavior and mutated `src/data/live-scraped.json`.
3. Do not repeatedly run TypeScript verification immediately before `npm run certify`; certification already owns its TypeScript gate.
4. Do not alter worker count or certification configuration during this repair.

### At each approved code-phase completion

1. Focused canonical suites pass.
2. `npm run certify` passes once.
3. Confirm certification inventory/manifest integrity; add tests only to their authoritative stage when stable and deterministic.

### Deployment

Only after Phase 5 production-write approval:

1. Review final diff and database write plan.
2. Run `npm run certify`.
3. Deploy through the approved deployment path.
4. Run `npm run smoke` against the deployed version.
5. Verify live feed parity, Turso health, evaluation integrity, and shortlist counts.

## 13. Rollback and failure policy

1. No destructive Git commands.
2. No historical migration edits.
3. No production data deletes.
4. Before active pointer change, failure leaves the current context active.
5. A failed prepared context remains inactive and is diagnosable by immutable IDs.
6. Contract violation stops the affected evaluation; it does not manufacture a fallback result.
7. Acquisition failure queues a retry when retryable; it does not become an empty or passed evaluation.
8. If any focused test requires weakening an invariant to pass, stop the phase and report the conflict.

## 14. Definition of done

The repair is complete only when all of the following are true:

- zero synthetic numeric scores or default decisions exist in persistence paths;
- Cvent produces a grounded, non-empty JobProjection from its full JD;
- Cvent is either genuinely evaluated with a valid score or truthfully unavailable with nulls—never synthetic `PASS / 50`;
- the attached candidate resume produces an evidence-grounded SVP projection without unsupported C-suite/EBITDA/board/M&A claims;
- strong and moderate roles are not rejected by literal title mismatch;
- corrupt, redirect, unrelated, and binary payloads cannot be labelled usable JD text;
- all evaluated/unavailable relational columns match their canonical serialized payload;
- repeated projection, evaluation, and rematerialization are deterministic and idempotent;
- canonical pool and decision counts are preserved through context change;
- focused tests, `npm run certify`, deployment, and `npm run smoke` pass;
- score tuning has not begun until a valid post-repair score distribution exists.
