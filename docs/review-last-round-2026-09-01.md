# Last-Round Change Review — 01 Sep 2026

## Verdict

**Do not approve this change set as-is.** Several architectural and durability contracts are compromised.

No application code was modified during this review.

## Findings

### P0 — Distributed BlobStore contract is bypassed

`scripts/smoke_production.ts` treats the `local_filesystem` BlobStore backend as a successful distributed-health result. This contradicts the multi-instance, cloud-safe payload contract: workers on different hosts cannot share local filesystem storage.

The production smoke check currently reports this exact condition as successful.

- File: `scripts/smoke_production.ts`
- Lines: 131–134

### P1 — The authoritative resolved plan is not persisted with the run

Authenticated scraping resolves an authoritative plan, but the durable `scrape_runs` write uses the optional input ID or the literal `default`, rather than `resolvedPlan.searchPlanId`.

If a valid active plan exists without an active-context pointer, the run can be misattributed or fail the `search_plan_id` foreign key.

- File: `scripts/scrape.ts`
- Lines: 235–242

### P1 — Active evaluation context can drift to a different snapshot

When an active context is provided, `ScraperPlanResolver` selects the newest snapshot for its plan rather than the snapshot attached to the active context fingerprint. It also does not require an explicitly selected plan to remain active.

This breaks immutable evaluation-context lineage and active-pointer precedence.

- File: `src/lib/intelligence/ScraperPlanResolver.ts`
- Lines: 60–80

### P1 — Fixed fallback searches remain in authenticated mode

The resolver still synthesizes VP/Head/Chief, Marketing/Growth, and location defaults when persisted criteria are incomplete. This contradicts the stated zero-fallback invariant: an incomplete plan should fail explicitly rather than launch unrelated searches.

- File: `src/lib/intelligence/ScraperPlanResolver.ts`
- Lines: 122–135

### P1 — Raw SQL is executed from a domain service

`ScraperPlanResolver` performs raw SQL through `DatabaseAdapter` from `src/lib/intelligence`. The repository contract requires data access to pass through `StorageProvider` repositories; services must not execute raw SQL.

- File: `src/lib/intelligence/ScraperPlanResolver.ts`
- Lines: 60–80

### P2 — LinkedIn missing-company recovery does not reach enrichment

LinkedIn discovery now allows cards with no company name, but the subsequent strict pre-filter rejects those cards before detail extraction. The recovery path is therefore ineffective.

The new test only validates the filter in isolation, not the full scraper path.

- File: `scripts/scrape.ts`
- Lines: 761–770

### P2 — Smoke probes are retained

The latest smoke-reporting change no longer deletes its BlobStore probe object. Each smoke run leaves a mutable probe artifact; three such files were observed under `.radar/artifacts/blobs/snapshots/` during this review.

## Verification performed

| Check | Result |
| --- | --- |
| Targeted scraper and tenant tests | Passed: 33/33 |
| TypeScript check (`npx tsc --noEmit`) | Passed |
| Production build (`npm run build`) | Passed |
| Production smoke (`npm run smoke`) | Passed after network access was allowed; reported local-filesystem BlobStore |
| Full certification (`npm run certify`) | Not confirmed: the execution runner stopped reporting after Stage 1 and never returned a terminal certification result |

## Recommended disposition

Block approval until the P0 and P1 findings are resolved and covered by end-to-end contract tests. The smoke suite should require a distributed object-store backend for distributed deployment certification and must clean up its probe object.
