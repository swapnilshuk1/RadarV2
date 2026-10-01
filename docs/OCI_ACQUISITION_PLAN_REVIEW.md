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
