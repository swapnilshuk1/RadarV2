# RADAR v2 — Practical Release-Block Remediation Plan v2.1

Date: 02 Sep 2026
Status: Authoritative working plan after advisory adjudication.

## Release position

Release remains blocked until Phases 1–4 and the required operational controls in Phases 5–6 are complete and demonstrated on active production paths. Phases 7–9 are follow-up work unless they reveal a release-impacting defect.

The objective is to make the current single-host/Turso architecture enforce its existing contracts. This is not a distributed-system rewrite.

## Non-negotiable invariants

### State and provenance cannot be implicitly promoted

```text
Inferred → Observed       prohibited
Unknown → Derived         prohibited
UNEVALUATED → EVALUATED   prohibited
null score → 50           prohibited
title → P&L fact          prohibited
```

Movement toward greater certainty requires an explicit evidence-bearing operation with provenance.

### Editorial composition has one mandatory pipeline

```text
Typed Editorial Input
        ↓
Evidence Sufficiency Guard
        ↓
Composition
        ↓
Runtime Output Validation
        ↓
render/return
```

No production caller may invoke a lower-level narrative function while bypassing this sequence.

### Canonical data is independent of artifacts

```text
artifact missing → evaluation/serving still works from canonical state
canonical state missing → artifact replay is not an acceptable serving model
```

Turso remains authoritative for identity, evaluation, decisions, scope, and lineage.

## Phase 0 — Baseline and capacity measurement

Record commit, dirty files, active callers, database size, raw-content size distribution, artifact growth, writes/pages per representative scrape, serving latency, and query plans.

Define budgets and alerts for Turso storage/read/write usage and local artifact spool growth. Measure before changing storage topology.

Baseline gate:

```text
npx tsc --noEmit
npm run lint
npm run build
npx vitest run --config vitest.certification.config.ts
```

## Phase 1 — Typed active-boundary states

Introduce the minimum discriminated types required on active paths:

- provenance: `Observed | Derived | Inferred | Unknown`;
- evaluation state: `EVALUATED | SPARSE_SPEC | UNEVALUATED | UNAVAILABLE`.

Apply first to persisted decisions/veto state, tenant-scoped serving, editorial inputs, persisted JSON decoders, and repository/application interfaces. Keep driver/generated/diagnostic casts out of this phase.

Acceptance:

- missing score remains `null`;
- title-derived P&L remains a hypothesis;
- malformed persisted JSON becomes `Unknown`/`UNAVAILABLE`;
- no implicit state/provenance promotion is possible.

## Phase 2 — Fail-closed editorial pipeline

Make every production editorial route use the same typed guard and runtime validator. This includes `Context`, `EvidenceDrawer`, `BriefCompositionEngine`, `EditorialEngine`, `NarrativeComposer`, and route-level builders.

Sparse/unevaluated output may contain only verified identity facts, explicit limitations, recruiter questions, and neutral next-step guidance. It must not claim budgets, board reporting, founder ceilings, transformation mandates, or shortlisting probability without explicit evidence.

Acceptance tests must assert actual rendered text for empty/short descriptions, missing dimensions, missing recommendation results, title-only seniority/P&L signals, missing provenance, and malformed records. Normal evaluated opportunities must retain their substantive behavior.

## Phase 3 — Tenant safety and alternate-path closure

Migrate any real caller of `server-api.ts` or the legacy opportunity service to the canonical scoped service. Quarantine or remove unused exports only after import/build verification.

Mechanical acceptance checks:

```text
legacy getOpportunitiesFn → zero production callers
legacy unscoped service   → zero production callers
direct company/document SQL → zero active server-path callers
```

Add cross-tenant feed, dossier, company/document, and explanation denial tests.

## Phase 4 — Fail-closed certification and test fidelity

Required artifacts must not be absent while reporting `passed: true`.

Negative tests must prove:

```text
missing execution gate       → FAIL
missing presentation payload → FAIL
missing editorial result     → FAIL
malformed persisted result   → FAIL
wrong-tenant attachment      → FAIL
```

Enable SQLite foreign keys for contract tests and fail migration setup immediately. Deliberately FK-off tests, if any, must be isolated and explicitly named. Do not reset or rewrite the production corpus.

## Phase 5 — Compact persistence and capacity-safe artifacts

Keep canonical Turso rows compact: normalized fields, bounded evidence excerpts, hashes, and lineage metadata. Raw HTML/debug payloads are bounded acquisition artifacts with size limits, retention, cleanup telemetry, and explicit purpose.

Single-host local spool is permitted only if:

- it has explicit byte/file limits and retention;
- cleanup status is observable;
- serving/evaluation does not require it;
- quota pressure rejects nonessential artifact writes before canonical writes;
- user decisions and lineage never exist only there.

Add a no-quota-starvation test demonstrating that artifact pressure cannot block canonical identity, decisions, or serving.

## Phase 6 — Explicit deployment mode

Support exactly two declared modes:

```text
single_host  → Turso canonical state + bounded local artifact spool
distributed  → Turso canonical state + remote BlobStore required
```

Unknown or missing mode must fail configuration validation rather than silently selecting a backend. Startup and diagnostics must report resolved mode, canonical store, artifact backend, artifact budget, and cleanup status.

Remote object storage is not a release prerequisite for the current single-host deployment.

## Phase 7 — Targeted active-path quality cleanup

After Phases 1–4 pass, move raw SQL out of active server/serving/security paths and replace `any` only where it can alter evaluation decisions, tenant scope, editorial output, persisted JSON interpretation, or repository contracts.

Use parity tests before removing old queries. Defer unrelated driver, generated, diagnostic, and legacy casts.

## Phase 8 — Scraper and lineage verification

Test LinkedIn company extraction against the exact fast-path HTML and Playwright HTML. Ensure identity updates are atomic and:

```text
Unknown company ≠ ordinary canonical company
```

Unresolved identity must not become a shared key joining unrelated postings.

## Phase 9 — Conditional follow-up quality work

Pattern diversity requires a product decision. Enforce it only if it is a real product invariant; otherwise remove it from certification claims.

Transaction abstraction redesign, broad `any` elimination, distributed workers, database-per-tenant, mandatory S3/R2 for single-host, duplicate-service cleanup beyond active paths, and UI polish remain deferred unless triggered by measured need or an incident.

## Three-dimensional release gate

### Code gate

```text
npx tsc --noEmit
npm run lint
npm run build
npx vitest run --config vitest.certification.config.ts
npm run smoke
```

### Behavioral gate

Demonstrate on actual production paths:

- sparse and unevaluated opportunities;
- missing score and dimensions;
- title-only seniority/P&L signals;
- missing provenance, gates, or editorial payload;
- malformed persisted result;
- cross-tenant access attempt.

All must fail safely, while a normal evaluated opportunity retains identity, evaluation, decision, explanation, and core rendered behavior.

### Operational gate

Demonstrate:

- explicit deployment mode;
- Turso authoritative;
- bounded artifact spool and functioning cleanup;
- measured Turso usage and database growth;
- no serving dependency on raw artifacts;
- distributed mode fails without remote BlobStore configuration.

## No-regression gate

Before and after the remediation, compare representative evaluated opportunities for:

- identity and core fields;
- evaluation and decision;
- explanation/provenance;
- serving latency;
- normal UI rendering.

The remediation may change behavior where evidence is insufficient or a contract is violated. It must not silently alter substantive behavior for normally evaluated opportunities.

## Rollback and triggers

- Roll back one phase at a time; preserve unrelated user changes.
- Use additive/reversible migrations; never reset or delete the corpus.
- Preserve rejected data as `Unknown`/`UNAVAILABLE`; never fabricate replacements.
- Remove compatibility paths after bounded parity verification, not before.

Reconsider deferred infrastructure or broad cleanup only when a second host/worker appears, artifact/disk or Turso usage approaches budget, large-text latency becomes material, or an incident demonstrates the gap.
