# Persistent SQLite candidate readiness proof

This is a non-production proof for one Oracle host. It never changes the Turso
target, production workers, production credentials, or production blobs.

## What this branch proves

The candidate runtime uses one explicit SQLite file shared by separately
supervised RADAR processes. It validates local connection settings, serializes
awaited transactions on a connection, and supplies baseline, health and online
backup tools. It does not claim that SQLite reduces model-provider latency.

The following deliberately remain operational exercises rather than a synthetic
test framework: the six real candidate processes, crash/restart behavior, and
the 30-minute workload. Replacing those with fake worker implementations would
weaken the proof.

## Candidate BlobStore modes

Portal browsing, portal cookies, and CAPTCHA clearance are localhost-only. The
scraper submits an authenticated immutable acquisition envelope to Oracle;
Oracle assigns the stable `sourcePayloadKey` and persists the source payload
before canonical admission.

### Isolated candidate mode (default)

The default remains the fail-closed isolated candidate configuration:

Restore a non-production database copy to the candidate host, then use only:

```bash
export RADAR_ENV=staging
export RADAR_DATABASE_TARGET=sqlite-candidate
export RADAR_SQLITE_CANDIDATE_ROOT=/var/lib/radar-candidate
export RADAR_SQLITE_CANDIDATE_PATH=/var/lib/radar-candidate/radar.sqlite
export RADAR_ARTIFACT_STORE_ROOT=/var/lib/radar-candidate/artifacts
```

The database file must already exist. `RADAR_ARTIFACT_STORE_ROOT` is mandatory for a
candidate using local filesystem blobs; it must be an absolute path below
`RADAR_SQLITE_CANDIDATE_ROOT`, so the normal `<cwd>/.radar/artifacts/blobs`
default can never be reused. A candidate using object storage must instead set
both `BLOB_STORAGE_ENDPOINT` and an explicit
`RADAR_CANDIDATE_BLOB_STORAGE_BUCKET`; it never inherits `BLOB_STORAGE_BUCKET`.
If `BLOB_STORAGE_BUCKET` is present for the normal deployment, the candidate
bucket must be a different bucket; matching names fail startup.

### Explicit shared-single-host proof mode

For the intended single-Oracle-host topology, the sequential Turso control and
SQLite candidate may use the same durable local BlobStore. This is permitted
only through all of the following explicit settings:

```bash
export RADAR_DEPLOYMENT_MODE=single_host
export RADAR_ARTIFACT_STORE_ROOT=/var/lib/radar-data/blobs
export RADAR_SHARED_LOCAL_BLOB_ROOT=/var/lib/radar-data/blobs
export RADAR_SQLITE_CANDIDATE_ALLOW_SHARED_LOCAL_BLOB=true
```

The shared root must be absolute and resolve exactly to
`RADAR_ARTIFACT_STORE_ROOT`. The opt-in is rejected in `distributed` mode, if
the root is missing or relative, or if the paths differ. Remote candidate-bucket
isolation rules remain unchanged. Use shared-local mode only when ingress,
workers, serving, and every BlobStore consumer execute on the same Oracle host,
and run Turso control and SQLite candidate phases sequentially. The only
intended variable is the database backend.

A first-time empty candidate bootstrap additionally requires
`RADAR_SQLITE_CANDIDATE_ALLOW_CREATE=true`; remove that variable immediately
after bootstrapping. Candidate artifacts/blob storage must use paths distinct
from control artifacts unless explicit shared-single-host proof mode is active.

Canonical source blobs referenced by `opportunity_versions.source_payload_key`
are durable evidence. Enrichment completion and terminal-payload retention
cleanup query canonical database state before deletion and never delete a
referenced key. Unreferenced queue payloads remain eligible for bounded cleanup.

The default 512 MiB / 5,000 file / 168-hour artifact limits were intended for
ephemeral payloads. Configure explicit larger limits on the proof host, for
example `RADAR_ARTIFACT_MAX_BYTES=21474836480` and
`RADAR_ARTIFACT_MAX_FILES=100000`; retention still governs only unreferenced
ephemeral payloads. Size the filesystem and monitoring for the retained
canonical corpus.

Every candidate process receives the same variables and starts separately:

```bash
npm run dev
npm run worker:enrichment
npm run worker:evaluations
npm run worker:dossiers
npm run worker:reviews
```

The scraper is run as an explicit candidate-scoped command. Do not point any
candidate process at a production artifact or blob path.

## Baseline and health

The baseline command is read-only against the configured current database:

```bash
npm run sqlite:baseline -- --run-id=<scrape-run-id> --out=./baseline.json
```

It reports enrichment queue/provider timing, evaluation ready-to-claim and
ready-to-persist timing, and model-invocation latency by stage. Missing
timestamps remain missing; `created_at` is never silently substituted for
`ready_at`.

Inspect the candidate before and after the proof:

```bash
npm run sqlite:health -- --db=/var/lib/radar-candidate/radar.sqlite
npm run sqlite:health -- --db=/var/lib/radar-candidate/radar.sqlite --checkpoint=passive
```

`--checkpoint=truncate` is reserved for a quiet candidate with no workload.

## Oracle-host proof

Run the actual web, scraper, enrichment, evaluation, dossier and review
processes for at least 30 minutes at the intended candidate workload. During
active work, force-stop one worker at a time and restart it. Confirm existing
lease/retry recovery reaches a terminal state and that no stale completion wins.

The proof fails on an escaped `SQLITE_BUSY`, `database is locked`, or nested
transaction error; it also fails unless integrity and foreign-key checks are
clean. Keep the health JSON and worker logs as the proof record.

## Database and BlobStore backup/restore

Create an online backup; never copy a live database/WAL by hand:

```bash
npm run sqlite:backup -- \
  --source=/var/lib/radar-candidate/radar.sqlite \
  --out=/var/lib/radar-candidate/backups/radar-$(date +%Y%m%d-%H%M%S).sqlite
```

Run `sqlite:health` against the backup, then start a separate candidate stack
against that restored file and confirm it can read the expected serving data.
Compare migration ledger, tenant/person/opportunity/evaluation/dossier counts
and active evaluation-context pointers before declaring the backup proof passed.

SQLite backup does not back up the local durable BlobStore. For the Oracle
proof, complete both checks:

1. Restore the SQLite database against the retained `/var/lib/radar-data/blobs`
   corpus and retrieve sampled canonical `sourcePayloadKey` objects.
2. With ingress and blob writers quiescent (or via a coherent filesystem
   snapshot), take a filesystem-level backup of the BlobStore to a distinct
   backup path/device. Restore that corpus alongside a restored database and
   retrieve the same sampled source evidence.

Do not copy a mutating blob tree as an ad-hoc live backup.

## Readiness decision

Only mark **CODE READY FOR ORACLE PROOF** after targeted tests, TypeScript and
the build pass. Persistent SQLite is not production-ready until the Oracle
proof, crash recovery, integrity/FK checks and backup/restore boot all pass.
