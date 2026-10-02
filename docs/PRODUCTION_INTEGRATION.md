# Staged intelligence integration

Current implementation reference, including OCI acquisition remediation. See the
[architecture](ARCHITECTURE.md), [backfill runbook](operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md)
and [deployment guide](../DEPLOYMENT.md).

## Current contracts

The split-host contract is documented in [OCI storage](OCI_STORAGE.md). The laptop
uses `acquisition`; Oracle uses `processing` with distributed OCI storage. Apply
migration 071 before starting acquisition execution, ingress fencing and retention.
Oracle runs web/seven processing workers; the laptop runs portal acquisition and
hourly staging/debug cleanup. Development never applies migrations automatically.

| Contract | Current value | Authority |
| --- | --- | --- |
| Staged policy / decision | `staged-v8` / `staged-decision-v8` | `src/evaluation/policy.ts` |
| Rich dossier | `dossier-v4.1` | `src/data/sqlite/repositories/SqliteRichDossierStore.ts` |
| Factual review | `memo-facts-v4` | `src/dossier/factual-review-integrity.ts` |
| Frozen input / durable checkpoints | Migrations 050 / 051 | `src/data/sqlite/migrations/` |

Production input binds exact JD and candidate source identities, acquires company
context, validates source relevance and computes candidate conflicts. It freezes
that evidence before evaluation. V8 context identity includes the acquisition
recipe. New context-aware work must not reuse historical v6/v7 identities.

Bedrock evaluation/composition and Gemini factual review use the configured model
factories. Pursuit uses Bedrock Mantle with DeepSeek V3.2 as its default primary
and GLM-5 as the same-provider fallback, using `BEDROCK_MANTLE_API_KEY` or a key
file outside the repository referenced by `BEDROCK_MANTLE_KEY_FILE`. The old
Converse bearer/CSV is not a fallback. Restart workers after key rotation.
Google ADC uses standard credential discovery, including service-account
and workload credentials; the target runtime still needs working credentials,
permissions and quota. Tavily configuration is required for current rollout.
Successful NO_RESULTS acquisition differs from configuration/provider failure.

## Supported entry points

These are executable operations, not inspection-only commands. Select an isolated
local database for proof; obtain approval before production execution. Supply
explicit person/profile/context scope rather than relying on selection defaults.

| Entry point / Command | Responsibility and syntax |
| --- | --- |
| `npm run worker:evaluations` | Background evaluation worker (`scripts/run-evaluation-worker.ts`) processing staged evaluation jobs. |
| `npm run worker:dossiers` | Dossier composition worker (`scripts/run-dossier-composition-worker.ts`) generating rich dossiers. |
| `npm run worker:reviews` | Dossier review worker (`scripts/run-dossier-review-worker.ts`) processing dossier reviews. |
| `npm run worker:corpus` | Corpus regeneration worker (`scripts/run-corpus-regeneration-worker.ts`) maintaining semantic corpus health. |
| `npm run worker:scrape` | Dedicated scraper worker (`scripts/run-scrape-worker.ts`) executing queued scrape runs. |
| `npm run worker:enrichment` | Enrichment worker (`scripts/enrich.ts`) enriching opportunities with dimension proofs. |
| `npm run worker:documents` | Document processing worker (`scripts/process-document-jobs.ts`). |
| `npm run worker:pursuit` | Pursuit preparation worker (`scripts/run-pursuit-preparation-worker.ts`) consuming queued Pursuit packages. |
| `scripts/dossier/preview-staged.ts` | Read-only local dossier preview; `--file=<path>` avoids database/model access. |
| `npm run db:migrate` | Runs pending database migrations (`scripts/migrate.ts`). |
| `npm run certify:affected` | Fast mapped regression feedback during implementation; not a release certificate. |
| `npm run certify` | Full release certification; normally run once on the final release candidate. |
| `npm run deploy` | Full-topology deployment script; use only when its configured process set matches the actual target. |

The pre-production app host does not run the browser scraper. Leave
`RADAR_SERVER_SCRAPER_ENABLED` unset (or `false`) there. Set it to `true`
only on a host deliberately running `npm run worker:scrape`; that host also
needs Chromium and the scraper preflight.

Inspect the implementation before using additional flags. Workers operate against durable queues. Do not pass a worker's `--watch` option as PM2 filesystem watching.

Verification follows `docs/VERIFICATION_AND_RELEASE.md`: use focused/affected
checks while iterating and reserve full certification for the final release
candidate. A pre-production deployment should supervise only the workers used by
that target. The scraper is not a generic server prerequisite; Chromium/Playwright
belongs only on a machine that actually executes browser scraping or scraper
preflight.

## Pursuit preparation

Apply migrations **065–070** to the selected database before starting the Pursuit
worker. Run `npm run worker:pursuit` as a separate supervised process with the
same database target and release as the web server. Its heartbeat appears as
`pursuit-preparation` in system readiness. `RADAR_PURSUIT_JOB_CONCURRENCY`
controls parallel jobs (default `2`, allowed `1`–`8`).

Deterministic semantic derivation always produces a complete fallback package.
Model enrichment is separate: Mantle is primary, using DeepSeek V3.2 first and
GLM-5 if that Mantle model fails; Gemini is optional cross-provider secondary.
Configure Mantle with `BEDROCK_MANTLE_API_KEY` or `BEDROCK_MANTLE_KEY_FILE`.
`RADAR_PURSUIT_MANTLE_MODEL` explicitly overrides the primary model while
retaining GLM-5 as fallback unless GLM-5 itself is selected; `AWS_REGION` is
also optional. Enable Gemini with
`RADAR_PURSUIT_ENABLE_GEMINI=true`, working Google ADC, and `GCP_PROJECT_ID`;
`RADAR_PURSUIT_GEMINI_MODEL` optionally selects its model. Missing or failed
providers leave the deterministic package available.

A completed preparation job alone does not establish that model enrichment ran.
For a model-backed production check, inspect `model_invocations` with
`pipeline='pursuit'`, the active thesis `model_id` and `derivation`, and token
usage when the provider supplies it.

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


## Administration branch readiness

Administration requires migrations 072-080 on the same database used by web and
the enabled workers. Platform operators are explicit `platform_roles` grants;
tenant-admin membership alone never grants console access. Validate operator,
viewer and tenant-admin journeys before enabling the console. Query-shadow
publication requires authoritative active search snapshots; empty scope is not
a successful proof. Enable the admin bench worker only when model-configuration
writes are exercised and its release/environment matches web. Oracle is the
release target; a Vercel preview is not deployment evidence for this topology.
The discovery-taxonomy editor does not yet implement full intelligence
classification/reparenting and admission/verdict shadow scope.
