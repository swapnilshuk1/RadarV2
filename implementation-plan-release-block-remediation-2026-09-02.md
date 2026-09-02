# RADAR v2 — Release-Block Remediation Implementation Plan

Date: 02 Sep 2026  
Objective: Resolve the consolidated editorial, functional, and coding-quality findings while keeping the application operational throughout the work.

## Release principle

The application must preserve the existing canonical serving path, database schema, user decisions, and current UI flows. Each phase must be independently compilable and testable. No phase may silently introduce a weaker fallback for missing evidence, tenant scope, database integrity, or distributed storage.

The release bar is:

```text
Every production path that creates, persists, serves, or renders an opportunity
uses the same scope, provenance, evidence, and deployment invariants.
Missing required state fails closed.
```

## Current-state safeguards

Before implementation:

1. Freeze the current working tree and record all existing modified files. Do not overwrite or reset user changes.
2. Create a baseline report containing commit, test inventory, TypeScript result, lint result, build result, and current database/deployment configuration.
3. Confirm the active production routes and callers before deleting or moving any duplicate implementation.
4. Establish a rollback point per phase using a commit or patch archive. Do not use destructive resets.
5. Treat the existing Turso database as authoritative. No data reset, destructive migration, or local persistent SQLite fallback is permitted.

## Phase 0 — Baseline and contract map

### Scope

Read-only inventory of:

- `src/domain/*`
- `src/data/database/*`
- `src/data/sqlite/repositories/*`
- `src/lib/intelligence/{opportunity-service.ts,opportunity-server.ts,server-api.ts}`
- `src/lib/intelligence/editorial/*`
- `src/lib/intelligence/EvaluationWorker.ts`
- `src/lib/intelligence/serving/*`
- `scripts/scrape.ts`, `scripts/enrich.ts`, `scripts/scraper/*`
- certification and test manifests

### Deliverables

- A caller graph for every opportunity creation, persistence, serving, and editorial-render path.
- A contract matrix identifying authoritative types, repository methods, scope inputs, provenance fields, and required failure behavior.
- A list of all `any` uses crossing domain, evaluation, serving, persistence, security, or editorial boundaries.

### Gate

Run:

```text
npx tsc --noEmit
npm run lint
npm run build
npx vitest run --config vitest.certification.config.ts
```

Do not begin implementation if the baseline cannot be reproduced or if uncommitted user work is not accounted for.

## Phase 1 — Establish typed evidence and evaluation states

### Goal

Make absence of evidence representable and non-interchangeable with evaluated evidence.

### Implementation

1. Define discriminated types for evidence/provenance, at minimum:

   - `Observed`
   - `Derived`
   - `Inferred`
   - `Unknown`

2. Define explicit evaluation states:

   - `EVALUATED`
   - `SPARSE_SPEC`
   - `UNEVALUATED`
   - `UNAVAILABLE`

3. Replace core `any` fields with `unknown` plus parsing/validation at boundaries. Prioritize:

   - `Fact.value` and `Inference.output`
   - candidate state/profile payloads
   - persisted worker decisions and veto data
   - serving DTOs and singleflight results
   - editorial context and job projections

4. Keep low-level database-driver casts isolated inside adapter implementations. Do not spread driver casts into services or domain code.

5. Preserve wire/database compatibility by reading existing JSON shapes through explicit decoders before writing any new representation.

### Acceptance tests

- A missing score remains `null`, never `50`.
- A title-derived hypothesis cannot satisfy an evidence-required pattern.
- `SPARSE_SPEC` and `UNEVALUATED` cannot be converted to an evaluated recommendation by type coercion.
- Malformed persisted JSON is rejected or represented as `Unknown`, never asserted as factual.

### Safety

Do not change scoring thresholds, ranking order, database schemas, or UI copy in this phase. This phase only strengthens representation and validation.

## Phase 2 — Fail-closed editorial composition

### Goal

Ensure every production editorial entry point produces evidence-limited output when evidence is insufficient.

### Implementation

1. Introduce one authoritative composition guard used by:

   - `Context.tsx`
   - `EvidenceDrawer.tsx`
   - `BriefCompositionEngine`
   - `EditorialEngine`
   - `NarrativeComposer`
   - any route-level brief builder

2. Call `validateDataSufficiency()` (or its typed replacement) before narrative composition.

3. For sparse/unevaluated states, allow only:

   - explicit data limitation;
   - verified role/company/location facts;
   - questions for recruiter validation;
   - neutral action guidance.

4. Remove unsupported claims about founder ceilings, stealth mandates, P&L ownership, budgets, board reporting, shortlisting probability, or business outcomes unless backed by explicit evidence.

5. Separate `evaluated score` from `missing score`; do not derive certainty from default values.

6. Make certainty a function of evidence state and provenance, not merely score or presence of an unknown preview.

### Acceptance tests

Add runtime-artifact tests for:

- empty description;
- description under 200 characters;
- missing dimensions;
- missing recommendation result;
- title-only `VP`, `CMO`, `COO`, or `CEO` signals;
- missing reporting line/P&L evidence;
- sparse and unevaluated opportunities rendered through each production component.

Each test must assert the composed text itself, not only an internal flag.

### Safety

Keep existing component structure and frozen navigation landmarks. The sparse output should degrade to an evidence-limited view, not a blank page or exception.

## Phase 3 — Remove unsafe alternate paths and restore repository authority

### Goal

Ensure all production callers use the canonical tenant-scoped service and repository boundary.

### Implementation order

1. Confirm no active import of `src/lib/intelligence/server-api.ts` and `src/lib/intelligence/services/OpportunityService.ts`.
2. If unused, remove exports or move them to an explicitly archived/legacy namespace that cannot be imported by production routes.
3. If a caller exists, migrate it to `opportunity-server.ts` and the canonical `opportunity-service.ts` first.
4. Move raw SQL from application/server services into repository methods, preserving SQL and transaction behavior initially.
5. Require every serving call to receive `AuthorizedPersonScope` derived from authenticated membership.
6. Add a repository contract test that rejects unscoped opportunity listing and cross-tenant company/document access.

### Priority files

- `src/lib/intelligence/server-api.ts`
- `src/lib/intelligence/services/OpportunityService.ts`
- `src/lib/intelligence/opportunity-service.ts`
- `src/lib/intelligence/onboarding-server.ts`
- `src/lib/intelligence/AttentionService.ts`
- `src/lib/intelligence/recordSearchPlanCandidate.ts`
- `src/lib/acquisition/CanonicalIngestionService.ts`
- `src/lib/intelligence/EvaluationWorker.ts`

### Safety

Do not change authorization semantics and repository extraction in the same commit as query rewrites. First preserve behavior behind repository methods, then remove duplicate paths after parity tests pass.

## Phase 4 — Make invariant and certification checks fail closed

### Implementation

1. Correct `InvariantAssertions` so missing required gates or editorial payloads fail.
2. Require explicit execution-gate presence for evaluated records.
3. Require editorial payload presence for non-sparse records.
4. Remove tautological assertions and add negative cases for every invariant.
5. Keep sparse records valid only when their state explicitly permits absent editorial synthesis.

### Test database fidelity

1. Enable `PRAGMA foreign_keys = ON` for in-memory SQLite tests.
2. Make migration failures fail test setup immediately; remove empty migration catches.
3. Add lineage tests for orphaned plans, snapshots, contexts, pointers, documents, and evaluations.
4. Run the same invariant suite against SQLite and a controlled Turso adapter where practical.

### Gate

The certification suite must fail when a required artifact is deleted, omitted, malformed, or attached to the wrong tenant.

## Phase 5 — Standardize transaction semantics

### Goal

Prevent SQLite test behavior from diverging from Turso production behavior.

### Implementation

1. Decide and document whether nested repository transactions are supported.
2. If supported, implement savepoints in SQLite and equivalent reuse semantics in Turso.
3. If unsupported, detect nested transactions and fail with a clear contract error in both adapters.
4. Add commit, rollback, nested-call, and partial-failure tests for both adapters.

No schema change is required for this phase.

## Phase 6 — Enforce distributed BlobStore topology

### Implementation

1. Define production configuration requirements for `RADAR_DEPLOYMENT_MODE=distributed`.
2. Make startup/smoke fail before writes when endpoint or bucket configuration is missing.
3. Ensure every distributed worker uses the same remote BlobStore factory; no caller may silently select local filesystem storage.
4. Verify probe write/read/delete and deletion verification.
5. Configure Oracle/PM2 environment explicitly and record the effective backend in deployment diagnostics.

### Acceptance criteria

```text
distributed + valid remote config → remote backend, probe succeeds and is deleted
distributed + missing remote config → startup/smoke fails
non-distributed test mode → explicit test backend only
```

Do not deploy a topology change until remote configuration has been verified on the target host.

## Phase 7 — Scraper and lineage verification

### Implementation

1. Add fixtures representing the exact HTML passed to the LinkedIn fast HTTP extractor.
2. Test both fast Cheerio and Playwright paths using the same company extraction contract.
3. Verify that post-detail company resolution updates the canonical identity and acquisition lineage atomically.
4. Prevent unresolved companies from collapsing unrelated jobs into one ordinary company record; represent unresolved identity explicitly.
5. Add tests for company changes, missing company, duplicate source IDs, and retry/re-enrichment behavior.

No portal selector refactor should be combined with repository or editorial changes.

## Phase 8 — Pattern and UI quality cleanup

### Pattern contracts

1. Decide whether the 40% skeleton distribution is a production invariant.
2. If yes, remove `bypassHistory: true` from production render paths and make fallback selection preserve the cap or fail clearly.
3. If no, remove the invariant and its misleading tests/documentation.
4. Add runtime validation against actual composed opportunity text rather than dummy anchors.

### UI cleanup

1. Replace prohibited arbitrary opacity and pixel classes with registered design-system classes/tokens.
2. Fix Markdown indentation parsing before trimming lines.
3. Run visual smoke checks for shortlist, dossier, decisions, evidence drawer, and sparse states.

These changes are lower priority than evidence, scope, and persistence correctness.

## Phase 9 — Certification expansion and release

### Certification improvements

1. Keep the 37-file certification manifest as the explicit release gate, but report its scope clearly.
2. Add adversarial tests from Phases 1–7 to the authoritative manifest.
3. Add a separate broader repository-quality job that includes regression tests and does not mutate production-like data.
4. Ensure certification reports distinguish:

   - type/lint/build health;
   - contract-suite health;
   - broader test-suite health;
   - deployment configuration health;
   - post-deployment smoke health.

### Required final gates

```text
npx tsc --noEmit
npm run lint
npm run build
npx vitest run --config vitest.certification.config.ts
npm run smoke
```

Then verify on Oracle:

- expected commit is running;
- required environment variables are present;
- remote BlobStore backend is active;
- probe artifacts are deleted;
- tenant-scoped feed/dossier access works;
- sparse and evaluated editorial outputs are both functional.

## Rollback and recovery rules

- Roll back only the phase that failed; do not reset unrelated user changes.
- Database migrations must be additive and reversible where possible; no corpus reset.
- If typed decoders reject existing data, preserve the raw payload and mark it `Unknown`/`UNAVAILABLE`; do not fabricate replacement facts.
- If a new repository method fails, retain the old query only during a bounded migration step with explicit parity tests and a removal date. Do not leave permanent dual authority.
- Deployment rollback requires restoring the previous application commit and verified environment configuration, not silently re-enabling local production storage.

## Definition of done

The release block is cleared only when:

1. No production editorial path composes unsupported claims from sparse or unevaluated data.
2. Missing and heuristic values cannot acquire factual certainty.
3. All active serving paths are tenant-scoped and repository-authoritative.
4. Core invariant assertions fail closed.
5. SQLite tests enforce the relevant production FK and migration semantics.
6. SQLite and Turso transaction behavior is equivalent or explicitly rejects unsupported nesting.
7. Distributed production cannot start with local BlobStore fallback.
8. LinkedIn company extraction is verified against actual fast-path input and preserves lineage.
9. Certification and reporting clearly state their scope.
10. The full release gates and post-deployment smoke checks pass without mutating or resetting user data.

