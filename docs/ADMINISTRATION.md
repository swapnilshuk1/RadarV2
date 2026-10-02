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
npx tsx scripts/admin.ts grant --user USER_ID --reason "Initial console operator"
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
remain unavailable. Recorded invalid outputs measure invocation status, not the
semantic quality of the resulting decision. BENCH invocations are retained but excluded from tenant usage rollups.

Overview and Audit are read-only. Operations and Tenants & Quotas expose
operator-only protection writes; Engine and Models expose configuration drafts
and fixture benches.
Engine shows the fixed stage order and each stage's inputs, decisions, continuation
and stop conditions. REVIEW continues to evaluation. Configuration revisions and fixture benches are implemented below. Taxonomy
edits remain Phase 4; no disabled control implies they are implemented. DAU/WAU/MAU, p95 latency and active config
revision are unavailable until the necessary instrumentation exists. Membership
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

The test button queues durable fixture work. Start `npm run worker:admin-bench`
on the intended worker host, with the **same database target** and credential
configuration as that host's other workers; `-- --once` handles a single poll.
This worker is opt-in and is not added to the existing deployment supervisor.
The console can show queued work until the worker starts; Refresh shows results.
It checks operator access both at claim and before every paid dispatch.
Only one queued/running bench per scope is allowed. Superseded/discarded queued
benches are cancelled; a running bench stops before another call when its draft
or active revision changes. Expired leases fail without an automatic paid retry.

Three code-defined synthetic fixtures cover direct leadership fit, adjacent
mandate fit and a mandatory license contradiction. Both revisions run through
the real staged evaluator and Template B composition/factual-review validators.
PASS skips composition. Results compare verdict, screening viability, claim
additions/removals/changes and changed memo sections. No fixture result is saved
to canonical evaluations, serving tables or the shortlist. Invocations carry
`purpose='BENCH'` and a bench run ID; they are excluded from tenant rollups and
tenant quota accounting, while remaining visible as invocation evidence.

Each run has a 50,000–1,000,000 token admission cap, default 500,000. Input byte
bounds plus output allowances reserve capacity before each call; bounds are
retained rather than refunded. This may defer a long bench before all fixtures
finish. It is an admission cap, not an exact tokenizer or provider billing limit.
Any PASS-to-PURSUE flip, invalid transport output, validation repair, source
integrity failure, incomplete fixture suite or provider failure blocks publish.
A failed run retains its reservation and a classified error; it cannot become a
passing result through a retry. Running it again is an explicit new bench.

Fixture success is a narrow prerequisite, not a corpus-wide impact claim.
Real-opportunity benches, rolling seven-day corpus shadows, arbitrary provider
connections, per-stage model routing, rendered memo comparison, structural
taxonomy edits and automatic regeneration are not included in this phase.

Focused verification: `npx vitest run tests/security/admin-config.test.ts`.
The suite covers all configuration write authorization, stale/cross-scope
publication, immutable queued pins, revert behavior, competing bench workers,
preflight caps, revocation, expiry, fixture provenance and BENCH usage exclusion.
Provider requests are simulated in automated tests; a successful worker-host
bench is still required before activating a specific assignment.
