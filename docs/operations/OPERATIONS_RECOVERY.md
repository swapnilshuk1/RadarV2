# Operations & Recovery: implementation and agent entry point

Read this document before continuing this release. It records the authoritative
checkout, product scope and current implementation status. Revalidate Git identity
and status on entry; the recorded baseline is not permission to reset local work.

## Phase 0: authoritative checkout

Verified on 3 October 2026:

| Item                       | Verified baseline                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                 | RADAR V2; existing shared Git repository                                                                                                     |
| Implementation worktree    | `C:/Users/swapn/.codex/worktrees/acquisition-performance/Radar V2`                                                                           |
| Implementation branch      | `codex/admin-connections`                                                                                                                    |
| HEAD                       | `5a7724d82f22fe99bff7e1c5943eb1cf013bba7b`                                                                                                   |
| Upstream                   | `origin/main`, locally recorded at the same SHA as HEAD                                                                                      |
| Local main                 | `0ced615933659400ac03d8791cfae2f41f70dea7` (older; do not use as this release base)                                                          |
| Initial tracked changes    | None in the implementation worktree                                                                                                          |
| Initial untracked work     | `src/admin/search-connection-contracts.ts`, `src/admin/search-connections.ts`, `src/data/sqlite/migrations/085_admin_search_connections.sql` |
| Admin                      | Present: `src/routes/admin.tsx`, `src/admin/*`                                                                                               |
| Latest committed migration | 084; 085 is the untracked prototype, not a deployed migration                                                                                |
| Original chat workspace    | `C:/Users/swapn/Downloads/Radar V2`, branch `feat/scraped-interactive-filter`; dirty with unrelated scraper/acquisition work; leave intact   |

Use `git worktree list --porcelain`, `git branch --show-current`, `git rev-parse HEAD`,
`git rev-parse --abbrev-ref --symbolic-full-name '@{u}'`, `git status --short` and
`rg --files src/admin src/data/sqlite/migrations` to confirm these facts. Remote
freshness was not asserted: the upstream SHA above is the local remote-tracking ref.

The prototype was authored in this same checkout on the current Admin schema.
Do not transplant it to the older original workspace or allocate migrations there.
At baseline it is unimported; normal Tavily search still uses `TAVILY_API_KEY`.
Its `last_error LIKE` bulk resume, process observations and unfenced validation
completion do not satisfy this release and must be replaced before exposure.

## Authorized scope and working loop

The owner authorized implementation of all phases, autonomous ordinary engineering
decisions and a self-review after each cycle; routine phase approval is unnecessary.
Use inspect -> implement -> focused verification -> relook at the diff and coupled
behavior -> correct -> update this document -> continue. Preserve valid verification
evidence. Run final certification once on the final candidate. Do not declare a
phase complete because its interfaces exist without runtime integration.

Read `../PRODUCT_MISSION.md`, `../ARCHITECTURE.md`, `../VERIFICATION_AND_RELEASE.md`
and repository `AGENTS.md`. Template B richness, evidence lineage, inference,
tenant/person isolation, durable queue fencing and scraper capability remain hard.
Only a necessary compromise of the locked product mission requires owner input.

## Release outcome

An authenticated operator can diagnose and recover a simulated Tavily credential
incident entirely in Admin without shell, environment edits, SQL, service restart
or manual queue mutation. Recovery survives restart, respects pause/lease/scope/
checkpoint invariants, reaches a reviewed memo, records durable operational/audit
evidence and delivers a signed recovery notification. PASS still has no dossier.

Tavily is fully writable. Bedrock is read-only unless every credential consumer
uses the unified resolver. Google ADC is host-managed health only. Deployment
database/storage/encryption/release identity is displayed and validated, not edited.

## Delivery phases

| Phase | Scope                                                                                 | Status                                                         |
| ----- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 0     | Checkout, baseline, prototype/schema compatibility                                    | Complete; evidence above                                       |
| 1     | Connection, incident, receipt, recovery and operational setting contracts             | Complete; populated migration and integrated contracts pass    |
| 2     | Durable incidents/cooldown/capacity; crash-safe leases                                | Cross-process/restart/expiry/fencing tests pass                |
| 3     | Tavily resolver, worker validation, uptake, rollback/retirement                       | Validation/rollback/retention boundary tests pass              |
| 4     | Exact expiring recovery preview; queue-owned resume; durable outcomes                 | Reviewed memo journey and exact cohort tests pass              |
| 5     | Runtime/deployment/queue health; stage throughput; provider visibility                | Actual driver/model receipts and worker-host probes integrated |
| 6     | Incident-centered Admin workflow and Needs attention                                  | Authenticated isolated browser acceptance passes               |
| 7     | Durable asynchronous signed webhooks and routing                                      | Opened/resolved signed delivery and retries pass               |
| 8     | Populated migration, deterministic journey, browser, live connectivity, certification | Local delivery verified; deployment remains unverified         |

## Operational contracts

The incident is the durable anchor: observations -> affected exact work ->
remediation/connection activation -> worker uptake -> recovery actions -> work
outcomes -> resolution. Existing alerts are attention projections, not the incident
record. Observation storage is bounded; aggregate occurrence counts persist.
Correlation includes provider/account, failure class and deployment identity.
Recurrence after resolution gets a new incident ID linked to its previous episode.

Separate job concurrency, external request concurrency, request/token rate and
cooldown. Reuse lease fencing; slots expire after worker death and stale owners
cannot release a replacement slot. Lower limits drain existing work.

Receipts identify worker/instance/runtime role, release, database, effective config,
connection generation/version/source, reload mode/status/error and timestamps.
No secrets or secret-derived hashes. Activation observes required fresh consumers;
new consumers load the active generation before dispatch. Irrelevant workers do
not block uptake.

Recovery execution is synchronous and transactional: previewed -> executing ->
completed | partially_completed. `executing` occurs inside the same bounded
transaction as queue-owned resume and outcome/audit persistence. An exception or
process death before commit rolls the action and dispatch changes back to
`previewed`; retry still requires an unexpired preview and current eligibility.
The schema reserves requested/cancelled/failed states, but this release has no
request, cancel or durable failed transition and no asynchronous recovery executor.
Previews retain exact identities and expire after five minutes; execution
revalidates pause/scope/lease/state. Resume never rewrites terminal statuses.
Successful dispatch persists every resumed, skipped or blocked per-job outcome.

Resolution requires a validated active connection, no cooldown, fresh required
worker uptake and a health probe; every affected job must be completed, legitimately
terminal, manually paused, in a valid recovery path or audited as excluded.
Acknowledgement/snooze do not resolve or resume. Resolution notifications are
asynchronous and independent of incident state.

Webhook contract: HTTPS, protected destinations and redirects, timestamped HMAC,
event/delivery identity, replay/idempotency metadata, bounded timeouts/retries,
no response-body retention, encrypted signing secret, operator role and audit.
Limit editable policy to throughput, operational profiles, routing/destination,
snooze and bounded cohort size. Safety equations/mappings/transitions stay tested
code policy.

## Verification evidence and continuation

Phase 0 self-review: checked both worktrees, tracked/untracked status, branch and
base identity, Admin presence and migration sequence. No runtime/database changes
or tests were required for this discovery/documentation cycle.

Update this section with actual checks and unresolved limits as work progresses.
Keep this as the single continuation reference; do not create competing handoffs.

Current code: migration 085 retains prototype storage; additive migration 086
adds incidents, capacity, receipts, recovery, settings and deliveries. Active
generation is distinct from optimistic mutation revision. Tavily traffic resolves
the active version per acquisition. Validation/maintenance runs in evaluation
heartbeat; ordinary UI reads never start workers or provider calls. Gateway-managed
model calls flowing through `operationalModel()` participate in shared operational
capacity/cooldown; stage job limits apply per worker process. Direct Bedrock
consumers, including `src/lib/intelligence/extraction/EvidenceExtractionService.ts`,
remain outside those controls. Bedrock rotation remains read-only until all consumers
converge on the resolver; ADC remains host-managed.

Verification so far: initial 17 tests passed (operations + existing context input);
then 80 passed across operations/config/protection/context/review queues. A later
focused 50 passed across operations/config/context after generation and gateway
changes. Expanded operations suite: 7 passed. TypeScript passed before later
coupled source/UI changes; final certification will validate the final candidate.

Cycle relook fixes: removed broad error-string recovery; separated candidate
revision from active generation; fenced validation completion; blocked late
superseded failure observations; transient throttling remains automatically
retryable while credential/quota incidents retain explicit recovery holds;
resolution validates the reviewed memo and matching publication rather than
trusting a presentation row's existence. Existing user pauses remain authoritative.

Verification of the original `e47b5406` candidate: 77 focused tests passed across Operations, configuration,
protection and review queues. Operations includes populated-schema upgrade,
cross-process capacity/restart cooldown, rollback, retention boundary, worker-host
probes, exact recovery and reviewed publication. Receipt schema refinement passed
47 affected tests; the final health/inventory correction passed 25 affected tests.
Final `npm run certify` passed all nine stages in 176.52 seconds: lint, formatting,
TypeScript, production SSR build, and 78 manifest suites with 783 passed and one
skipped test. The initial inventory failure was corrected and narrowly verified
before final certification. These results predate the review corrections below.

Review correction cycle (3 October 2026): terminal counts now distinguish legacy
and staged dead letters, failed jobs and domain needs-attention; all four stages
produce Needs attention links and bounded exact identity cohorts. Pending maintenance
produces its own worker-unavailable signal independently of queue depth. Recovery
states, gateway-only model coverage, creation-age retirement and deployment order
now describe the implementation. No terminal retry, maintenance daemon, migration
or live configuration change was added. Self-review checked role boundaries,
arbitrary-error exclusion, cohort bounds, pursuit-owned identity and maintenance
release/database/freshness matching, including protected previous credentials.

All 23 focused Operations tests passed, including a 114 staged dead-letter fixture,
legacy dead letters, unchanged terminal rows, domain retry classification and six
maintenance backlog categories with empty business queues. Authenticated browser
acceptance passed the new Overview links and exact terminal cohort, then completed
the existing validated activation/uptake/recovery/reviewed memo/signed-delivery
journey. The first browser fixture introduced a second version of the golden
opportunity and correctly failed exact claim; moving the terminal fixture to its
own opportunity restored the independent journey. Final `npm run certify` passed
all nine stages in 218.51 seconds, including TypeScript, SSR build and all 78
manifest suites: 791 tests passed and one skipped. `git diff --check` passed.
Only this verification record changed after certification. Engineering review
corrections are complete locally; push/PR, exact-SHA CI and live rollout/proof
remain unperformed by this cycle.

Later self-review fixes: rejected stale review failures, preserved independent
review concurrency with shared cooldown, fixed browser date hydration with ISO
timestamps, classified vault failures operationally, bounded Retry-After, renewed
long model capacity leases and fenced their output, and exposed actual host/admin
driver limits plus job-pinned model revisions. Host model limits remain explicitly
host-managed. Per-job recovery outcomes now progress from resumed to completed.
Configuration-lag attention excludes workers that do not consume those controls;
a worker awaiting its first driver read reports pending rather than restart-required.

Local implementation and acceptance are complete for the scope below. Resolve the
current candidate SHA with `git rev-parse HEAD` on `codex/admin-connections`;
the Phase 0 table records the starting baseline, not the final candidate. Re-enter
through this document and its runbook, preserving unrelated original-checkout work.

## Operator runbook

1. Confirm this checkout and the database target before `npm run db:migrate`.
   Migrations 085/086 accompany this release. Existing host Tavily credentials
   remain active until explicit Admin activation. No live migration or deployment
   was performed during implementation.
2. Supply session/OAuth and encryption bootstrap secrets through deployment.
   Retained versions require their original encryption key. Database, storage and
   release identity remain deployment-managed.
3. Start only stages being exercised: `worker:evaluations`, `worker:dossiers`,
   `worker:reviews`, `worker:pursuit`. Evaluation heartbeat owns Tavily validation,
   retention, reconciliation and notification delivery; review heartbeat owns ADC
   probes. Maintenance runs every 60 seconds.
4. Sign in as a platform operator, open Admin -> Connections, supply the change
   reason, save a Tavily candidate and validate on the evaluation worker. Failed
   validation preserves the active source. Activate after a passing current-worker
   check; wait for required fresh consumers to acknowledge uptake.
5. Select a bounded exact incident cohort, preview, then resume. Five-minute
   previews expire; execution rechecks generation, pause, lease, scope and
   dependencies. Valid checkpoints remain. Resolution requires reviewed canonical
   publication (PASS requires its evaluation only) or manual pause.
6. Revalidate the retained previous version before rollback. Automatic retirement
   requires an unreferenced credential whose **creation time** is at least 30 days
   old. An older version can retire on the next maintenance beat immediately after
   it stops being active/candidate/previous; there is no 30-day grace period measured
   from becoming unreferenced. Ciphertext becomes eligible for purge 30 days after
   `retired_at`. Active, candidate and previous versions remain protected from both
   operations. Metadata/history remains; unavailable maintenance delays cleanup.
7. Configure a signed HTTPS webhook with a 32+ character signing secret. Severity
   routing and snooze are supported. Delivery has five bounded attempts and cannot
   undo incident recovery.

Recovery action completion means resume dispatch finished. Per-job outcomes
progress from resumed to completed when reconciliation verifies work. Incident
resolution is separate. Probe the active connection again if its 15-minute health
proof expires before a long recovery finishes.

Admin Overview shows separate dead-letter, failed and needs-attention counts for
each stage even without an open provider incident. Its links open exact terminal
cohorts in Connections (most recent 100 per stage; totals cover the full queue).
Both legacy `dead_letter` and staged `staged_dead_letter` count as dead letters.
The cohort exposes identities and recovery classification, without retaining or
displaying arbitrary provider error bodies. Dossier/review `needs_attention` jobs
have a domain retry entry point through the tenant administrator's detailed-dossier
request; that entry point revalidates active scope and evaluation fingerprint.
Other terminal work requires a separate domain recovery policy. This release adds
visibility, not terminal replay or a dead-letter drain worker.

The **evaluation maintenance worker is a control-plane dependency**: if no fresh
evaluation heartbeat matches the web release and database, Tavily validation,
Bedrock host probes, credential retirement/purge, incident reconciliation and
webhook delivery cannot progress. Admin shows this status and pending counts under
Runtime, with a High Needs attention link whenever maintenance work is pending,
including when all business queues are empty. Counts include queued/running checks,
recovering Tavily incidents, queued/retrying/sending deliveries and eligible
retirement/purge work. A fresh heartbeat proves worker presence, not that each
maintenance task succeeded; inspect check, incident and delivery outcomes too.
There is no separate maintenance daemon in this release, so an unavailable worker
also prevents outbound notifications about its own failure.

## Deployment sequence

1. Push the candidate and open its PR; require CI on the exact candidate SHA.
2. Verify database backup and recovery before applying migrations 085/086.
3. Deploy web and exercised workers on that same SHA and database target. Verify
   migrations/readiness, required matching heartbeats and loaded receipts.
4. Run host Bedrock/ADC probes and a bounded Tavily acquisition using the existing
   host credential. Initial deployment smoke must preserve host fallback; do not
   activate an Admin-managed candidate as part of that smoke.
5. After deployment smoke passes, separately validate a candidate, activate it and
   verify required uptake. Run one bounded real recovery or live context acquisition,
   then confirm its reviewed downstream result (PASS needs evaluation only).

Local certification is not deployed evidence. Record the exact deployed SHA and
these results before calling the operational journey deployment-proven. Deployment
and credential activation remain separate events with distinct rollback paths.

Stage limits apply per worker process; provider slots apply across processes per
connection. Lower limits drain running work. Explicit lane concurrency still limits
model calls. Rate-window support is separate internal infrastructure; unknown
provider RPM/token quotas are not fabricated as editable settings.

## Verification commands and limits

- `npm run acceptance:operations`: isolated SQLite/Playwright Admin golden journey.
  Real evaluation/composition/review queues, stores and publication execute;
  validated semantic fixtures replace model generation and external responses.
- `npx vitest run tests/security/admin-operations.test.ts`: operational regressions.
- `npx tsx scripts/acceptance/operations-connectivity.ts`: read-only local checks.
  Optional `--credential-root <directory>` reads only provider/project fields and
  the Mantle key into this process, excluding DB/encryption/session/unrelated
  values. `--skip-adc` retains existing authentication evidence.
- `npm run certify`: final lint, formatting, TypeScript, SSR build and manifest.

Local connectivity on 3 October 2026: ADC token issuance passed. The authoritative
checkout had no Tavily/Mantle key; using original-project provider files, Tavily
usage and Mantle catalog endpoints returned HTTP 200. This proves local read-only
authentication/connectivity, not deployed-worker model inference.

Ignored `.radar/acceptance/` retains `operations.png`, `operations-attention.png`, `browser.sqlite`,
`operations-connectivity.json` and `operations-connectivity-configured.json`.
No credentials, tokens or provider bodies appear in reports. Normal candidate
acceptance remains `npm run acceptance:browser`; the operations flag is separate.

Deliberate limits: Bedrock rotation is read-only until all credential consumers
use the unified resolver. ADC token issuance does not prove model/project access.
Operator recovery covers Tavily evaluation incidents and nonterminal linked
evaluation/composition/review work. Terminal regeneration and Pursuit domain retry
remain separate policies. Gate tuning, provider expansion, enrichment settings and
tenant lifecycle are deferred. Notifications use one destination, severity routing
and public IPv4 HTTPS. Real deployment, model-backed recovery and delivery to an
operator destination remain unverified; deterministic delivery uses a fixture.

Primary references: [Tavily errors](https://help.tavily.com/articles/8645538886-understanding-http-errors),
[Tavily usage](https://docs.tavily.com/documentation/api-reference/endpoint/usage),
[Bedrock model information](https://docs.aws.amazon.com/bedrock/latest/userguide/models-get-info.html).
