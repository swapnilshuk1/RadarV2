# Administration self-audit after Phase 3

Reviewed baseline: `ccc0ef4714abb3f27e7f25c2e90514053c1c8089` on
`codex/admin-phase-1`. The corrective commit following this baseline contains
these fixes. This branch is not merged or deployed to the live acquisition DB.

| Finding | Correction and evidence |
|---|---|
| Bench completion could accept a result after the last call despite expired ownership, operator revocation or replaced draft. Heartbeat could revive an expired lease. | Transactional final ownership/access/revision check; nonexpired heartbeat predicate. Regression tests expire/revoke/replace before completion. |
| A passing bench from an old fixture acceptance version could still authorize publishing. Matching case count did not prove fixture identity or basic expected behavior. | Publication checks the current version; each fixture must appear once with valid verdict/viability. Direct fit stays viable; missing mandatory license stays PASS/BLOCKED. Tests reject stale versions, duplicates and the license contradiction. |
| Preflight happened before waiting for a provider slot; authorization or lease could expire during that wait. | Mantle/Gemini preflight now runs inside the acquired slot. Bench performs another revision/access/lease check there. Tests revoke access during a blocked dispatch and assert no request or false invocation receipt. |
| Semaphore slot handoff could admit a newcomer ahead of a queued waiter. Equal lane limits also shared an undifferentiated pool. | Direct slot handoff; explicit tenant/lane pools with the host provider ceiling retained, including pursuit. Tests cover slot handoff and simultaneous reasoning/writing under host bounds. |
| Bench receipts attributed both sides to the draft and omitted useful dispatch/latency fields. | Active/draft revision recorded separately, plus max output, latency, finish reason and classified errors. Real adapter/invalid-output test asserts receipt fields. |
| Malformed historical tokens could be summed as spend, including negative capacity, and counted as measured in usage. | Shared validity predicate treats negative, fractional, unsafe or inconsistent measurements as unknown. Tests cover quota deferral and unavailable dashboard totals. |
| Unsaved editor values could be visible while actions operated on the older saved draft. | Explicit unsaved state; draft actions disabled until save/cancel. Browser acceptance verifies it. |
| Queue pins had no console ledger; window coverage could be unavailable while the status sentence called the rollup current. | Scoped configuration-pin ledger and coverage-aware status sentence. Queue pins are not presented as worker acknowledgements. |

Regression coverage is in `tests/security/admin-config.test.ts`,
`admin-foundations.test.ts` and `admin-protection.test.ts`, with the full
certification manifest exercising memo, serving, persistence and acquisition
contracts. Requests in automated tests are simulated; databases and reservations
are real local test instances. No paid provider bench is represented as completed.

## Scope and release boundaries

- Separate platform authorization, audited protection and configuration writes,
  source/provenance integrity and immutable job pins remain enforced.
- Existing host-assignment baseline is a compatibility bridge, not a frozen copy
  of environment variables. Keep those settings stable while legacy jobs run.
- Hourly/nightly usage scheduling, worker-host credentials and a current passing
  live-provider bench must be configured and verified for release. This branch
  does not install or activate them on Oracle.
- DAU/WAU/MAU, p95 dashboards and per-worker last-claimed revision remain explicitly
  unavailable; neither session counts nor membership counts substitute for them.
- Plan presets, external alert delivery, extra providers, real-corpus shadow tests
  and automatic memo regeneration remain outside the shipped narrow scope.
- Taxonomy editing remains Phase 4. No title vetoes or live verdict rules were
  introduced by the fixture acceptance assertions.

For procedures and precise quota/concurrency semantics, use
[ADMINISTRATION.md](ADMINISTRATION.md). Remaining release prerequisites must not
be described as completed phases or as a successful Oracle load test.


## Secondary audit at the same baseline

The external findings were checked against both the original Phase 3 SHA and
these uncommitted corrections. The P0 was valid and is fixed: any fixture
PASS → CONSIDER/PURSUE or BLOCKED → PLAUSIBLE now fails acceptance, including
non-license fixtures. The mandatory-license sentinel remains PASS/BLOCKED on
both sides. These checks restrict bench publication, not live opportunity verdicts.

| Secondary finding | Current disposition |
|---|---|
| Merge can deploy Oracle and migrate automatically | Confirmed; this branch remains unmerged and undeployed. |
| Worker-host/release attestation; code/prompt/schema drift | **Open P1.** Fixture-version binding alone is insufficient. Neither worker identity nor release SHA is an enforced publication prerequisite. |
| Pursuit coverage in the bench | **Open P1.** Budget/routing production tests exist, but this publication bench does not execute a Pursuit fixture. |
| Process-local concurrency semantics / contention | Corrected labels/docs; semaphore handoff and distinct lane pools tested. No cross-process lane-wide limiter or live provider load proof is claimed. |
| Repair detection uses English wording | Fixed: typed repair events from evaluator and composition/review. |
| Completed bench evidence mutable | Fixed in additive migration 076: terminal update/deletion protection, immutable identity and legal transitions. |
| Missing tenant quota policy means unbounded | **Open P1.** Pre-production remains opt-in; production activation requires explicit provisioning or a fail-closed default. |
| Stale administrative writes | Configuration state hash and transactional validation implemented/tested. **Quota, override and pause controls remain open P1.** |
| Publish dialog missing field diff | Fixed: active/draft fields plus matching bench summary. |
| Tenant cannot return to platform inheritance | **Open P1.** No inheritance-removal mutation has been added. |
| Abandoned bench recovery | Fixed: scoped operator cancellation with reason, cleared lease, dispatch/completion fencing and audit. A new paid run is explicit. |
| Remote Turso contention | **Unvalidated release prerequisite.** Local SQLite/libSQL evidence does not prove remote contention behavior. Use a disposable remote database, never the acquisition corpus. |
| Legacy assignment not frozen | Confirmed compatibility limitation; no reproducibility claim for host environment variables. Explicit assignments must be the production normal state. |
| Authoritative GitHub CI / failed Vercel status | **Unvalidated release prerequisite.** Local certification is not GitHub CI or an explanation of Vercel's status. |

P2 corrections included here: console GETs no longer append control audit rows;
known credential/lease keys are redacted in bounded audit detail; section failures
produce structured server diagnostics; CLI grants require explicit roles; bench
reservations are labelled admission units rather than exact tokens.

Still deferred P2 work: automatic rollup scheduling, product-activity metrics,
p95/health metrics, audit pagination and retention/export, external alert routing,
provider tokenizers, plan presets, storage/index scaling and step-up authentication.
These are not silently counted as completed phase features.

**Disposition: the P0 is closed, but Phases 1–3 are not yet production-complete.
Phase 4 and merge/deployment remain held until the open P1 work and release
validation above are closed.** This audit document records gaps; it is not a
certificate or a substitute for implementing the remaining controls.


## Additional independent audit (reviewed against 950ee7cd)

The supplied audit evaluates `ccc0ef47`; its line references precede the
corrective commit. P0-1 (including the all-PASS sentinel), P1-2/4/5/6/9/10/12/16,
and P2-1/2/3 are addressed in the current code. P1-15 is only partially closed:
config writes compare state hashes; protection writes still need stale-write checks.
P2-6 sanitization is implemented, but audit pagination remains deferred.

P0-2 describes the intentional main-to-Oracle deployment workflow, not a new
algorithmic defect. Preserve that workflow; do not merge before release readiness.
P1-3 is remote concurrency validation debt; absence of a JavaScript process-local
mutex does not demonstrate defective remote database transaction isolation.

The new blanket foreign-key allegation is **not supported for the local runtime**.
A fresh file database opened through the actual installed `TursoAdapter`, without
running migrations or setting a foreign-key pragma in the probe, returned
`foreign_keys=1`, rejected an orphan insert, and reported no foreign-key violations.
The disposable probe is `.radar/admin-preview/fk-probe.mts`. This is local evidence,
not an Oracle/remote-Turso test. Verify enforcement on fresh remote streams and
transactions, including after migration/reconnect, before concluding that remote
REFERENCES constraints are ignored. A startup pragma alone is not sufficient
acceptance evidence for every remote connection.

One additional confirmed P2 is provider-overrun alert cardinality: current targets
use invocation IDs. Deduplicate the operator signal by tenant/pipeline/job while
retaining per-call evidence in `quota_calls`/`model_invocations`.
Bench process supervision/heartbeat and automatic rollup scheduling remain pending
operational integration. Do not automatically supervise paid benches before
host/release attestation and execution caps are enforced.

The existing open P1 list remains the Phase 4 prerequisite list: bench host/release
binding, Pursuit coverage, protection-write versioning, explicit production quota
policy, tenant return to inheritance and remote contention/FK validation. Also
verify controls-disabled scrape-to-reviewed-memo-to-Pursuit compatibility, preserve
acquisition independence from model-worker concurrency, and obtain exact-SHA CI
before deployment. This review did not change runtime code or live configuration.
