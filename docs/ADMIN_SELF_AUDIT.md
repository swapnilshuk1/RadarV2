# Administration self-audit after Phase 3

Reviewed baseline: `ccc0ef4714abb3f27e7f25c2e90514053c1c8089` on
`codex/admin-phase-1`. The corrective commit following this baseline contains
these fixes. This branch is not merged or deployed to the live acquisition DB.

| Finding                                                                                                                                                                 | Correction and evidence                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bench completion could accept a result after the last call despite expired ownership, operator revocation or replaced draft. Heartbeat could revive an expired lease.   | Transactional final ownership/access/revision check; nonexpired heartbeat predicate. Regression tests expire/revoke/replace before completion.                                                                                                    |
| A passing bench from an old fixture acceptance version could still authorize publishing. Matching case count did not prove fixture identity or basic expected behavior. | Publication checks the current version; each fixture must appear once with valid verdict/viability. Direct fit stays viable; missing mandatory license stays PASS/BLOCKED. Tests reject stale versions, duplicates and the license contradiction. |
| Preflight happened before waiting for a provider slot; authorization or lease could expire during that wait.                                                            | Mantle/Gemini preflight now runs inside the acquired slot. Bench performs another revision/access/lease check there. Tests revoke access during a blocked dispatch and assert no request or false invocation receipt.                             |
| Semaphore slot handoff could admit a newcomer ahead of a queued waiter. Equal lane limits also shared an undifferentiated pool.                                         | Direct slot handoff; explicit tenant/lane pools with the host provider ceiling retained, including pursuit. Tests cover slot handoff and simultaneous reasoning/writing under host bounds.                                                        |
| Bench receipts attributed both sides to the draft and omitted useful dispatch/latency fields.                                                                           | Active/draft revision recorded separately, plus max output, latency, finish reason and classified errors. Real adapter/invalid-output test asserts receipt fields.                                                                                |
| Malformed historical tokens could be summed as spend, including negative capacity, and counted as measured in usage.                                                    | Shared validity predicate treats negative, fractional, unsafe or inconsistent measurements as unknown. Tests cover quota deferral and unavailable dashboard totals.                                                                               |
| Unsaved editor values could be visible while actions operated on the older saved draft.                                                                                 | Explicit unsaved state; draft actions disabled until save/cancel. Browser acceptance verifies it.                                                                                                                                                 |
| Queue pins had no console ledger; window coverage could be unavailable while the status sentence called the rollup current.                                             | Scoped configuration-pin ledger and coverage-aware status sentence. Queue pins are not presented as worker acknowledgements.                                                                                                                      |

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

| Secondary finding                                         | Current disposition                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge can deploy Oracle and migrate automatically         | Confirmed; this branch remains unmerged and undeployed.                                                                                                                                                                                             |
| Worker-host/release attestation; code/prompt/schema drift | **Closed by migration 077.** Queueing records a declared target/release/provider configuration fingerprint; workers attest allowed host/runtime at claim; publication and completion recheck it.                                                    |
| Pursuit coverage in the bench                             | **Closed by fixture v3.** A bounded synthetic Pursuit-lane request runs through the configured writing route and `PursuitTokenLedger`, with `pipeline='pursuit'` invocation evidence. It creates no pursuit, artifact, canonical or serving record. |
| Process-local concurrency semantics / contention          | Corrected labels/docs; semaphore handoff and distinct lane pools tested. No cross-process lane-wide limiter or live provider load proof is claimed.                                                                                                 |
| Repair detection uses English wording                     | Fixed: typed repair events from evaluator and composition/review.                                                                                                                                                                                   |
| Completed bench evidence mutable                          | Fixed in additive migration 076: terminal update/deletion protection, immutable identity and legal transitions.                                                                                                                                     |
| Missing tenant quota policy means unbounded               | **Closed by migration 077.** New tenants receive bounded platform defaults. Existing tenants receive an explicit, auditable compatibility profile until an operator sets a policy; an absent row fails closed.                                      |
| Stale administrative writes                               | **Closed by migration 077.** Configuration uses a state hash; quota, override, pause, resume and alert acknowledgement use a transactional protection epoch.                                                                                        |
| Publish dialog missing field diff                         | Fixed: active/draft fields plus matching bench summary.                                                                                                                                                                                             |
| Tenant cannot return to platform inheritance              | **Closed by migration 077.** Return creates a new tenant inheritance revision, benches it, and removes the tenant pointer only at publication if the platform base is still current.                                                                |
| Abandoned bench recovery                                  | Fixed: scoped operator cancellation with reason, cleared lease, dispatch/completion fencing and audit. A new paid run is explicit.                                                                                                                  |
| Remote Turso contention                                   | **Unvalidated release prerequisite.** Local SQLite/libSQL evidence does not prove remote contention behavior. Use a disposable remote database, never the acquisition corpus.                                                                       |
| Legacy assignment not frozen                              | Confirmed compatibility limitation; no reproducibility claim for host environment variables. Explicit assignments must be the production normal state.                                                                                              |
| Authoritative GitHub CI / failed Vercel status            | **Unvalidated release prerequisite.** Local certification is not GitHub CI or an explanation of Vercel's status.                                                                                                                                    |

P2 corrections included here: console GETs no longer append control audit rows;
known credential/lease keys are redacted in bounded audit detail; section failures
produce structured server diagnostics; CLI grants require explicit roles; bench
reservations are labelled admission units rather than exact tokens.

Still deferred P2 work: automatic rollup scheduling, product-activity metrics,
p95/health metrics, audit pagination and retention/export, external alert routing,
provider tokenizers, plan presets, storage/index scaling and step-up authentication.
These are not silently counted as completed phase features.

**Disposition: the P0 and the implementation P1s above are closed on this
branch. Deployment remains held for the remote validation, exact-SHA CI and the
controls-disabled end-to-end operational proof above.** This audit document
records evidence and gaps; it is not a certificate or a substitute for running
those release checks.

## Additional independent audit (reviewed against 950ee7cd)

The supplied audit evaluates `ccc0ef47`; its line references precede the
corrective commit. P0-1 (including the all-PASS sentinel), P1-2/4/5/6/9/10/12/15/16,
and P2-1/2/3 are addressed in the current code. Configuration writes compare
state hashes and protection writes compare a transactional protection epoch.
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
Automatic rollup scheduling remains pending operational integration. The bench
worker now has a heartbeat and may be supervised only when
`RADAR_ADMIN_BENCH_ENABLED=true`, after the host/release attestation and execution
caps are configured.

The remaining operational prerequisites are remote contention/FK validation,
controls-disabled scrape-to-reviewed-memo-to-Pursuit compatibility, and
authoritative exact-SHA CI before deployment. Migration 077 separates scrape
claims from model-worker concurrency so acquisition retains independent capacity.
This review did not change live configuration.


## Current Phase 4 implementation review

Reviewed from baseline `2b41f27ac57d67fa3691b5743da3b58f3e6d9990`.

| Finding | Resolution |
| --- | --- |
| P1: editing aliases after add/retire cleared the structural shadow requirement | Derive structural status from the active definition for every draft, rather than a caller flag. |
| P1: restoring an older non-structural revision could bypass the structural shadow | Restore compares the restored structure to current active structure. |
| P1: shadow inspected mutable plan criteria and remained reusable after scope changes | Compare authoritative active snapshots and bind proof to the exact current cohort fingerprint; reject empty/incomplete scope. |
| P1: shadow evidence could be changed or removed | Migration 080 adds immutable evidence triggers. |
| P2: stored taxonomy fingerprint and pinned-query corruption were not enforced | Verify stored fingerprints and fail on malformed taxonomy-pinned query payloads. |
| P2: reserved keys and ambiguous concept identities | Reject reserved object keys and duplicate normalized concept identities. |
| P2: publish dialog lacked true modality and saved-change review | Native modal, Escape support, fresh reason, concept-change summary, structural typed confirmation enforced server-side. Unsaved editor changes block review. |
| P2: mobile shell exceeded the viewport | Constrain the single-column grid and sidebar minimum width; browser overflow assertion passes. |
| P2: Phase 4 test omitted from certification inventory | Register the security suite in the certification manifest and complete test inventory. |

Browser evidence: an isolated local libSQL database passes all seven console
views, tenant-admin rejection, viewer read-only controls, alias publication,
structural shadow/confirmation, modal Escape and mobile viewport containment.
Screenshots were visually inspected; the publication dialog is centered and its
change label renders correctly. The existing 3101 preview was separately checked:
its synthetic fixture database lacked current migrations, was migrated locally,
and authenticated Taxonomy now renders. No production target or live scraper
configuration was changed. The repeat browser/build check was necessitated by
modal positioning and text corrections; unchanged security evidence was reused.

Eight taxonomy tests cover the structural-edit/restore bypasses, immutable proof,
stale and empty shadow scopes, authoritative snapshots, reserved keys and corrupt
pinned queries. The first final gate caught three test-inventory assertions while
747 tests passed; the missing registry entry was corrected and the 18 targeted
inventory/taxonomy checks then passed. Final gate result is recorded below.

### Remaining scope and operational evidence

- Phase 4 now includes revisioned intelligence classification/reparenting/retirement and bounded admission/verdict comparisons. Discovery and intelligence proofs remain distinct; combined structural edits require both. Ring/classification metadata never becomes an exclusion rule.
- Remote Turso foreign-key and contention checks passed on radar-admin-disposable-20261002: one mutation winner, five stale writers rejected, one shadow claim and immutable terminal evidence. Injected decisions prove concurrency/publication, not live model quality.
- Before Oracle activation, apply 072-082, confirm matching web/worker release
  and database identity, provision explicit operators and exercise enabled workers.
  Existing controls-disabled acquisition-to-reviewed-memo-to-Pursuit operational
  proof remains outstanding; acquisition was deliberately left running untouched.
- Usage rollup scheduling still needs Oracle integration. The current host tool
  is `npx tsx scripts/admin.ts rollup --apply`; dashboards honestly show stale or
  unavailable rollups. Alerts and audit pagination retain their documented limits.
- Oracle is the release target. Vercel preview status is not evidence for this
  topology. This branch has not been merged or deployed during this review.


Final verification: `npm run certify` passed all nine stages (182.72 seconds),
including lint (zero errors; 21 existing warnings), formatting, TypeScript,
production SSR build and the certification test manifest. Final authenticated
browser acceptance passed after the modal/text correction; screenshots are under
`.radar/acceptance/admin`. These checks describe the earlier discovery-only candidate; the expanded Phase 4 candidate requires its own final verification.

### Intelligence-taxonomy completion review

The intelligence editor adds stable concepts, advisory names/aliases, validated
parent changes, classifications and recursive retirement. Planning, attention
and evaluation consume pinned snapshots; legacy snapshots remain valid.
Hardening covers new alias ambiguity, invalid/retired parentage, graph fingerprint
corruption, implicit title veto regressions, incomplete/harmful shadow results,
revoked operators, environment drift, pre-dispatch token caps, mixed structural
proofs and immutable remote results. Real opportunity scope checks canonical JD
hashes and frozen JD identity, tenant configuration and current cohort.

The isolated browser journey validates classification, queue/status/publication,
retirement, viewer restrictions and mobile layout alongside the existing seven
views and discovery journey. Its comparison runner is injected and synthetic.
The final certificate and exact commit identify release evidence; this review
has not merged main, deployed Oracle, or changed live scraper state.
