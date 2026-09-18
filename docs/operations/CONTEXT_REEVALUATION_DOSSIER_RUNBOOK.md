# Backfill, reviewed dossiers and context activation

Use the [current integration reference](../PRODUCTION_INTEGRATION.md) for
script flags and the [architecture](../ARCHITECTURE.md) for identities. It describes the current v8/v3.7 workflow.

## 1. Fix the scope and target

Record the exact release SHA, database target, tenant/person, search-plan snapshot,
profile/source bindings, current inactive v8 context and expected active pointer.
Set a population cutoff and account for arrivals after it separately. First prove
the process against an explicitly selected local database copy. Production writes
and activation require their approved execution scopes.

Do not change code, move its checkout or change model settings under a running
backfill. Use its pinned release until the batch finishes. Credentials are runtime
configuration, not files to commit or automatically copy to production.

## 2. Reconcile the complete population

Trace preserved payloads through ingestion, canonical versions, exact enrichment
dependencies, evaluations, valid dossiers and publications. Include records that
never reached canonical ingestion. Count distinct jobs and opportunity versions
separately. Account for completed work, recoverable backlog, blocked work,
duplicates/superseded records and individually justified exclusions.

`stagedRolloutReadiness` considers only CANDIDATE search-plan associations with
ACTIVE, ACQUIRED versions. Its `pending` count covers pending/processing staged
jobs; it does not establish the absence of waiting/dead-letter or stranded blob
work. Its exclusion classification also requires operator review: an
INPUT_UNAVAILABLE row alone is not evidence of a legitimate business exclusion.

## 3. Prove and process a bounded slice

1. Verify schema migrations, exact source provenance and operational context/model
   providers. Make a small capability probe after credential/project changes.
2. Recover dependencies through the existing recovery/enrichment path, matching
   canonical job, opportunity version and required pipeline. Never force waiting
   rows into pending or blanket-retry terminal failures.
3. Enqueue missing eligible work through the scheduler and process bounded batches
   under the intended context. Preserve completed evaluations and user decisions.
4. Compose current v3.7 dossiers using durable checkpoints and independent factual
   review. Validate full evaluation fingerprints and canonical decision traces.
5. Publish valid dossiers. Inspect representative real outcomes through serving
   DTOs and both DossierView templates; do not force particular verdicts.

Quota/authentication failures remain unresolved work. Preserve checkpoints and
stop repeated failing calls. Inspect invalid stored dossiers separately from
missing dossiers: immutable storage does not promise overwrite-on-retry behavior.

## 4. Establish completion and activate separately

For every eligible in-scope version, establish completed enrichment, a completed
evaluation, a valid reviewed dossier and its matching publication. Reconcile the
entire inventory to zero unexplained gaps. Require readiness with `unprepared=0`
and `pending=0`, plus explicit accounting for waiting, dead-letter and excluded
records. Neither an idle worker nor a successful script exit proves completion.

Before activation, verify the actual deployed SHA/architecture, provider settings,
active pointer, coverage and representative rendered dossiers. A Git commit or
CI artifact is not proof of the running deployment. Switch only the approved
context, guarded by the expected previous pointer. Preserve that pointer/release
as the rollback target; retain historical evaluations and presentations.

PASS results need not appear on the shortlist. Verify them through the complete
opportunities surface and direct dossier retrieval. Keep separate reports for
local proof, production preparation, production execution and activation.
