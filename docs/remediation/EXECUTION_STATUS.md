# RADAR Remediation Status

Baseline:
- base commit: `1f440e34f32fe06637596f5e48c2417f1bc19e19`
- branch: `remediation/01-auth-permission-non-escalation`
- certification status: baseline typecheck passed; the certification and build runners start but this terminal integration returns before their child-process completion status. The Gate 0 integrity suites pass (16 tests); the new authorization regression fails as expected against the confirmed defect.

## Completed
- Current branch head — Gate 0 safety coverage made mandatory; added the authorization permission non-escalation regression matrix.
- Current branch head — repaired Gate 0b test fixtures so evaluated-output assertions establish candidate, opportunity, and referential prerequisites.

## Current
- remediation ID: Gate 1 / Remediation 3 — identity and authority hardening
- branch: `remediation/02-identity-authority-hardening`
- candidate authority: confirmed and repaired. Worker and context materialization now produce `NOT_EVALUABLE` with no advisory score or verdict when the authoritative candidate projection is absent.
- evidence ownership: confirmed and repaired. Text-hash reuse is permitted only for the same person; identical content never transfers a candidate-owned evidence graph.
- OAuth scope: confirmed and repaired. The callback provisions person, user, active membership, tenant scope, and OAuth link transactionally before session creation.
- sensitive endpoints: run events resolve canonical run ownership before reading artifacts; process-local `live-scraped.json` is no longer served; corpus regeneration and status are admin-only.

## Storage architecture verification
- Large payload backend: BlobStore. Acquisition writes `snapshots/<cardHash>.json` before enqueueing enrichment; workers retrieve it by `payload_key`.
- Queue metadata backend: Turso `enrichment_jobs`, containing `payload_key`, snapshot reference, lifecycle, and provenance metadata—not aggregate snapshots or raw browser HTML.
- Canonical readable JD backend: `opportunity_versions.raw_content`, which stores extracted/readable opportunity text or normalized structured source used for evaluation; PDF/raw source material uses `source_payload_key` in BlobStore.
- live-scraped.json status: LEGACY FILE RETAINED BUT NO PRODUCTION READERS. It is not a serving or evaluation input.
- Artifact retention/cleanup: successful enrichment deletes the staged payload after canonical persistence; terminal artifacts are also eligible for bounded retention cleanup only when no active job shares the key.

## Blocked / Requires Decision
- This terminal integration does not retain final output/exit status for nested `npm run certify` or `npm run build` child processes. An external run is required to distinguish an application hang from the runner defect.

## Deferred
- Gate 1 remediations 1 and 3 through 5 remain deferred pending external review of this isolated authorization change.
