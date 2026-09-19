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
| Evaluation scheduling | `src/lib/intelligence/EvaluationWorkScheduler.ts` |
| Staged worker | `scripts/process-staged-evaluation-jobs.ts` |

The configured database and canonical source/version lineage are authoritative.
`live-scraped.json` is not the serving system of record. Local payload paths must
be readable by the intended worker host; retaining a blob on another machine does
not satisfy that dependency.

Dependency matching uses canonical job, opportunity version and required
enrichment pipeline identity. Do not force waiting rows through evaluation,
fabricate enrichment completion or infer account ownership for unattributed blobs.
Follow the [backfill runbook](../../docs/operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md)
to reconcile captures that have not reached the end user.

Inspect CLI flags and the explicit database target before invoking `npm run
scrape`, `npm run scrape:preflight` or `npm run enrich`. These commands are not
read-only inventory tools. Production execution follows the approved plan.
Generated browser proofs go under `.radar/portal-browser-proof`; reusable DOM
snapshots are under `tests/fixtures/acquisition/portal-snapshots`.
