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

## Candidate bootstrap

Restore a non-production database copy to the candidate host, then use only:

```bash
export RADAR_ENV=staging
export RADAR_DATABASE_TARGET=sqlite-candidate
export RADAR_SQLITE_CANDIDATE_ROOT=/var/lib/radar-candidate
export RADAR_SQLITE_CANDIDATE_PATH=/var/lib/radar-candidate/radar.sqlite
export RADAR_ARTIFACT_STORE_ROOT=/var/lib/radar-candidate/artifacts
```

The file must already exist. `RADAR_ARTIFACT_STORE_ROOT` is mandatory for a
candidate using local filesystem blobs; it must be an absolute path below
`RADAR_SQLITE_CANDIDATE_ROOT`, so the normal `<cwd>/.radar/artifacts/blobs`
default can never be reused. A candidate using object storage must instead set
both `BLOB_STORAGE_ENDPOINT` and an explicit
`RADAR_CANDIDATE_BLOB_STORAGE_BUCKET`; it never inherits `BLOB_STORAGE_BUCKET`.
If `BLOB_STORAGE_BUCKET` is present for the normal deployment, the candidate
bucket must be a different bucket; matching names fail startup.

A first-time empty bootstrap additionally requires
`RADAR_SQLITE_CANDIDATE_ALLOW_CREATE=true`; remove that variable immediately
after bootstrapping. Candidate artifacts/blob storage must use paths distinct
from production before starting any scraper or worker.

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

## Backup and restore

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

## Readiness decision

Only mark **CODE READY FOR ORACLE PROOF** after targeted tests, TypeScript and
the build pass. Persistent SQLite is not production-ready until the Oracle
proof, crash recovery, integrity/FK checks and backup/restore boot all pass.
