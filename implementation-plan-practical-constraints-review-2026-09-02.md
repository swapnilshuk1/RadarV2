# Practical-Constraints Review of the Remediation Plan

Date: 02 Sep 2026

## Conclusion

The original remediation plan is directionally correct but too broad for the current operating model. RADAR is currently a small, single-host application backed by Turso’s free tier. The plan should prioritize user-visible correctness and tenant safety, while deferring platform work that does not provide a material benefit today.

Turso’s current Free plan lists 5 GB storage, 500 million monthly rows read, 10 million monthly rows written, and 3 GB monthly sync. Turso measures usage in 4 KB database pages, so large text values and unindexed scans can consume quota faster than row counts suggest. [Turso pricing](https://turso.tech/pricing), [Turso usage and billing](https://docs.turso.tech/help/usage-and-billing)

## Practical architecture to target now

### Keep Turso authoritative for compact canonical state

Turso should contain:

- canonical opportunity identity and version metadata;
- normalized role, company, location, source, and timestamps;
- bounded evidence excerpts and hashes;
- evaluation state, score, provenance, and decision records;
- tenant, plan, lease, and lineage metadata.

### Do not push large raw dumps into every canonical row

Raw HTML, full portal responses, screenshots, and debugging payloads should be treated as acquisition artifacts, not serving data. The scraper should:

1. extract and persist the compact fields needed for evaluation;
2. persist bounded excerpts/hashes for traceability;
3. retain raw artifacts only when needed for investigation or replay;
4. apply a size limit and retention policy to artifacts.

This avoids paying Turso read/write/page costs for data the executive UI never reads.

### Do not introduce production local SQLite as a second source of truth

Local SQLite is reasonable for:

- unit tests;
- disposable offline analysis;
- a bounded ingestion spool before canonical Turso commit.

It must not become the authoritative production store for opportunities, decisions, evaluation state, or tenant data. That would create reconciliation, backup, and failover problems greater than the original issue.

### Keep single-host operation explicit

There is no immediate need to require distributed workers and an object store if the application runs on one Oracle host. Use an explicit single-host mode with a bounded local artifact spool, or configure remote object storage only when a second worker/host is actually introduced.

The important rule is not “always use S3.” It is:

```text
single-host mode → bounded local temporary artifacts are allowed
distributed mode → remote BlobStore is mandatory
```

Do not silently switch modes based on missing variables.

## Revised implementation priority

### Must do now — high value, low operational risk

1. Fail-closed editorial output for sparse and unevaluated opportunities.
2. Prevent missing scores and title heuristics from becoming factual certainty.
3. Remove/quarantine the duplicate unscoped server API.
4. Add tenant-scope tests to the active serving path.
5. Make invariant assertions fail closed.
6. Add adversarial tests for missing gates, missing payloads, missing evidence, and malformed persisted JSON.
7. Add Turso quota and payload-size telemetry before changing storage behavior.

These directly reduce user and security risk without requiring a new infrastructure layer.

### Do next — only where the active path benefits

1. Move raw SQL out of active server/serving paths into repositories.
2. Replace `any` at domain/evaluation/serving boundaries touched by the above paths.
3. Enable foreign keys in test SQLite and fail migration setup immediately.
4. Add query-plan checks and indexes for high-volume serving queries.
5. Add bounded raw-artifact retention and cleanup.

Do not attempt a repository-wide `any` elimination or a complete service rewrite in one change set.

### Defer until justified by measured need

- Full distributed worker coordination.
- Mandatory S3/R2 migration for a single-host deployment.
- Database-per-tenant topology.
- Complete transaction abstraction redesign.
- Broad replacement of every legacy service.
- Rewriting all domain `any` fields that do not cross an active production boundary.
- Large-scale editorial pattern redesign.

Each deferred item should have a trigger, such as a second worker host, artifact volume approaching a defined disk limit, Turso write/read usage above 60–70% of quota, or a demonstrated production incident.

## Storage budget and operational controls

Before implementation changes, measure on the live dataset:

- total database size;
- count and average/max byte size of `documents.content` and `opportunity_versions.raw_content`;
- bytes written per scrape run;
- rows/pages read by feed, dossier, and metrics queries;
- artifact directory size and daily growth;
- percentage of raw artifacts actually read during evaluation/serving.

Set conservative operating alerts:

- Turso storage at 60%, 75%, and 90% of free-tier capacity;
- monthly writes/reads at 60%, 75%, and 90% of quota;
- local artifact spool at 50%, 75%, and 90% of its disk budget;
- oldest unprocessed artifact age;
- failed cleanup count.

Avoid full-table scans of large text columns in serving or diagnostics. Use hashes, indexed metadata, bounded excerpts, and explicit pagination.

## Revised phase gates

### Gate A — Correctness

Sparse editorial output, missing evaluation state, title-only P&L, and missing execution gates must fail safely while the normal evaluated UI remains unchanged.

### Gate B — Scope

Every active route and server function must resolve the authenticated tenant/person scope. The duplicate legacy API must be unreachable or removed before release.

### Gate C — Persistence

Tests must enforce foreign keys and migration errors. Canonical Turso writes must remain compact and idempotent. Raw artifacts must not be required for normal serving.

### Gate D — Capacity

Run a representative scrape/evaluation batch and record Turso usage deltas, database growth, latency, and local spool growth. Stop and redesign if the batch threatens free-tier budgets.

### Gate E — Deployment

Single-host deployments must declare single-host mode and verify bounded local artifact retention. Distributed deployments must fail fast without remote BlobStore configuration.

## What “no breakdowns” means operationally

- Existing evaluated opportunities still render the same core fields and decisions.
- Sparse opportunities render a useful evidence-limited view, not a blank page or crash.
- User decisions remain in Turso and are never dependent on raw artifact availability.
- A failed artifact write does not corrupt canonical identity or evaluation state.
- Cleanup failure produces telemetry and bounded retry, not silent disk growth.
- Turso quota pressure blocks nonessential raw-artifact writes before it blocks decisions or serving.
- Rollback restores the previous application commit without database reset or corpus deletion.

## Recommended plan adjustment

Adopt the original plan’s Phases 1, 3, 4, and the essential parts of Phase 6 immediately. Insert this capacity/storage phase before any BlobStore migration. Split the remaining type cleanup, transaction redesign, pattern-diversity work, and UI cleanup into measured follow-up work.

The resulting strategy is intentionally conservative:

```text
fix correctness and scope first
→ measure payload and quota reality
→ keep Turso compact and authoritative
→ use bounded local artifacts only for single-host acquisition
→ add remote BlobStore only when distribution is real
```

