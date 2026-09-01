# RADAR v2 — Practical Release-Block Remediation Plan (v2)

Date: 02 Sep 2026  
Status: Revised after code audit, capacity review, and secondary plan review.  
This document supersedes the earlier broad remediation sequence where the two differ.

## Release objective

Make the existing single-host/Turso application truthful and safe without introducing a second production source of truth or an unnecessary distributed platform.

Release readiness requires:

```text
active production paths preserve tenant scope and evidence provenance;
missing required state fails closed;
Turso remains authoritative for canonical state;
deployment mode is explicit and verified.
```

## Operating constraints

- Turso Free is capacity-constrained for large text and write-heavy ingestion. Measure actual storage, 4 KB page reads/writes, and payload growth before changing topology.
- Local SQLite may be used for tests, disposable analysis, or a bounded ingestion spool. It must not become production authority for opportunities, decisions, evaluations, or tenant state.
- Single-host mode may use a bounded local artifact spool for raw HTML/debug payloads. Distributed mode requires remote BlobStore configuration.
- Raw HTML and full portal responses are acquisition artifacts. Canonical Turso rows should contain compact normalized fields, bounded evidence excerpts, hashes, and lineage metadata.
- Repository-wide `any` removal, full transaction redesign, and distributed worker orchestration are not release prerequisites unless a measured production trigger exists.

## Phase 0 — Baseline and capacity measurement

Record the current commit, dirty files, active route callers, database size, artifact directory size, average/max raw payload sizes, bytes/rows written per representative scrape, serving latency, and query plans for feed/dossier/metrics.

Set warning thresholds for Turso usage and local spool growth. Do not redesign storage from row counts alone.

Gate:

```text
npx tsc --noEmit
npm run lint
npm run build
npx vitest run --config vitest.certification.config.ts
```

## Phase 1 — Typed evidence and evaluation boundary

Target only active production boundaries:

- persisted evaluation decisions and veto state;
- tenant-scoped serving DTOs/singleflight;
- editorial context and job projections;
- persisted JSON decoders;
- repository/application inputs.

Introduce explicit `Observed`, `Derived`, `Inferred`, and `Unknown` provenance, plus `EVALUATED`, `SPARSE_SPEC`, `UNEVALUATED`, and `UNAVAILABLE` states.

Keep low-level database-driver casts isolated. Do not rewrite unrelated UI, scripts, or legacy fields unless they cross an active boundary.

Acceptance:

- missing score stays `null`, never `50`;
- title-only P&L remains a hypothesis;
- malformed persisted JSON becomes `Unknown`/`UNAVAILABLE`;
- sparse states cannot be coerced into evaluated states.

## Phase 2 — Fail-closed editorial output

Route every production editorial entry point through one typed evidence guard, including `Context`, `EvidenceDrawer`, `BriefCompositionEngine`, `EditorialEngine`, `NarrativeComposer`, and route-level brief builders.

For sparse/unevaluated opportunities, render only verified identity facts, explicit limitations, recruiter questions, and neutral next-step guidance. Remove unsupported claims about budgets, board reporting, founder ceilings, transformation mandates, or shortlisting probability.

Acceptance tests must assert actual rendered text for empty/short descriptions, missing dimensions, missing recommendation results, title-only seniority, and missing provenance. Normal evaluated opportunities must retain their existing core fields and decisions.

## Phase 3 — Tenant safety and alternate-path removal

1. Confirm callers of `src/lib/intelligence/server-api.ts` and `src/lib/intelligence/services/OpportunityService.ts`.
2. Migrate any real caller to the canonical scoped service.
3. Quarantine or remove unused unscoped exports.
4. Add cross-tenant tests for feed, dossier, company/document lookup, and explanation access.

Do not combine authorization changes with broad query rewrites. Preserve behavior first, then remove duplicate authority.

## Phase 4 — Fail-closed assertions and persistence fidelity

Fix invariant assertions so missing execution gates, editorial payloads, malformed records, and wrong-tenant attachments fail. Add negative tests.

For in-memory SQLite tests:

- enable foreign keys;
- fail immediately on migration errors;
- test orphaned lineage and invalid references;
- keep Turso authoritative for integration data.

Do not reset the production corpus or introduce a local canonical database.

## Phase 5 — Compact persistence and artifact policy

Before moving storage, measure whether the current Turso dataset and scrape workload fit the free-tier budget.

Implement only the minimum policy needed:

- canonical rows store compact fields and bounded evidence;
- raw artifacts have size limits, retention, cleanup telemetry, and explicit purpose;
- normal serving/evaluation does not require raw artifact availability;
- failed artifact writes cannot roll back or corrupt canonical identity/decisions.

Use a bounded local spool in single-host mode if it is operationally necessary. Add remote object storage only when durability across hosts or actual distribution is required.

## Phase 6 — Explicit deployment mode

Define two supported modes:

```text
single-host
  Turso canonical state
  bounded local artifact spool

distributed
  Turso canonical state
  remote BlobStore required
```

Startup and smoke checks must reject ambiguous configuration. In distributed mode, missing endpoint/bucket fails before processing. In single-host mode, diagnostics must report local spool size and cleanup status.

Do not make S3/R2 a current release prerequisite for the single-host deployment.

## Phase 7 — Active-path repository and type cleanup

After correctness and scope gates pass, move raw SQL out of active application/server boundaries and replace `any` only where it crosses:

- evaluation decisions;
- tenant-scoped serving;
- editorial composition;
- persisted JSON/domain decoding;
- repository/application interfaces.

Leave low-impact driver, generated, diagnostic, and unrelated legacy casts for follow-up work. Add parity tests before removing old query implementations.

## Phase 8 — Scraper lineage verification

Verify LinkedIn company extraction against the exact HTML passed to the fast path and Playwright path. Ensure post-detail identity updates are atomic and unresolved companies cannot collapse unrelated jobs into one ordinary company record.

This phase must not be combined with repository rewrites or editorial copy changes.

## Phase 9 — Optional quality work, not release blockers

Pattern diversity requires a product decision:

- If it is a product invariant, enforce it on production composition paths and test the actual session behavior.
- If it is a design preference, remove it from certification claims and defer it.

UI token cleanup, Markdown nesting, complete transaction abstraction redesign, broad legacy-service replacement, database-per-tenant architecture, and distributed worker coordination are follow-up work unless triggered by measured need or an incident.

## Final release gates

```text
npx tsc --noEmit
npm run lint
npm run build
npx vitest run --config vitest.certification.config.ts
npm run smoke
```

Additionally verify:

- sparse and evaluated editorial render paths;
- cross-tenant feed/dossier isolation;
- missing-gate and malformed-payload failures;
- FK and migration-failure behavior;
- Turso usage delta and database growth;
- explicit single-host or distributed mode;
- artifact retention and cleanup;
- no decision or serving path depends on raw dumps.

## Rollback rules

- Roll back one phase at a time; preserve unrelated user changes.
- Use additive/reversible migrations only; never reset or delete the corpus.
- Preserve rejected raw payloads as `Unknown`/`UNAVAILABLE`; do not fabricate replacements.
- Do not leave permanent dual authorities after a bounded compatibility migration.
- Deployment rollback restores the prior application commit and explicit mode configuration.

## Trigger-based deferred work

Reconsider distributed storage, higher Turso plans, transaction redesign, or broader type cleanup only when one of these is observed:

- a second worker/host is introduced;
- artifact volume approaches its disk budget;
- Turso usage exceeds approximately 60–70% of quota;
- large-text reads measurably degrade latency or quota;
- a production incident demonstrates the deferred gap.

