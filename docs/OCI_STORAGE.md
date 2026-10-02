# OCI storage and acquisition handoff

The native OCI BlobStore uses Oracle's SDK signing and conditional create-only
uploads. Keys retain their existing names. Uploads include MD5 and SHA-256 metadata;
reads verify size/checksums. A repeated put succeeds only for identical bytes.
Canonical JD/version hashes remain semantic identities, separate from byte hashes.
Objects above 100 MiB are rejected by the current processing reader.

## Configuration

On both hosts:

```ini
RADAR_DEPLOYMENT_MODE=distributed
BLOB_STORAGE_PROVIDER=oci
OCI_NAMESPACE=bmdmncpyrlav
OCI_BUCKET=radar-blobstore
OCI_REGION=ap-mumbai-1
```

The local acquisition device uses `RADAR_RUNTIME_ROLE=acquisition`,
`OCI_AUTH_METHOD=config_file`, `OCI_CONFIG_FILE=C:/Users/swapn/.oci/config` and
`OCI_CONFIG_PROFILE=DEFAULT`. The private key stays outside the checkout.

Oracle uses `RADAR_RUNTIME_ROLE=processing`. Prefer
`OCI_AUTH_METHOD=instance_principal` with IAM restricted to this bucket and the
actual VM identity. Alternatively, use a separately provisioned, bucket-scoped
API principal and external config file. Do not copy an administrator's local
private key onto the server. Processing role prevents direct CLI/worker browser
acquisition. Keep server scraper supervision disabled.

`scripts/storage/provision-oci-worker.ts --instance=<VM OCID>` prints the narrowly
scoped IAM plan; `--apply` provisions it idempotently. Membership is restricted to
that exact VM. The policy allows object read/inspect/create in the named bucket,
and deletion only for the reserved `_health*` names. It grants no object overwrite,
canonical object deletion or bucket administration. The policy follows Oracle's
[object-level IAM conditions](https://docs.oracle.com/en-us/iaas/Content/Identity/Reference/objectstoragepolicyreference.htm).

Acquisition and enrichment check storage health before claiming work. A processing host requires
a shared store even if a prior caller already initialized the singleton. Startup
health uses a unique synthetic object and needs create/read/delete rights in its
health prefix; those rights should not imply permission to delete canonical sources.

## Authenticated handoff

The local device also needs `RADAR_ACQUISITION_INGRESS_URL` set to the HTTPS
`/api/acquisition/submit` endpoint and `RADAR_ACQUISITION_TOKEN_FILE` pointing to
an external file with a random token of at least 32 characters.

On Oracle, `RADAR_ACQUISITION_DEVICES_FILE` points to an external JSON array:

```json
[{"tokenSha256":"<SHA-256 hex of token>","userId":"<authenticated user ID>","tenantId":"<tenant ID>","personId":"<authorized person ID>"}]
```

The ACL binds a device to an existing user/membership/person; it does not bypass
membership revocation or person authorization. Configure the exact owner explicitly.
Use one designated local acquisition device; this release does not implement
portal-account scheduling across multiple acquisition devices.

## Current rollout — 2 October 2026

The owner-authorized reset discarded 380 opportunity versions, 12 saved decisions
and their disposable lineage. All 52 protected tables retained identical content;
foreign-key checks and source-immutability triggers passed. The 97 missing legacy
snapshots are recorded in the private discarded-version audit, rather than bound
to synthetic replacements. Candidate documents/source text, profile configuration,
search intent and canonical portal identities remain available.

The laptop and Oracle now use distributed OCI storage and authenticated ingress.
Oracle reads with the exact VM's instance principal; the laptop API private key
was not installed on Oracle. Laptop development starts web/acquisition only;
Oracle starts processing/serving and no portal scraper.

The initial cutover proof used release `bc9f9bc667eebeb5186190f015c648d3f4c21ee3`.
Its full certification passed all nine stages (627 tests passed, one skipped),
including the production SSR build and strict release TypeScript verification.
Exact-release post-deployment smoke passed with all seven required workers healthy,
canonical metrics reconciled and OCI write/read/delete health probes successful.
The verified release is recorded in Oracle's CURRENT_SHA and saved in PM2.
For the current release, read `/health/ready` and Oracle's `CURRENT_SHA`; historical
proof SHAs and test counts in this section are not current-version authority.
The reset utility's additional nine focused tests passed. The separate scraper
TypeScript configuration retains five existing fixture type errors. A supplemental
acquisition/scraper run passed 113 tests and failed one attention-gate fixture
expectation; that supplemental suite is not a clean pass.

The real memo exposed an existing metrics inconsistency: valid engine PURSUE/
CONSIDER evaluations were excluded from verdict totals when acquisition eligibility
was REVIEW. Verdict counts now partition every valid evaluated candidate; the
actionable shortlist accepts ELIGIBLE or REVIEW after a valid current-context
PURSUE/CONSIDER evaluation. A database-backed regression covers
that distinction, and the metrics suite is included in release certification.

Real LinkedIn captures crossed authenticated ingress automatically. Oracle
enriched and evaluated them using the preserved candidate and acquired company
context. The Head of Marketing opportunity at IAM Institute of Hotel Management
completed composition and Gemini factual review, and its rich CONSIDER Template B
memo was inspected in the Oracle UI, including candidate evidence links and
explicit/inferred cues. PASS evaluations retained their decisions without dossiers.
Model invocation records contain actual provider token usage for evaluation,
composition and factual review.

The proof corpus contains 12 OCI-backed versions. Five evaluations completed
(one CONSIDER and four PASS); one exhausted its retries because its model output
asserted a reporting line from collaboration evidence. That evidence-validation
failure remains visible in the evaluation queue and is not a storage migration
blocker. No model-validation rule was relaxed to make the proof pass.

Worker restart automatically replayed retained outbox entries after an ingress
deployment failure. Oracle's stop control stopped the laptop at a safe checkpoint;
the corrected path persisted terminal `aborted` status and discovery metrics.
Historical failed-capture observations remain auditable; a terminal run's remaining
unadmitted entries are retained and cannot bypass its expired/stopped lease.

Run `scripts/storage/check-oci-readiness.ts` to check every current source and active
processing reference. NULL source keys, missing objects, failed health probes and
checksum errors fail readiness. Usable text versions bind the verified JSON source
snapshot at admission; unusable text is rejected before canonical admission.

The OCI SDK uses its own Node HTTPS transport and loads its CommonJS modules at
runtime. This avoids the scraper's Undici/native-Fetch header incompatibility and
the SSR bundler's callable `node-fetch` export conversion. Deployment verification
must exercise the built server's BlobStore as well as worker/source CLI probes.

## Owner-authorized pre-production corpus reset

On 2 October the owner authorized discarding the complete job/evaluation corpus,
including saved decisions, while retaining candidate/profile configuration and
search intent. Use `scripts/db/reset-corpus.ts` rather than rewriting immutable
source pointers. The current utility exports the full relational audit before
deleting anything, derives deletion order from foreign keys, and verifies exact
contents of every table outside its disposal allowlist inside one transaction.
Candidate documents, source text, claims, profiles, search plans and canonical
portal/job identities are preserved. The source-immutability triggers remain intact.

Dry run exports without deletion. Execution requires `--confirm`, the exact
`--target=<database fingerprint>`, and an unused `--audit=<private local file>`.
Use `--missing-manifest=<inventory JSON>` to mark the 97 missing originals in the
discarded-version audit. Quiesce all RADAR writers before execution. Do not publish
the audit: its complete recovery export contains candidate data and configuration.
Archive local snapshots, extraction caches, enrichment caches and run manifests
before resuming acquisition; preserve browser profiles and original blob files.

Remote admission uses the durable scrape worker with a run lease. Direct legacy
single-host/global-market execution is preserved when ingress is not configured.
The local scraper still uses Turso for run/discovery orchestration; canonical
admission is routed through ingress when configured. This is not an offline scraper.

The local outbox fsyncs each versioned acquisition envelope before scheduling an
independent uploader. Portal detail acquisition continues while upload, verification
and authenticated admission run in the background. Set
`RADAR_ACQUISITION_UPLOAD_CONCURRENCY` to 1–8 (default 2); this bounds concurrent
transfers rather than browser tabs. The existing OCI HTTPS agent reuses connections.
Small envelopes use individual conditional uploads, not multipart or end-of-run
batches. Canonical admission still requires verified OCI bytes and an ingress receipt;
local capture alone is not canonical admission or eligibility for evaluation.

The spool is bounded at 512 MiB/5,000 entries, including retained receipts;
capacity exhaustion preserves entries and stops capture. Recovery is scoped to the
same tenant, person and run. Persisted receipts are applied locally without repeating
canonical admission. Retryable transfer failures requeue the run with retained bytes;
integrity failures remain visible and require investigation. Acquisition retains its
execution lease while draining captured payloads; completion never waits for
enrichment or evaluation. Stop prevents new captures and drains staged payloads under
the current lease before marking the run aborted. Interrupted stop/drain recovery
retains that stop intent. A terminal run's unadmitted
entries require explicit recovery into an authorized running run; they are not
silently discarded or admitted with an expired lease. Acknowledged entries are
automatically retired after seven days under the retention policy below.

Transport retains extracted source text and structured acquisition data. Browser
HTML stays in the existing local diagnostic snapshots, and recognized credential/
session metadata is rejected. Original binary documents are transported separately
as base64 in the versioned envelope. Canonical validation is still owned by the
existing ingestion service.

Ingress accepts only the authenticated scope's deterministic object prefix. It
checks actual size/hash, envelope scope, run ownership and lease expiry. Canonical
admission stores the ingress receipt and pending evaluation dispatch inside the
same database transaction. Replay returns the original result or reconciles pending
dispatch without needing to scrape again, even after the run becomes terminal.
OCI and Turso are not one transaction: unreferenced objects can remain after failed
admission. Unacknowledged and unclassified objects remain protected rather than
being deleted by age. Inventory them for explicit recovery.

Run stop/confirmation use the durable states already polled by the local worker.
Processing-host UI reads durable events/status instead of requiring the local
journal. Workers publish summary telemetry at heartbeat intervals; this is not a
complete mirror of every local journal event. Progress distinguishes discovered cards,
JDs saved locally, pending transfers and admitted captures. Detail timing separates
browser queue wait from extraction. Optional title locators have a one-second budget;
the required JD acquisition and validation remain intact. Portal pool exceptions are
reported immediately and failed units leave the running state, so another portal's
activity cannot mask a stranded LinkedIn unit.

The 2 October acquisition performance proof deliberately limited only its own run
to two cards per page. In 1m 53s it discovered 16 cards across all three portals and
staged/admitted 13 payloads with zero ingestion failures. LinkedIn completed five
search units and advanced from Vice President to CMO; Naukri and Indeed also
captured jobs. Envelope uploads took 53–118 ms, verification 44–94 ms, and ingress
acknowledgement 387–3913 ms. These are observations from a small live test, not a
throughput guarantee. Normal search defaults were not changed. The original
LinkedIn stall's exception was not retained, so its root cause remains unconfirmed;
the corrected reporting prevents future portal failures from silently stranding UI
state. Private runtime evidence is saved in `.radar/acquisition-performance-proof.json`.

## Verification and historical transfer

`npm run storage:verify-oci -- --ssh=oracle-radar` uses synthetic content only.
It checks immutable duplicate/conflict behavior and independent readback. The SSH
proof sends a temporary signature for one GET request; it does not establish a
permanent Oracle worker principal. It deletes only its uniquely named test object.

`npm run storage:inventory -- --source=<absolute store directory>
--manifest=<report path>` inventories local bytes and database references without
uploading. Run on every producer host against the same verified database target.
The default source is `.radar/artifacts/blobs` and report is `.radar/oci-transfer.json`.
Adding `--copy` copies referenced objects with their original keys and verifies
exact bytes. Re-running is idempotent. Unreferenced files are inventoried but not
copied. Nothing deletes local originals or rewrites database references.

Before cutover, reconcile the union of all host inventories, establish the Oracle
worker principal, verify all active/source references and resolve missing canonical
sources explicitly. Do not manufacture replacement bytes at an original immutable
source key. Existing terminal processing blobs may already have been deleted by
older enrichment workers. The new cleanup protects blobs referenced as canonical
sources or by active processing. Automatic OCI deletion is confined to acknowledged
handoff staging; canonical sources remain durable. Do not put blanket age-based
lifecycle deletion on the bucket.

## Execution authority, refresh and retention

Migration 071 adds `acquisition_execution_lease` and staging retirement receipts.
Every distributed `startRun`, including direct CLI execution, acquires the same
120-second database-clock lease and renews every 30 seconds. Stale renewal/release
is token-fenced; ownership loss closes local browser contexts. Ingress validates
the execution token inside canonical admission's transaction. Busy workers leave
work queued. Run leases still own run mutations; profile locks protect local files.
The acquisition ledger records observations; its legacy item leases do not execute
the live scraper. All portal runs are serialized across hosts, including different
people. There is no concurrent multi-account scheduler. Keep the designated laptop
and device ACL; another host cannot own browser execution simultaneously.

`--fresh-source` and alias `--fresh` start a new run and bypass cached source
snapshots. `FRESH_SOURCE=true` and legacy `FRESH_RUN=true` mean the same thing.
`--new-run` starts new orchestration while permitting a valid source cache.
Worker config `freshSource: true` forces refresh for its queued run. Identical
content still reuses the immutable canonical version; no replacement bytes are
written to an existing source key. Content-keyed downstream results may be reused.

Shared snapshots omit browser HTML/session metadata and redundant root/card copies
of the full JD. Distinct discovery snippets remain evidence. Canonical material
and detail text remain for existing hash/enrichment contracts. Turso's canonical
source text is deliberate durable truth, not a disposable cache.

| Class | Cleanup policy |
| --- | --- |
| Canonical source / source-bound processing snapshot | Durable; never age-deleted |
| Pending upload, dispatch-pending receipt, unacknowledged outbox | Protected until successful admission/recovery |
| Acknowledged OCI handoff staging | Seven days after admission, following dispatch completion and reference checks |
| Acknowledged local outbox | Seven days after local acknowledgement, with matching committed receipt |
| Local snapshots, extraction/enrichment caches and metrics | Seven days, only when acquisition/enrichment is inactive |
| Known terminal run files | Thirty days using durable terminal status |
| Profiles, credentials, local original blobs, unknown runs/objects | Excluded from automatic deletion |

The acquisition worker cleans at startup and hourly while sharing the execution
lease with browser runs. It skips busy acquisition, never follows symlinks and
persists retirement to avoid repeated remote deletes. Failures remain retryable.
Each diagnostic directory removes at most 500 eligible files per pass; later
hourly passes continue the sweep, keeping cleanup bounded.
The laptop principal needs `handoff/` delete permission; Oracle's VM retains only
health-probe delete permission. No bucket lifecycle deletion is required.

Inspect with `npx tsx scripts/storage/retain-acquisition.ts` on the acquisition
host; add `--apply` for the same cleanup used automatically by the worker. It
requires migration 071 and the configured target. Unknown objects remain protected
because age cannot prove absence of pending retries. Non-job corpus retention is
outside this job-acquisition policy; do not turn articles into job evaluations.

Deploy writers/readers together after migration. Rollback must retain OCI access
for newly admitted keys, rather than simply switching every reader back to local
storage. Final acceptance still requires a real local JD/candidate/context journey
through Oracle processing to a reviewed Template B memo (PURSUE/CONSIDER) and UI.

The final acquisition rollout on 2 October 2026 is recorded in
[the remediation closeout](OCI_ACQUISITION_PLAN_REVIEW.md#verified-completion--2-october-2026),
including certification, deployed smoke, real retention and cross-host lease
proof. That record also distinguishes the subsequent indicative-title
shortlist correction independently of the completed OCI remediation.
# Local search progress and console

Captured counts use the larger of the cached summary and discovered cards.
The acquisition worker publishes discovery counts, activity and timestamps every
30 seconds while retaining its run lease. Enrichment and evaluation counts come
from their durable queues; they can advance while a portal is reading job details.
An already-running worker keeps its loaded code until the next restart.

For a full local console log, start the next development session in PowerShell
with `npm run dev 2>&1 | Tee-Object -FilePath .radar/dev-console.log`.
Do not start a second development process while a search is running. A durable
run journal is available under `.scraper-artifacts/runs/<run-id>/manifest.json`
and `journal.ndjson`; it records scraper activity, rather than all npm output.

# Local manifest contention

Windows can temporarily deny replacement of a local run manifest while another
process holds a file handle. Atomic progress writes fsync a unique replacement,
retry transient EPERM/EACCES/EBUSY errors within a bounded window without a CPU
spin, and preserve the last good manifest and replacement if contention persists.
Portal-pool error reporting waits for all remaining portal runners to settle
before shared transfer/browser resources can be closed.

A failed local manifest write does not invalidate acknowledged canonical sources.
Unacknowledged captures remain in the configured durable acquisition outbox. Resume
only the same authorized run with a fresh execution lease and a compatible manifest;
do not clear source keys, replay another person's spool, or reset completed lineage.
