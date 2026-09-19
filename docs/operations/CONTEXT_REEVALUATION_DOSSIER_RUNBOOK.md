# First scrape and executive memo readiness

Use the canonical `Radar V2` checkout. The production path is staged-v8 evaluation
followed by dossier-v4.1 memo composition. Template B is the sole layout. Historical
population backfill is outside the current scope; do not run population recovery
or `complete-staged-rollout.ts` to prepare the first fresh scrape.

## Local proof

Run typecheck, the production build and the certification manifest at the exact
release commit. `scripts/dossier/validate-memo.ts` accepts an explicit local SQLite
source, a distinct `.radar` output directory and up to three selected job IDs.
It opens the source read-only, copies it, probes Bedrock and Gemini once, composes
through ProductionStagedDossierService, publishes only to the private copy and
checks exact serving DTOs. It retains durable checkpoints and refuses PASS jobs.
A resume uses the same output directory; do not discard successful checkpoints.

Inspect actual memos for the WPP and Artificilux examples; retain JioStar's current
PASS evaluation without forcing it into memo composition. Assess source
support, distinct arguments, material coverage, readability and responsive layout;
never require identical wording. Open evidence controls and preparation tabs.
Check the sticky section rails at the middle and end of a desktop section and
normal document flow on mobile. Retain the generated JSON and render evidence.

## Fresh-scrape preparation

Confirm the intended tenant/person, current candidate profile/source binding,
search-plan criteria and canonical opportunity identity. Use the existing scraper
plan preview; do not change search criteria as part of memo preparation.
Verify Tavily configuration and company identity mappings, Bedrock credentials,
Gemini ADC/project access, migration 051, blob persistence and worker configuration.
Never copy credentials into Git or log their contents.

The scrape must target an approved active staged-v8 context. The current legacy
active pointer is not automatically upgraded by this release. Prepare its intended
replacement and rollback pointer explicitly; production deployment and activation
remain separately authorized operations after localhost proof. Do not activate a
context just to make a preview work.

The existing acquisition/enrichment/scheduler path feeds EvaluationWorker. For an
active staged context, PURSUE/CONSIDER results proceed to durable memo composition
and publication; PASS completes without a dossier. Provider failures preserve
checkpoints and remain visible as pending/attention work, not fabricated results.
Gemini sends one generation request per attempt. Its explicit cache holds fixed
candidate evidence and reviewer instructions for one hour, bound to their exact
content and model. It is reused across jobs and worker restarts; job-specific
evidence remains in each request. Confirm `cachedContentTokenCount` in recorded
usage rather than assuming a hit. Cache setup needs list/create/count access;
unsupported cache access falls back to the full evidence request. Inputs below
4,096 tokens are not padded. `RADAR_GEMINI_CONTEXT_CACHE=off` disables caching.
Google's cached-input discount applies to the cached portion, not the complete
generation bill; explicit cache storage is also billable.
Consecutive rate-limit/capacity failures
use a 30/60/120-second backoff with small jitter; Google RetryInfo and Retry-After
are honored when longer. The next eligible time is persisted by the worker; the
consecutive-failure counter resets on provider success or process restart.
Authentication/configuration failures retain a longer pause. The worker and daemon
use the same delay, without spending semantic job attempts on provider failures.

Use `/scraped` to account for every captured opportunity: waiting, processing,
preparing, ready, evaluated-not-shortlisted, outside-search or needs-attention.
The shortlist contains actionable evaluated opportunities and shows semantic
screening viability and evidence coverage, not an invented numerical score.
Reconcile unadmitted captures, waiting enrichment and dead letters explicitly.
Do not force dependency failures through or let PASS look permanently preparing.

## Release boundary

A clean local render and CI artifact are prerequisites, not evidence of production
activation. Record the exact SHA, deployed artifact, schema and context before an
approved launch. After the first scrape, compare captured/admitted/enriched/
evaluated/PASS/memo-published counts and inspect representative served memos.
No historical backfill is required by the memo code path.
