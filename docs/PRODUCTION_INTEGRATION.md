# Staged intelligence integration

Current implementation reference as of 19 September 2026. See the
[architecture](ARCHITECTURE.md), [backfill runbook](operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md)
and [deployment guide](../DEPLOYMENT.md).

## Current contracts

| Contract | Current value | Authority |
| --- | --- | --- |
| Staged policy / decision | `staged-v8` / `staged-decision-v8` | `src/lib/intelligence/staged/stagedPolicy.ts` |
| Rich dossier | `dossier-v4.1` | `src/data/sqlite/repositories/SqliteRichDossierStore.ts` |
| Factual review | `memo-facts-v4` | `src/dossier/factual-review-integrity.ts` |
| Frozen input / durable checkpoints | Migrations 050 / 051 | `src/data/sqlite/migrations/` |

Production input binds exact JD and candidate source identities, acquires company
context, validates source relevance and computes candidate conflicts. It freezes
that evidence before evaluation. V8 context identity includes the acquisition
recipe. New context-aware work must not reuse historical v6/v7 identities.

Bedrock evaluation/composition and Gemini factual review use the configured model
factories. GLM-5 uses Bedrock Mantle, with `BEDROCK_MANTLE_API_KEY` or the local
`mantle.key` file (`BEDROCK_MANTLE_KEY_FILE` overrides its location). The old
Converse bearer/CSV is not a fallback. Restart workers after key rotation.
Google ADC uses standard credential discovery, including service-account
and workload credentials; the target runtime still needs working credentials,
permissions and quota. Tavily configuration is required for current rollout.
Successful NO_RESULTS acquisition differs from configuration/provider failure.

## Supported entry points

These are executable operations, not inspection-only commands. Select an isolated
local database for proof; obtain approval before production execution. Supply
explicit person/profile/context scope rather than relying on selection defaults.

| Script | Responsibility and flag syntax |
| --- | --- |
| `scripts/backfill-staged-evaluations.ts` | Create/bind the current context and enqueue unscheduled work. Space-separated flags: `--person-id <id> --profile-version <version> --limit <n> --ready-only`; `--dry-run` previews selection. |
| `scripts/recover-missing-enrichment.ts` | Historical v6-only CLI: its scope query requires `staged-v6`. `--context=<fingerprint> --limit=<n>` previews; `--execute --worker-host=<hostname>` mutates. Do not use it as a v8 recovery command. |
| `scripts/process-staged-evaluation-jobs.ts` | Process durable work with `--context=<fingerprint> --max-jobs=<n>`; optional `--watch` waits for delayed pending/processing work. |
| `scripts/compose-staged-dossiers.ts` | Compose with `--context=<fingerprint> --limit=<n>`; `--publish` also publishes; `--publish-only` performs publication without model calls. |
| `scripts/complete-staged-rollout.ts` | Mutating supervisor requiring `--context=<fingerprint> --expected-active=<fingerprint>`. It recovers, schedules, composes and publishes even without `--activate`; only that flag permits the guarded pointer switch. |
| `scripts/dossier/preview-staged.ts` | Read-only local dossier preview; `--file=<path>` avoids database/model access. |

`--dry-run` applies to the backfill selector; it is not a global convention across
scripts. Inspect the implementation before using additional flags. The supervisor
does not itself replace the enrichment/evaluation workers. Do not pass its or the
worker's `--watch` option as PM2 filesystem watching.

The shared `MissingEnrichmentRecovery.recoverCompletedDependencies` supports
v6/v7/v8 and is called by the current supervisor. This does not make the older
standalone recovery CLI v8-compatible. If v8 work needs missing enrichment to be
created, establish a scope-correct recovery procedure in the approved execution
plan; do not change the context version merely to pass that CLI's selector.

## Persistence, recovery and visibility

Staged decisions are validated before persistence. Composition reads the exact
canonical decision and frozen input; it cannot replace the verdict. Full evaluation
fingerprints, not input-fingerprint aliases, bind rich dossier lookup/publication.
V3.7 requires factual-review receipts bound to section content and evidence.

Durable checkpoints preserve compatible completed model work across interruptions.
Changing model configuration, request, evidence or review recipe invalidates reuse.
An old partial v3.6 run is not proof of a complete reviewed v3.7 dossier. Provider
outages remain operational blockers; repeated retries must not become a bulk
semantic rerun. An invalid existing immutable dossier requires investigation, not
an overwrite disguised as ordinary composition.

Publication creates `STAGED_EVALUATED` serving data and preserves the active
context pointer. Activation is separately checked against the expected old pointer
and exact prepared coverage. Historical rows and user decisions remain intact.
The complete opportunities surface includes PASS and processing states; the
homepage shortlist intentionally has narrower selection.

No fixed population count, context ID or rollback pointer in an older report is a
current operational default. Resolve and record them from the approved target.
