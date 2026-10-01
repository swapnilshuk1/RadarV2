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

Enrichment checks storage health before claiming work. A processing host requires
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

## Rollout evidence — 1 October 2026

All nine repository certification stages passed (616 tests passed, one skipped),
including the production SSR bundle and strict release TypeScript check. The
additional scraper TypeScript configuration still reports five existing type
errors in `tests/fixtures/staged-rich-dossier.ts`; it must not be described as
passing. The new operational scripts passed ESLint.

The laptop's private-bucket upload and Oracle byte-hash readback passed. The exact
Oracle VM has a provisioned instance-principal dynamic group/policy; its own
identity successfully created, read and deleted a unique synthetic health object.
No local API private key was installed on Oracle.

Four referenced local payloads were copied with original keys and exact-byte
readback verification; originals and database references were retained. The
current database has 99 distinct canonical-source/active-processing references:
two are verified in OCI, and 97 canonical source snapshots are missing. No active
processing payload is missing from OCI. The older Oracle deployment's 47 blobs
contained none of those missing canonical keys.

Run `scripts/storage/check-oci-readiness.ts` with the OCI configuration to verify
the current database's complete required set. It returns a failure status while
required objects are absent. Inventing replacement bytes under old immutable
source keys would corrupt provenance; recover original artifacts or explicitly
record source unavailability before a coordinated cutover. The live application
has not been switched to distributed mode. Authenticated ingress deployment,
device-owner binding and a real portal-to-reviewed-memo proof remain outstanding.

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

The local outbox stores the versioned acquisition envelope before upload, verifies
uploaded bytes, and persists the receipt. It is bounded at 512 MiB/5,000 entries;
capacity exhaustion preserves entries and stops admission. Pending entries for a
resumed run are replayed after it returns to running. A terminal run's unadmitted
entries require explicit recovery into an authorized running run; they are not
silently discarded or admitted with an expired lease. Confirmed entries currently
remain local for diagnostics; no automatic outbox deletion is enabled.

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
admission. Reference-aware orphan retention is deliberately not enabled yet.

Run stop/confirmation use the durable states already polled by the local worker.
Processing-host UI reads durable events/status instead of requiring the local
journal. Workers publish summary telemetry at heartbeat intervals; this is not a
complete mirror of every local journal event.

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
sources or by active processing; OCI payload deletion is disabled until retention
classes and all consumers are reconciled. Do not put a blanket age-based lifecycle
rule on the bucket.

Deploy writers/readers together after migration. Rollback must retain OCI access
for newly admitted keys, rather than simply switching every reader back to local
storage. Final acceptance still requires a real local JD/candidate/context journey
through Oracle processing to a reviewed Template B memo (PURSUE/CONSIDER) and UI.
