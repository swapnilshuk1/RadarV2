# Acquisition remediation status

This is the current resolution map for the supplied P0/P1 audit. The original
proposal was pressure-tested and amended; it is not an executable runbook.
Use [OCI storage](OCI_STORAGE.md) for configuration, safety rules and commands,
[Architecture](ARCHITECTURE.md) for the code map and [Deployment](../DEPLOYMENT.md)
for activation. The full disposable pre-production corpus reset was explicitly
authorized by the owner; historical source pointers were never rewritten.

| Original finding | Implemented resolution |
| --- | --- |
| P0: Shared queue references host-local bytes | Native authenticated OCI, upload/readback before admission, exact source binding and startup capability checks |
| P0: Global scraper locks cannot coordinate hosts | Database-clock execution lease across distributed CLI/worker paths; Oracle acquisition disabled |
| P0: Portal profile locks are host-local | Local locks retained for file safety; global execution serialization prevents simultaneous hosts/accounts |
| P0: Oracle run UI requires laptop journals | Durable run events/status, confirmation and stop; local journals remain diagnostics |
| P1: Direct execution and run leases have different ownership | Shared execution lease plus existing scoped run fencing; stale execution token rejected inside ingress admission transaction |
| P1: Unsafe storage/worker placement | Role guards and distributed storage readiness fail closed before queue consumption |
| P1: Retention incomplete | Automatic receipt/reference-aware staging and local diagnostic cleanup, protected canonical/pending data and persisted retirement |
| P1: Partial local writes / OCI upload races | Temporary file/fsync/rename; conditional create-only OCI publication, duplicate verification and conflict rejection |
| P1: Snapshot amplification | Browser HTML excluded from shared storage; repeated full JD root/card fields removed, distinct snippets retained |
| P1: Fresh flag reuses cached detail | --fresh-source and --fresh bypass snapshots; --new-run explicitly allows valid cache reuse |
| P1: Observation timestamps regress | Monotonic last_seen_at updates |
| P1: Acquisition ownership duplication | Run/execution leases own live execution; ledger item leases are legacy APIs, not another live queue |

Acceptance includes real private OCI upload/readback, automatic outbox recovery,
remote stop, preserved tenant/person isolation, intact source immutability and a
real candidate/JD/context journey to a reviewed Template B CONSIDER memo. PASS
retains its evaluation without composition. Final certification and deployed
exact-release smoke are required; test mocks alone are insufficient.

Supported limits are deliberate: portal execution is serialized, not scheduled
concurrently across independent accounts. Unknown objects and unacknowledged
terminal-run uploads are preserved for explicit recovery; age alone is not a
safe deletion rule. Browser profiles and original local blobs are never swept.
Non-job corpus ingestion/retention is outside the job-acquisition remediation.
Do not apply a blanket bucket lifecycle rule or restore single_host readers on
rollback. Detailed journal mirroring is not required for authoritative run state.

The audit's claim that no cleanup existed was corrected: enrichment already
removed some terminal payloads. That immediate cleanup now protects canonical
sources, and OCI staging retirement is handled separately. A remote database
alone does not make local storage invalid; the unsafe combination is cross-host
consumers without shared payload access. Existing historical data was discarded
through the approved audited reset instead of fabricated restoration.

## Verified completion — 2 October 2026

The remaining acquisition remediation was certified and deployed as
`4a7923b959ba078a2f3d32ec90490ba53a50f22f` (migration 071). All nine certification
stages passed: 636 tests passed and one skipped; type verification and production
build passed. Exact-release production smoke passed with seven healthy processing
workers, metric integrity and a private OCI write/read/delete round trip.
The deployed SSR bundle independently read a real bound source. GitHub's Oracle
deployment mode is now `distributed`, matching the host configuration.

A live laptop-held execution lease rejected a competing Oracle claim. Automatic
retention ran successfully at laptop-worker startup. An isolated test database
proved actual deletion of an expired synthetic private-OCI handoff and its
acknowledged local outbox file, without altering production receipts. A fresh
LinkedIn run admitted two honest new source versions through the token-fenced
Oracle ingress; the run was cooperatively stopped after those receipts. All 14
canonical versions are OCI-backed, with no foreign-key violations. These counts
are a dated verification record; `/health/ready`, `/health/system` and the deployed
`CURRENT_SHA` remain authoritative for current runtime state.

The earlier real candidate/JD/context journey already produced the reviewed
Template B CONSIDER memo for LinkedIn job `4472931309`. The initial serving rule
excluded its `REVIEW/ROLE_UNKNOWN` association because the gate did not equate
`Marketing Head` with `Head of Marketing`. The subsequent indicative-title
correction lets REVIEW candidates reach evaluation and includes valid current
PURSUE/CONSIDER recommendations in shortlist feed, navigation and counts.
Title/function wording and apparent title seniority are advisory signals;
explicit exclusions and clear JD-backed contradictions remain blocking.
The case retains its honest ROLE_UNKNOWN flag and unchanged provenance.
No alias list, fuzzy-match threshold or forced eligibility rewrite is required.

## Indicative-title correction verified — 2 October 2026

Release `521f5f31901cff771865b74ffd2426e328bb5ba4` deploys the advisory designation
gate and the shared ELIGIBLE/REVIEW shortlist rule. Final certification passed
all nine stages: 655 tests passed and one skipped, including unknown/unrelated
terminology, title-only function/seniority uncertainty, explicit exclusions,
canonical-pool scheduling, shortlist feed/navigation and metric parity.
Authenticated browser acceptance shows Head of Marketing — CONSIDER at IAM
Institute of Hotel Management on the shortlist with one remaining to review.
The actual database-backed query also returns that case, its navigation and an
actionable queue count of one with metric integrity PASS. No saved decision,
source identity, evaluated artifact or ROLE_UNKNOWN audit flag was rewritten.
All seven Oracle processing workers and the laptop acquisition worker were
restarted onto the corrected code. Current deployment identity remains available
from health endpoints and CURRENT_SHA rather than this dated proof record.

This changes eligibility policy, not title recognition accuracy: unresolved
terminology is allowed into mandate evaluation instead of treated as a veto.
More unfamiliar roles may therefore be evaluated; valid recommendations still
require the existing intelligence pipeline. No additional model invocation or
new persistence system was added to the gate. No database migration is needed.

Exact-release production smoke also passed after rollout: 7/7 required workers,
private OCI round trip, metric integrity PASS and actionable queue count one.
The verified release was recorded in CURRENT_SHA and the PM2 process list saved.
