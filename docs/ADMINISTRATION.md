# Administration — Phases 1–3

The `/admin` console is isolated on `codex/admin-phase-1`. It is not deployed on
main. The console provides platform authorization, visibility and opt-in protection.
Gate meaning, acquisition evidence and existing memo content are preserved. Phase 3 adds explicit model assignments for future work.

Apply migrations 072–075 through the normal migration runner before using this branch.
Platform access comes from `platform_roles`, never tenant memberships. An existing
user can be granted `operator` or read-only `viewer` access by a trusted host
operator. No user receives platform access automatically. Revocation takes effect
on the next request. Every server read checks the role before reading tenant data.

```powershell
npx tsx scripts/admin.ts grant --user USER_ID --role operator --reason "Initial console operator"
# Inspect the database target printed above, then run the same command with --apply.
npx tsx scripts/admin.ts revoke --user USER_ID --reason "Access removed" --apply
npx tsx scripts/admin.ts rollup --apply
```

The CLI previews writes unless `--apply` is explicit. Role changes and their audit
entry commit together. The host operator is a trusted deployment identity, not a
web authorization bypass. Keep shell access restricted. No credential values are
read or displayed by this console.

Usage comes only from `usage_daily`, rebuilt transactionally from invocation
telemetry. Run `rollup --apply` hourly with the existing host scheduler, plus a
nightly reconciliation using `--from YYYY-MM-DD --to YYYY-MM-DD --apply` for older
late completions. The default refresh reconciles the last 30 UTC calendar days.
Repeated runs do not double count. This branch does not install a scheduler or
start additional workers. The UI flags rollups older than two hours as stale.
Windows are UTC calendar days, not rolling hours. Unknown token measurements
remain unavailable. Negative, fractional or inconsistent token telemetry is also
unknown; it cannot provide quota capacity. Recorded invalid outputs measure invocation status, not the
semantic quality of the resulting decision. BENCH invocations are retained but excluded from tenant usage rollups.

Overview and Audit are read-only. Operations and Tenants & Quotas expose
operator-only protection writes; Engine and Models expose configuration drafts
and fixture benches.
Engine shows the fixed stage order and each stage's inputs, decisions, continuation
and stop conditions. REVIEW continues to evaluation. Configuration revisions and fixture benches are implemented below. Phase 4 now includes the bounded discovery-taxonomy editor described below. DAU/WAU/MAU and p95 latency are unavailable until the necessary instrumentation exists.
Active revisions appear in Engine/Models; Operations groups queue pins by revision.
Per-worker last-claimed revision is unavailable because jobs do not record a host identity. Membership
counts are not active-user counts. Worker observations are global, so a selected
tenant view omits them instead of falsely attributing hosts to that tenant.

Select a tenant to scope queries. A selected tenant excludes global audit events.
Audit displays the latest 100 entries; opening/refreshing the console appends a
read entry and trusted role changes append their diff and reason. Database triggers
reject updates and deletes. No background polling generates audit noise. This is
database-enforced immutability, not a tamper-proof external archive.

Use `g o/e/m/t/q/p/a` to navigate, `/` to search and Escape to close detail drawers.
Tables support compact/comfortable spacing. Measurement links explain each data
source. Empty data and unavailable measurements are visibly different.
The supplied RADAR administration mockups guide the numbered rail, typography and ruled ledger hierarchy. Sample metrics, health labels and configuration revisions from those mockups are not runtime facts. Role audit entries identify the trusted host and OS user. Table headings sort the ledger.

## Protection setup and behavior

No tenant receives a quota policy by default. Apply migrations 073–074 to the same
DB used by web and workers, then select a tenant in **Tenants & Quotas** and
configure its limits. All web mutations recheck the separate platform operator
role server-side. A reason and before/after audit entry commit with each write.
Read-only viewers and tenant owners cannot mutate protection.

Limits cover reasoning/writing tokens per UTC month, evaluations/memos/scrape
runs per UTC day, pursuit packages per UTC month and concurrent job leases.
Blank period limits mean unlimited; zero defers new claims. Positive per-job
input/output budgets are required. Temporary period-limit overrides expire after
at most 30 days and require a reason. There are no plan entitlement presets yet.

A claim reserves the **whole remaining job budget**, inside the queue claim's
write transaction. This conservative admission avoids several workers jointly
overspending the remaining monthly allowance. Each provider call reserves its
input admission bound and requested output maximum before dispatch. Measured
usage refunds unused call capacity; missing usage retains the full reservation.
Budget usage persists across retries and lease recovery. Count quotas count a
job's first claim, not every retry; pursuit first-claim month is immutable and
separate from the month used for token reservations. Existing job caps remain pinned unless raised;
lowering a policy affects new jobs. Completing/terminalizing a job releases its
unused budget, while reported or uncertain spend remains charged. The reasoning
lane is evaluation; composition, factual review and pursuit use the writing lane.
Scraping uses count/concurrency limits and no model-token reservation.

Input admission is a conservative UTF-8 byte bound over instruction, input and
schema plus framing allowance, **not an exact provider tokenizer**. Provider
output maxima are sent before dispatch. Provider-reported usage above an admission
bound produces an alert and consumes the remaining job budget. These controls
prevent unbounded dispatch; they cannot promise an exact input billing ceiling
when a provider's accounting differs from that bound. Gemini thinking tokens are
included in output usage; Mantle completion tokens already include thinking.
The persistent `JobTokenLedger` serves all four model-backed worker pipelines;
the existing portable pursuit ledger remains its local derivation accounting.

Historical invocations in the same UTC month count toward the monthly limit.
Unknown historical usage causes `LEGACY_USAGE_UNMEASURED` deferral for a finite
monthly limit; it is never silently treated as zero. Inspect/reconcile the source
telemetry before enabling a finite monthly limit, or explicitly leave it unlimited.
Already-running work that predates policy activation finishes under its previous
configuration only with a recorded, matching live lease. Migration 074 backfills
actual processing leases; claims made before a tenant policy exists record their
lease explicitly. An absent reservation alone never permits a provider call. At month rollover, new calls charge the new month while preserving
the lifetime job ceiling. Invocation telemetry and quota records remain separate:
usage dashboards show measured tokens; Reservations shows retained bounds too.

## Operations and alerts

**Pause claims** / **Resume claims** apply globally or to a selected tenant,
for one pipeline or all five protected pipelines. Running work finishes; new
claims stop within one poll. Tenant resume cannot override a global pause.
Enrichment is not a model-backed protected queue in this phase. Deferrals retain
the original queue record and evidence, use five-minute backoff and let later
polls move to another tenant. Limits changing or a resume clears applicable
backoff, then every limit is checked again. No quota action changes a verdict.

Five invalid outputs on a protected job hold further calls and claims. **Resume held job**
records the reviewed invalid-call count and clears backoff; it preserves token spend.
Unrelated quota edits and temporary overrides preserve job-budget, storm and pause
holds. Raising job caps releases the corresponding budget backoff.
Raising insufficient budgets or fixing the source error may still be necessary.
**Acknowledge alert** only clears the console alert; it does not resume work.
Alerts include 80% monthly reservation usage, quota/paused deferral, retry storms
and provider usage overruns. They are durable console signals. Email/webhook
routing, credential-expiry alerts and queue-duration alerts are not configured.
No tenant is automatically paused or banned.

The Limits, Overrides, Reservations, Deferrals, Controls and Alerts ledgers show
their query source. An unavailable table is shown as unavailable, never as zero.
The console remains on the admin branch; applying migrations to a fixture does
not apply them to Oracle or the live acquisition database. Merge/deploy and
operator activation are separate release steps.

Local SQLite/libSQL operations sharing an event loop are serialized per connection
or file; local libSQL keeps a retained connection with explicit BEGIN IMMEDIATE,
COMMIT and ROLLBACK rather than detaching a native connection for each claim.
This preserves its busy-timeout setting and avoids native handle churn on Windows
shutdown. Cross-process file locks still enforce atomicity. Remote Turso retains
its normal transaction behavior. This prevents a synchronous busy wait from
blocking the async commit that would release its own lock. Transaction callbacks
must use their supplied transaction adapter. Reservations shown in the console
omit lease tokens; those capabilities stay inside worker persistence.

## Regression and stress coverage

`tests/security/admin-protection.test.ts` covers policy activation during an
existing lease, wrong-job receipts, duplicate settlement, unknown/malformed
usage, invalid-output holds within a running lease, reviewed retry counts,
month boundaries, quota edits preserving holds and tenant isolation. Stress
cases race 32 claims on a shared SQLite connection and across two local libSQL
adapters over three connection-open/close cycles (768 total local libSQL claim
attempts), race independent worker processes, and compete for model-call
capacity over 256 attempts. The console test verifies that lease tokens are
absent from viewer responses. These use real local databases and simulated
provider receipts; they do not constitute an Oracle or live-provider load test.

Run the focused suite with `npx vitest run tests/security/admin-protection.test.ts`
and the release candidate with `npm run certify`. Migration 074 is additive;
previously applied migration 073 remains unchanged.

## Phase 3: narrow engine changes

Migration 075 adds immutable `config_revisions`, active and draft pointers,
bench runs and pinned revision columns on evaluation, composition, review and
pursuit jobs. Migration-time work retains `engine-baseline-v1`. New jobs pin
the effective revision in the enqueue transaction; retries cannot change it.
Claim-time pinning handles jobs inserted by an older enqueuer after migration.
The baseline preserves existing host model settings, including the current
separate writer/reviewer assignments and declared pursuit fallback chain.
Host environment changes remain outside that legacy snapshot; keep those
settings stable while baseline jobs are outstanding. Explicit assignments bind
exact model IDs, adapter configuration and the fixed credential reference.

The editable surface is eight tunables: concurrency, timeout and output ceiling
for each of the two lanes, plus pursuit package input/output budgets. Model
choices start with the existing Mantle adapters for `zai.glm-5` and
`deepseek.v3.2`, not untested provider integrations. Reasoning serves evidence
and evaluation; Writing serves composition, factual review and model-assisted
pursuit. Explicit assignments have no vendor fallback. Existing host assignments
keep their host limits; select an explicit model before editing lane limits.
Credentials stay on the worker host in its existing
`BEDROCK_MANTLE_API_KEY` reference. The console never receives a secret value.
Connection health is not inferred from usage or model selection.

For Pursuit alone, the selected writing model is tried first and the established
Mantle chain remains as a resilience fallback. This keeps a transient configured
model failure from discarding a whole package while retaining the selected model
as the recorded primary attempt.

Lane concurrency ranges from 1–8 provider calls per process/configuration,
timeouts from 30–180 seconds and output ceilings from 4,096–16,384 tokens per
call. Stage-specific ceilings may be smaller. Pursuit package budgets range
from 10,000–100,000 input and 3,000–20,000 output tokens. Package accounting
uses the existing per-attempt pursuit ledger; persistent pre-dispatch enforcement
remains the tenant job quota guard. These settings never raise a tenant quota.
Candidate search intent, attention semantics, stage order and integrity rules
are not editable in Phase 3.

Platform defaults apply unless a tenant has its own active revision. Tenant
overrides are whole configuration snapshots: publishing new platform defaults
does not silently edit an existing tenant snapshot. Neither layer overwrites
explicit candidate search intent. Select a tenant before editing its override.
**Return to platform defaults** creates a tenant-scoped, bench-tested inheritance
revision and removes the tenant pointer only when it is published. It never
rewrites the tenant's prior revisions.

The workflow is **Edit → Save draft → Run shadow bench → review the field diff
→ Publish tested draft**, with a reason on every action and before/after values
in Audit. Publishing opens a review dialog and requires a fresh publication
reason, rather than reusing the draft/test reason. A passing result must match the exact draft, effective active revision
and scope. Editing, discarding or a concurrent publish invalidates stale results.
Restore history creates a new draft revision and needs a new bench; it never
rewrites history. Publishing leaves already queued/running work and existing
reviewed memos alone. No automatic corpus re-evaluation or memo regeneration
is implemented by this publish action.

### Bench operation

The test button queues durable fixture work only when the web host can declare
`RADAR_ADMIN_BENCH_TARGET`, a 40-character `RADAR_RELEASE_SHA`, and a comma-separated
`RADAR_ADMIN_BENCH_HOSTS` allow-list. Start `npm run worker:admin-bench` on one
of those intended worker hosts, with the **same database target** and credential
configuration as that host's other workers; `-- --once` handles a single poll.
The run stores the declared target/release/provider-configuration fingerprint,
and the worker stores a host/runtime attestation. A changed release, target,
host allow-list or provider configuration fails the run and blocks publication.
Set `RADAR_ADMIN_BENCH_ENABLED=true` to supervise it through PM2 and include it
in readiness; leaving it unset keeps the paid bench worker opt-in.
The console can show queued work until the worker starts; Refresh shows results.
It checks operator access both at claim and before every paid dispatch.
Only one queued/running bench per scope is allowed. Superseded/discarded queued
benches are cancelled; a running bench stops before another call when its draft
or active revision changes. Expired leases fail without an automatic paid retry.

Three code-defined synthetic fixtures cover direct leadership fit, adjacent
mandate fit and a mandatory license contradiction. Both revisions run through
the real staged evaluator and Template B composition/factual-review validators,
then a bounded synthetic Pursuit-lane request using the draft writing assignment
and the same package token ledger as durable Pursuit preparation.
PASS skips composition. Results compare verdict, screening viability, claim
additions/removals/changes and changed memo sections. No fixture result is saved
to canonical evaluations, serving tables or the shortlist. Invocations carry
`purpose='BENCH'` and a bench run ID; they are excluded from tenant rollups and
tenant quota accounting, while remaining visible as invocation evidence.

Each run has a 50,000–1,000,000 admission-unit cap, default 500,000. Input byte
bounds plus output allowances reserve capacity before each call; bounds are
retained rather than refunded. This may defer a long bench before all fixtures
finish. It is an admission cap, not an exact tokenizer or provider billing limit.
Any PASS-to-PURSUE/CONSIDER flip, BLOCKED-to-PLAUSIBLE screening relaxation, invalid transport output, source
integrity failure, incomplete fixture suite or provider failure blocks publish. Formatting
repairs remain visible as diagnostics so an operator can review model quality without
turning a valid, bounded comparison into an automatic rejection.
A failed run retains its reservation and a classified error; it cannot become a
passing result through a retry. Running it again is an explicit new bench.

Fixture success is a narrow prerequisite, not a corpus-wide impact claim.
An operator may explicitly select a bounded real opportunity after source-integrity
validation; rolling seven-day corpus shadows, arbitrary provider connections,
per-stage model routing, rendered memo comparison and automatic regeneration are
not included in this phase.

Focused verification: `npx vitest run tests/security/admin-config.test.ts`.
The suite covers all configuration write authorization, stale/cross-scope
publication, immutable queued pins, revert behavior, competing bench workers,
preflight caps, revocation, expiry, fixture provenance and BENCH usage exclusion.
Provider requests are simulated in automated tests; a successful worker-host
bench is still required before activating a specific assignment.

## Self-audit corrections after Phase 3

The self-audit is recorded in [ADMIN_SELF_AUDIT.md](ADMIN_SELF_AUDIT.md).
Bench acceptance is now `executive-fixtures-v3`. Results must cover each fixture
exactly once with valid verdict/viability fields. The direct-fit fixture must
remain viable with PURSUE or CONSIDER; the explicit missing-license fixture must
remain PASS/BLOCKED. These are synthetic fixture expectations, not new gates on
real opportunities. Older passing benches cannot authorize publication; run a
new bench against the current fixture version.

Bench completion checks current draft/active scope, operator role and live lease
in the completion transaction. Heartbeats cannot revive expired leases. Provider
preflight runs after waiting for a concurrency slot; bench workers recheck access
and revision before actual dispatch. Call receipts bind the active/draft revision
and include output allowance, latency, finish reason and a classified error.

Explicit lane concurrency is per tenant/lane/limit within one process, with the
host Mantle provider ceiling additionally enforced. Different configured limits
use separate pools, so running old revisions retain their pool. This is not a
cross-host lane semaphore; tenant concurrent-job quotas remain the durable
cross-worker boundary. Pursuit uses the same tenant writing pool. Local host
assignments retain their existing provider pool.

While editing unsaved values, bench, publish, discard and restore controls are
disabled. Save or cancel first so the displayed values correspond to the draft
being tested or published. Queue revision ledgers show pins, not a claim that a
particular host has acknowledged a revision.

## Secondary audit corrections and remaining prerequisites

Migration 076 protects completed bench rows from update/deletion, freezes run
identity and restricts legal state transitions. Migration 077 extends the same
database with bench deployment identity, protection epochs and quota defaults;
apply both to the web and bench worker database.
Repair detection consumes typed evaluator/composer events rather than progress
messages. Every configuration mutation includes the active/draft state hash;
stale editors receive `ADMIN_STATE_CHANGED` and must refresh. Quota, override,
pause, resume and acknowledgement writes use the separate protection epoch and
receive the same refresh-required outcome on a stale request.

The publication dialog lists changed fields and the matching bench summary.
Operators can cancel a queued/running bench with a reason; cancellation clears
its lease and fences later dispatch/completion. Already dispatched requests may
finish, and their measured receipts remain visible. No automatic paid retry occurs.
The console labels byte-derived input/output reservations as admission units.

Console reads no longer create durable audit events. Mutations remain audited;
detail is capped at 64 KiB and known credential/lease keys are redacted recursively.
Callers must still exclude source payloads and credentials from prose. Unavailable
sections emit a structured server diagnostic without SQL arguments or raw errors.
CLI role grants require an explicit `--role operator|viewer`.

Migration 077 closes the release-control implementation gaps: host/release-bound
bench attestation, protection-write state epochs, explicit quota provisioning and
tenant return-to-platform inheritance. Existing tenants receive an explicit
`migration-compatibility` profile that preserves their pre-activation behavior;
new tenants receive bounded platform defaults. The compatibility profile is
visible data, not an absent-policy bypass. Scrape claims do not consume the
model-worker concurrency limit, so acquisition remains independent of enrichment,
evaluation and writing throughput. A disposable remote-Turso proof and exact-SHA
GitHub CI remain operational validation steps. Legacy baseline pins do not freeze
host environment variables. See [ADMIN_SELF_AUDIT.md](ADMIN_SELF_AUDIT.md) for the
current disposition.

### Remote Turso foreign-key validation

Use only a disposable remote database. Set its URL/token in
`RADAR_REMOTE_VALIDATION_URL` and `RADAR_REMOTE_VALIDATION_TOKEN`, set
`RADAR_ADMIN_REMOTE_VALIDATION_CONFIRM=DISPOSABLE`, then run
`npm run verify:remote-turso-fk`. The probe creates two uniquely named temporary
tables, confirms `PRAGMA foreign_keys=1` on the normal client and write
transaction, confirms an orphan insert is rejected, then drops its tables. It
never defaults to the application database or reads RADAR tables.

Merging/pushing to main can automatically deploy Oracle and run migrations.
Keep this branch isolated until deployment prerequisites are actually satisfied.

## Taxonomy (Phase 4)

**Taxonomy** provides a dense, platform-operator view of the portal-query
concepts used when a new career search plan is activated. Each record shows its
dimension, concept, description and aliases. An operator can revise a concept
description and its portal-query aliases. Every change creates an immutable
draft revision, needs an audit reason and can be discarded, published or restored
as a new draft. Publication is safe without a paid model bench because it only
changes future discovery phrasing.

The active revision is resolved when the profile intent is activated. Its exact
query list, revision ID and fingerprint are then saved in the immutable search
plan criteria. The scraper uses those stored queries, so a later taxonomy
publication cannot change a running scrape or an already active plan. Activate a
new plan to use the new revision.

Aliases are discovery vocabulary only. They do **not** change the attention gate,
role eligibility, seniority interpretation, evaluation verdict or a candidate's
explicit search intent. New aliases require a functional word; a generic
seniority-only phrase such as `VP` is rejected. Normalized aliases must be unique
across concepts, preventing ambiguous portal searches.

Operators can add a discovery concept to an existing dimension and choose its
primary, adjacent or excluded ring; a concept can also be retired without
rewriting any historical revision. These structural changes create a structural
draft. Publication is blocked until **Run query-impact shadow** has compared the
exact draft against every authoritative active context snapshot (up to 100).
The result records the number
of plans with changed query sets and the queries added/removed. Invalid active
criteria, an empty scope or a larger scope blocks the run rather than claiming no impact.

Discovery shadows measure query impact only; intelligence changes use the separate comparison described below.

Focused verification: `npx vitest run tests/security/admin-taxonomy.test.ts
tests/scraper/scraper-correctness-contract.test.ts`.

### Review hardening and release limits

Migration **080** makes query-shadow evidence append-only. Structural status is
computed against the active definition on every draft, including alias edits and
restores. Structural publishing requires server-validated `PUBLISH` confirmation
and a passing shadow for the exact draft, active revision and current snapshot
cohort. Changed authority invalidates that proof. Stored definitions are checked
against their fingerprints; malformed pinned queries fail rather than falling
back to another vocabulary.

The publish dialog is modal, supports Escape, reviews saved concept changes,
requires a fresh publication reason and prevents publishing while editor changes
are unsaved. Shadow details show added/removed queries per plan. Ring selection
is descriptive metadata: it does not exclude a role or change query generation.

### Intelligence taxonomy and bounded decision comparisons

The same Taxonomy view now exposes the domain → discipline → capability graph
from the canonical executive ontology. Operators can add concepts with stable
identities, edit names/aliases/descriptions, reparent within that hierarchy,
classify as CORE/ADJACENT/CONTEXT, and retire a concept plus its descendants.
Retirement preserves historical identities. New ambiguous aliases and invalid
parents are rejected; existing canonical shared aliases retain their mappings.
Description-only edits to an enabled graph are display changes. The first graph publication also requires a comparison against legacy behavior without a pinned graph. Any change to the active advisory
graph requires an admission/verdict shadow and typed `PUBLISH` confirmation.
A combined discovery/intelligence structural draft requires both comparisons.

Newly activated search plans pin the graph and its fingerprint. Planning uses
aliases to expand explicit function intent; attention can recognize related
mandates without creating title vetoes. The evaluation role interpreter receives the pinned graph as advisory vocabulary. Screening, candidate mapping and verdict stages receive source-grounded role judgments, without injecting classification labels into those decisions.
Existing plans, queued evaluations and memos keep their snapshots; publication
is not a bulk re-evaluation. Explicit exclusions and provenance checks remain hard.

Migration **081** adds durable `intelligence_taxonomy_shadows` jobs and BENCH
invocation linkage. The existing `npm run worker:admin-bench` claims these jobs.
Web and worker require matching `RADAR_ADMIN_BENCH_TARGET`, 40-character
`RADAR_RELEASE_SHA`, `RADAR_ADMIN_BENCH_HOSTS` and provider/version configuration.
The UI defaults to three golden fixtures. An operator can explicitly select a
tenant and compare up to three real opportunities with valid frozen inputs;
the server supports a maximum of ten. This is a bounded sample, not a full
corpus guarantee. Real runs validate canonical JD hashes and exact frozen source
identity. They use that tenant's effective model configuration.

Each run compares attention admissions and actual staged decisions for active
and draft graphs, within a conservative reservation cap checked before dispatch.
Invalid output, source-integrity failure, PASS-to-PURSUE, relaxation of
BLOCKED screening, incomplete cases or violated golden sentinels block passing.
Results retain before/after screening drivers, requirement mappings and repair-stage diagnostics. Results are immutable; changed cohort, configuration, draft, active revision,
operator permission or release/environment invalidates publication. Lease loss
requires an explicit new run. Telemetry is BENCH and excluded from tenant usage;
shadow output never writes canonical evaluations, shortlist entries or memos.

Run `npx tsx scripts/acceptance/admin-browser-acceptance.ts` for an isolated browser
journey covering seven views, authorization, discovery publication, intelligence
classification/shadow publication/retirement, modal keyboard and mobile layout.
Its injected fixture comparison validates the workflow without provider calls.
Screenshots/results are under `.radar/acceptance/admin`.

Remote proofs use a named disposable database, never the application target:
`npm run verify:remote-turso-fk` checks actual remote FK enforcement;
`npm run verify:remote-admin-taxonomy` applies migrations and checks concurrent
mutations, exclusive shadow claims, publication and immutable results. Set
`RADAR_REMOTE_VALIDATION_URL`, `RADAR_REMOTE_VALIDATION_TOKEN` and
`RADAR_ADMIN_REMOTE_VALIDATION_CONFIRM=DISPOSABLE`. The contention runner uses
injected synthetic decisions and does not prove live provider output quality.
Both remote proofs passed against `radar-admin-disposable-20261002`.

For Oracle activation, apply migrations through 082 to the shared target, deploy
matching web/worker revisions, provision operators and exercise the enabled bench
worker. This branch remains isolated from main and Oracle until release.
