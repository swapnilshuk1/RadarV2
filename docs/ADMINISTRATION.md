# Administration — Phase 1

The `/admin` console is isolated on `codex/admin-phase-1`. It is not deployed on
main. This phase adds visibility and platform authorization; it does not change
acquisition, evaluation, gate meaning, model assignments or memo production.

Apply migration 072 through the normal migration runner before using this branch.
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
semantic quality of the resulting decision. Phase 1 creates no bench runs.

Overview, Operations, Models (observed usage), Tenants and Audit are read-only.
Engine shows the fixed stage order and each stage's inputs, decisions, continuation
and stop conditions. REVIEW continues to evaluation. Model assignments, quotas,
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
