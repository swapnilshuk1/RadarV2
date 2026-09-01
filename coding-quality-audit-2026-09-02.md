# RADAR v2 Coding Quality Audit

Date: 02 Sep 2026  
Mode: Read-only review; no source-code changes made.

## Audited areas

| Area | Code reviewed | Contract focus |
|---|---|---|
| Domain contracts | `src/domain/entities.ts`, `src/domain/repositories.ts` | Type safety and repository boundaries |
| Persistence | `src/data/database/*`, SQLite repositories, migrations | `DatabaseAdapter`, transactions, FK/test fidelity |
| Serving | `src/lib/intelligence/opportunity-queries.ts`, `opportunity-service.ts`, `serving/singleflight.ts` | Tenant scope, DTOs, pagination, singleflight |
| Evaluation | `src/lib/intelligence/EvaluationWorker.ts`, `evaluation/*`, engines | Decision/evaluation invariants and persisted results |
| Editorial | `src/lib/intelligence/editorial/*`, editorial components | Evidence, certainty, runtime prose contracts |
| Server/API | `src/lib/intelligence/*-server.ts`, `src/lib/auth/*`, routes | Auth, repository-only access, input/output typing |
| Acquisition/scraping | `scripts/scraper/*`, `scripts/scrape.ts`, acquisition services | Identity, lineage, payload and lease contracts |
| Tests/gates | `tests/*`, `scripts/certify.ts`, certification manifest | Coverage, enforceability, false-positive risk |

## Executive assessment

The TypeScript build and ESLint pass, and the declared `DatabaseAdapter`/`OpportunityQueries` interfaces are structurally sound. However, the implementation does not consistently preserve those contracts: `any` is used in core evaluation, serving, domain, and persistence boundaries; several services and server functions bypass repositories with raw SQL; and some invariant assertions are permissive or tautological. These are quality and maintainability risks, with security impact where scope-aware services are bypassed.

## Findings

### P1 — Tenant-safe serving has a duplicate unscoped API path

`src/lib/intelligence/server-api.ts` defines a second `getOpportunitiesFn` using the legacy `services/OpportunityService`. It authenticates the user but calls `getActiveOpportunities()` without a tenant/person scope, then performs direct company/document SQL reads. The active routes use `opportunity-server.ts`, so this is currently a dormant but dangerous exported server contract: any future import can expose cross-tenant opportunities.

### P1 — Repository boundary is violated by core services and server functions

Raw SQL is present in `src/lib/intelligence/server-api.ts`, `onboarding-server.ts`, `opportunity-service.ts`, `AttentionService.ts`, `recordSearchPlanCandidate.ts`, `EvaluationWorker.ts`, and `CanonicalIngestionService.ts`. The repository abstraction is therefore not the sole data-access boundary described by the architecture. This makes authorization, transaction policy, and schema evolution inconsistent across entry points.

### P1 — `any` crosses core contracts, not just UI adapters

Representative core uses include:

- `src/domain/entities.ts`: `Fact.value`, `Inference.output`, `CandidateProfile.experience`, `preferences`, and policy `rules` are `any`-typed.
- `src/domain/repositories.ts`: candidate state is `Promise<any>`/`state: any`.
- `src/lib/intelligence/EvaluationWorker.ts`: `decision: null as any`, `decision as any`, and `(presented as any)?.vetoed` sit on the persisted evaluation path.
- `src/lib/intelligence/serving/singleflight.ts`: `Map<string, Promise<any>>`, global state `as any`, and calls through `(this.inner as any)` sit on the tenant-scoped serving path.
- `src/lib/intelligence/editorial/EditorialContext.ts` and `EditorialValidator.ts`: policy/result context and runtime role fields use `as any`.
- `src/data/database/sqlite.ts` and `turso.ts`: adapter parameters/results are cast through `any[]`/`any` at the database boundary.

The casts in the low-level driver are understandable compatibility shims, but the worker, serving, and domain uses can hide malformed decisions, missing scope fields, and DTO drift while still passing `tsc`.

### P1 — Canonical invariant assertions contain false-positive logic

`src/lib/intelligence/evaluation/InvariantAssertions.ts` treats a missing execution gate as passing, treats a missing editorial/presentation payload as passing, and `verifyEditorialPresence()` returns `passed: true` on every branch. These assertions are used as shared certification logic, so they cannot detect several classes of malformed recommendation records.

### P1 — Test database intentionally disables foreign keys

`src/data/database/index.ts` sets `PRAGMA foreign_keys = OFF` for in-memory tests and suppresses migration errors with empty catches. This allows impossible lineage states and can make persistence suites pass while production constraints would reject the same writes. The adapter contract itself is valid, but test fidelity is not.

### P2 — Transaction implementations are asymmetric

`SqliteAdapter.transaction()` issues `BEGIN`/`COMMIT` directly and has no nested-transaction/savepoint handling. `TursoAdapter.transaction()` implements nested transactions by reusing the same transaction adapter. Repository code that nests transactions can therefore behave differently under SQLite tests and Turso production.

### P1 — Editorial quality remains under-typed and evidence-unsafe

The editorial modules rely on `any` opportunity/job projections and default values. This compounds the previously identified runtime issue: low-evidence inputs can receive confident prose. The type layer does not express “unevaluated,” “sparse,” or provenance requirements strongly enough to prevent composition.

### P2 — Certification scope is intentionally narrower than the repository

The certification manifest contains 37 files, while the repository contains substantially more test files across regression and non-manifest suites. `test:full` excludes regression tests, and the certification gate reports logical stages from one manifest invocation. This is coherent as a release gate, but a green gate must not be interpreted as a full repository-quality result.

### P2 — Dead/duplicate implementations increase drift risk

There are duplicate opportunity services (`src/lib/intelligence/opportunity-service.ts` and `src/lib/intelligence/services/OpportunityService.ts`) and duplicate server API contracts. The legacy path is less scope-safe and less typed. Keeping both exported makes accidental regression likely.

## Valid contracts

- `DatabaseAdapter` method shape and `OpportunityQueries` DTO signatures are clear and internally consistent.
- Active opportunity routes use authenticated user scope through `opportunity-server.ts` and the canonical serving service.
- `TursoAdapter` and `SqliteAdapter` both implement the declared adapter methods.
- Certification manifest inclusion is mechanically derived for its declared 37-file scope.
- ESLint and TypeScript verification currently pass.

## Recommended remediation order

1. Remove or quarantine the unscoped duplicate server API and legacy service.
2. Enforce repository-only access for application services/server functions.
3. Replace `any` at domain, worker, serving, and editorial boundaries with discriminated types and `unknown` validation.
4. Make invariant assertions fail closed and add adversarial tests for missing gates/payloads.
5. Enable FK enforcement in tests and fail migration setup immediately.
6. Standardize transaction nesting semantics across SQLite and Turso.
7. Add sparse/unevaluated editorial contract tests and make rendering provenance-aware.

