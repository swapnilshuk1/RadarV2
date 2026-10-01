# OCI acquisition plan: repository pressure test

Reviewed 1 October 2026 against local HEAD `5683fc7`. This is an implementation
review, not evidence of the live Oracle/Turso configuration. Existing unrelated
working-tree edits were left intact. Both supplied audit/plan attachments were reviewed.

## Decision

Proceed with the target topology: local portal acquisition, shared OCI payloads,
Turso state/queues, and Oracle processing/serving. Amend the implementation sequence
and contracts below first. Do not implement the supplied plan verbatim.

Preserve current scraper behavior, canonical identity, source lineage and the
existing ingestion service. Acceptance ends with a rich Template B memo for
PURSUE/CONSIDER; PASS retains evaluation without dossier composition.

## Audit corrections

| Finding | Repository conclusion |
| --- | --- |
| Distributed consumers can claim inaccessible local payloads | Confirmed: `scripts/enrich.ts:105` reads bound payloads through the selected store without a cross-host startup guard. Missing payload errors currently become terminal UNKNOWN failures. |
| Local global/profile locks cannot coordinate hosts | Confirmed limitation. Severity depends on whether multiple acquisition hosts/accounts actually run. Local locks remain appropriate for local browser safety. |
| Run UI is entirely local | Overstated: `canonicalProgress` uses durable run state and queue/evaluation counts. Events, portal details and confirmation still depend on local files. |
| No blob cleanup exists | Incorrect: `scripts/enrich.ts:311` deletes completed payloads. Quota statistics do not implement general retention, orphan cleanup or failed-job cleanup. |
| Local blob publication is crash-safe | False: direct `writeFileSync` publishes the final path. Atomic publication and concurrent capacity accounting need work. |
| Remote storage adapter is ready | False: current S3 adapter uses unsigned fetch, has no explicit timeout, maps all HEAD errors to false, and ignores DELETE response failures. Mock protocol tests do not establish private OCI compatibility. |
| Acquisition ingress is existing runtime infrastructure | Not established: migration 058 exists, but repository search found no acquisition submission runtime using its table. Treat endpoint/client implementation as new work. |
| Fresh-source and monotonic timestamps | Audit supported: `--fresh` still uses snapshot freshness; ledger upsert can regress `last_seen_at`. These can be separate small fixes. |
| Shared Turso necessarily invalidates single-host mode | Too broad: one execution host can legitimately use a remote database and local blobs. The unsafe condition is cross-host consumers sharing a queue without shared payload access. |

## Required plan amendments

1. **Use a real authenticated OCI provider.** Prefer the native SDK behind BlobStore
   for explicit create-only publication/checksums, or a properly signed supported
   S3 client. Merely changing endpoint/bucket cannot fix the present adapter.
   Treat 404 as absent, auth errors as configuration errors, transient errors as
   retryable, and integrity conflicts as terminal. Apply bounded timeouts/backoff.
   Check distributed capability on every guarded call, including after the global
   store singleton has already been initialized. Use unique health-probe keys.

2. **Choose one handoff path.** For this plan, use local durable staging/outbox,
   local OCI upload, then a reference-only authenticated Oracle ingress. Specify
   how the local uploader receives least-privilege credentials or constrained
   upload authorization; the current security section locates credentials only on
   Oracle while expecting the laptop to upload. Oracle verifies the reference and
   invokes the existing ingestion service. Avoid parallel direct canonical writes
   from the local client. Keep durable run leasing intact.

3. **Make retries durable.** A retained snapshot alone is not an outbox. Persist
   submission ID, schema version, authorized scope/run, object key, byte hash/size,
   and upload/acknowledgement state before handoff. Resume after process restart.
   On timeout after server commit, replay the exact submission and return the
   original receipt. Bind the submission ID to scope and immutable request content;
   reuse with different content must conflict. Commit canonical admission,
   submission receipt and durable dispatch consistently; reconcile any existing
   post-commit dispatch gap. Do not claim an atomic transaction spans OCI and Turso.

4. **Separate semantic identity from transport integrity.** Keep the existing
   canonical content hash/version rules. SHA-256 of exact uploaded bytes is a
   separate identity. Full DetailedCard snapshots include noncanonical material,
   so equivalent JDs need not have equal snapshot bytes. Use byte-addressed upload
   keys and an explicit accepted processing-payload binding, or deterministic
   serialization with volatile run metadata outside the immutable payload.
   Race losers verify existing bytes; they never overwrite. Preserve separate
   run-observation lineage when canonical content is reused.

5. **Complete the remote control plane early.** Reuse durable run events where
   sufficient. Move event cursors, confirmation and stop requests/acknowledgements
   onto durable state observed by the local worker. Oracle must not mutate a local
   manifest to control a laptop. Persist progress with monotonic/idempotent updates;
   distinguish acquisition completion from downstream completion. Enforce the
   designated acquisition role in direct CLI and worker entry points, not just PM2.
   Reject stale lease holders at admission/state boundaries. A boolean role flag
   alone does not coordinate two eligible laptops; either enforce one designated
   device or add account-level ownership if multiple devices are supported.

6. **Authorize references, not just callers.** Bind authenticated device identity
   to tenant/person/run and permitted object prefixes. Validate payload schema,
   size, source identity and actual bytes. Do not accept arbitrary fetch URLs or
   caller-supplied scope unchecked. Keep cookies/browser profiles local and inspect
   serialized HTML/metadata for session secrets before export.

7. **Make retention reference-aware.** Change immediate deletion before relying
   on OCI snapshots for replay or original HTML evidence. Retain canonical sources;
   delete processing payloads only after every relevant consumer/retry/reprocessing
   contract permits it. Age alone cannot prove an object is unreferenced. Use
   lifecycle expiry for isolated debug/staging classes, not indiscriminately for
   canonical or pending work. Bound staging without deleting unacknowledged outbox
   entries. Keep non-job corpus work outside this remediation scope.

8. **Move migration before production cutover.** Historical transfer can follow
   proof with isolated new acquisitions, but must precede enabling OCI-only
   consumers on the existing queue. Inventory every producer host and references
   from source documents, processing jobs and other BlobStore callers. Preserve
   existing keys where possible, copy and verify bytes, identify missing historical
   payloads, then reconcile recoverable failed jobs. Retain originals and a
   resumable transfer manifest. Rollback must preserve reads of newly created OCI
   objects; switching all readers back to local storage is not sufficient.

## Revised implementation sequence

1. Read-only runtime/configuration and reference inventory; enforce acquisition
   placement and prevent incompatible consumers from claiming work.
2. Authenticated OCI provider, immutable publication, exact-byte verification and
   focused contract tests.
3. One local outbox/upload/Oracle ingress vertical slice using existing ingestion;
   durable run events, confirmation and stop support included.
4. Isolated cross-host proof with new acquisitions, restart/retry and failure injection.
5. Reference-aware retention and historical copy/verification; recover queued work.
6. Coordinated writer/reader cutover, readiness checks and reversible rollout.
7. Real portal-to-reviewed-memo/UI proof; final release certification once.

Do not defer worker capability checks or remote controls until after active split-host use.

## Acceptance evidence

Inject upload failure; crash after upload; lost acknowledgement after commit;
duplicate/conflicting submissions; concurrent create-only writes; corrupt bytes;
403/404/429/5xx storage responses; expired leases; local worker restart; remote
confirmation/stop; and cleanup concurrent with pending work. Verify tenant/person
isolation, one canonical version for equivalent content, preserved observations,
no admitted reference to an incomplete object, and eventual dispatch after retry.

Prove local upload and Oracle retrieval against a real private OCI bucket. Then
prove one real candidate/JD/context journey through evaluation, reviewed rich memo
and Oracle UI with the laptop filesystem inaccessible to Oracle. Do not substitute
mock storage or queue-completed status for this proof.

Repository checks run: four focused Vitest files reported **28/28 passing**:
blob-store-connectivity, enrichment-payload-resolution, scrape-run-ownership and
scrape-run-state-machine. The command nevertheless returned exit code 1; this is
not a clean command-level pass and needs resolution before using it as a release
gate. No full certification, live portal activity, OCI provisioning or production
database changes were performed during this review.

OCI references: [native ObjectStorageClient conditional/checksum parameters](https://docs.oracle.com/en-us/iaas/tools/python/latest/api/object_storage/client/oci.object_storage.ObjectStorageClient.html),
[S3 compatibility authentication and endpoint](https://docs.public.oneportal.content.oci.oraclecloud.com/iaas/Content/Object/Tasks/s3compatibleapi.htm).
