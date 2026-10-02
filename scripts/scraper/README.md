# RADAR acquisition and enrichment

The acquisition pipeline preserves portal capability, source identity, payloads
and durable scrape orchestration for LinkedIn, Indeed and Naukri. It hands off to
the evaluation scheduler; a successful scrape alone does not establish that an
opportunity has an evaluation, dossier or serving publication.

```text
Scrape run -> portal capture -> preserved payload -> canonical opportunity/version
           -> exact enrichment job -> evaluation requirement -> staged worker
```

| Responsibility | Entry point |
| --- | --- |
| Scrape orchestration | `scripts/scrape.ts`, `scripts/scraper/run/` |
| Portal adapters | `scripts/scraper/portals/` |
| Payload and ingestion persistence | `scripts/scraper/persist/`, `src/lib/storage/blob-store.ts` |
| Enrichment leases, completion and dependency release | `scripts/scraper/persist/queue.ts`, `scripts/enrich.ts` |
| Evaluation scheduling | `src/evaluation/work-scheduler.ts` |
| Staged worker | `npm run worker:evaluations` (`scripts/run-evaluation-worker.ts`) |

The configured database and canonical source/version lineage are authoritative.
`live-scraped.json` is not the serving system of record. The laptop uploads to OCI;
Oracle verifies references and processes without access to laptop files. Migration
071 provides a database-backed execution lease alongside run leases and local
profile locks. Oracle portal acquisition is disabled.

`--fresh-source` (alias `--fresh`) bypasses source snapshots; `--new-run` permits a
valid cache. The acquisition worker cleans acknowledged staging after seven days,
inactive debug caches after seven days and known terminal run files after thirty
days. Pending uploads and canonical sources are protected. See
[OCI storage](../../docs/OCI_STORAGE.md) for exact rules and inspection commands.

Dependency matching uses canonical job, opportunity version and required
enrichment pipeline identity. Do not force waiting rows through evaluation,
fabricate enrichment completion or infer account ownership for unattributed blobs.
Follow the [backfill runbook](../../docs/operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md)
to reconcile captures that have not reached the end user.

Inspect CLI flags and the explicit database target before invoking `npm run
scrape`, `npm run scrape:preflight` or `npm run enrich`. These commands are not
read-only inventory tools. `scrape:preflight` launches an offline Chromium instance,
so Playwright/Chromium is required only on a machine that actually runs scraper
preflight or browser scraping. It is not a generic web, Pursuit, dossier,
certification or pre-production deployment dependency. Production execution follows
the approved plan.
Generated browser proofs go under `.radar/portal-browser-proof`; reusable DOM
snapshots are under `tests/fixtures/acquisition/portal-snapshots`.
