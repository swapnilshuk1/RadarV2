# Administration — Phases 1 and 2

The `/admin` console is isolated on `codex/admin-phase-1`. It is not deployed on
main. The console provides platform authorization, visibility and opt-in protection.
Gate meaning, model assignments, acquisition evidence and memo content are preserved.

Apply migrations 072–073 through the normal migration runner before using this branch.
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
semantic quality of the resulting decision. No bench runs exist yet.

Overview, Models (observed usage) and Audit are read-only. Operations and
Tenants & Quotas expose operator-only protection writes.
Engine shows the fixed stage order and each stage's inputs, decisions, continuation
and stop conditions. REVIEW continues to evaluation. Model assignments,
config revisions, test benches and taxonomy edits are future phases; no disabled
control implies they are implemented. DAU/WAU/MAU, p95 latency and active config
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

No tenant receives a quota policy by default. Apply migration 073 to the same
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
job's first claim, not every retry. Existing job caps remain pinned unless raised;
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
configuration. At month rollover, new calls charge the new month while preserving
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

Five invalid outputs on a protected job hold further claims. **Resume held job**
records an operator review boundary and clears backoff; it preserves token spend.
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
