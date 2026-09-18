# RADAR

RADAR turns a preserved job opportunity, an explicitly bound candidate profile,
and acquired company context into an evidence-grounded executive dossier.
Read [AGENTS.md](AGENTS.md) and the
[product mission](docs/PRODUCT_MISSION.md) before changing it.

Start with the [documentation index](docs/README.md),
[current architecture](docs/ARCHITECTURE.md),
[backfill runbook](docs/operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md) and
[deployment guide](DEPLOYMENT.md) for implementation and operational details.

## Workspace

The primary checkout is `C:\Users\swapn\Downloads\Radar V2` on `main`.
Temporary worktrees are for isolated tasks, not alternate product versions.
An active backfill must finish on its pinned checkout before that worktree is
retired. Never move its databases, credentials, checkpoints or source files while
it is running.

## Current application

```text
Portal scrape -> preserved payload -> canonical opportunity/version
             -> enrichment dependency -> durable evaluation job
             -> frozen JD + candidate sources + acquired context
             -> staged decision -> reviewed rich dossier -> publication
                                                        -> explicit activation
```

The current release contracts are `staged-v8`, `staged-decision-v8`,
`dossier-v4.0` and `editorial-facts-v2`. Publication does not activate a context.
Historical persisted results remain readable; they are never relabelled as a
new evaluation policy or used as substitute candidate evidence.

| Responsibility | Location |
| --- | --- |
| Portal acquisition, payload preservation, enrichment queue | `scripts/scraper/`, `scripts/scrape.ts`, `scripts/enrich.ts` |
| Durable scheduling and evaluation worker | `src/lib/intelligence/EvaluationWorkScheduler.ts`, `EvaluationWorker.ts` |
| Production input, context acquisition, checkpoints and rollout | `src/lib/intelligence/staged/` |
| Evidence extraction, conflicts and source fingerprints | `src/dossier/evidence.ts` |
| Role requirements and mapping contracts | `src/dossier/staged-role.ts` |
| Screening, decision policy and provenance validation | `src/dossier/staged-screening.ts`, `staged-decision.ts`, `staged-decision-contract.ts`, `staged-decision-integrity.ts` |
| Section composition and independent factual review | `src/dossier/composition.ts`, `staged-composition.ts`, `factual-review-integrity.ts` |
| Canonical executive memo and Template B | `src/dossier/contracts.ts`, `DossierView.tsx` |
| Persistence, migrations and serving queries | `src/data/` |
| Application routes and shared interface | `src/routes/`, `src/components/` |

The semantic screening lab and regression corpus remain available. Historical
experiment reports are evidence, not production entry points. Retired code can
be recovered from Git history. Database migrations remain ordered and intact.

## Local development

Install the Node/npm versions declared in `package.json`, then `npm ci`.
Use an explicitly selected isolated local database. `npm run dev` runs database
bootstrap/migrations; do not let a production URL in `.env` select its target.

```powershell
$env:RADAR_ENV = 'dev'
$env:TURSO_CONNECTION_URL = 'file:C:/Users/swapn/Downloads/Radar V2/.radar/local-review/app.sqlite'
$env:TURSO_DATABASE_URL = $env:TURSO_CONNECTION_URL
$env:TURSO_AUTH_TOKEN = 'local-only'
npm run dev
```

Review an already generated dossier without running models:

```text
npm run dev:dossier -- --file=<path-to-dossier.json>
```

Configuration is local and untracked. Context search requires Tavily; production
model credentials and Google ADC must be configured for the actual runtime.
Never copy local credentials to a deployment automatically.

## Validation and operations

```text
npx tsc -p tsconfig.verify.json --noEmit
npm run build
npx vitest run --config vitest.certification.config.ts
```

The certification manifest in `scripts/certification/manifest.ts` is the
authoritative release check. CI retains verified Linux output for its exact
commit. Pushing code does not deploy it.

Backfill uses the existing `backfill-staged-evaluations.ts`,
`process-staged-evaluation-jobs.ts`, `compose-staged-dossiers.ts` and
`complete-staged-rollout.ts` scripts. Inspect their flags and database target
before execution. Keep ingestion, evaluation, composition, publication and
activation counts separate. An idle queue is not a completed backfill, and PASS
results need not appear on the shortlist.

Production execution and activation require an approved plan after local proof.
See the [current production integration guide](docs/PRODUCTION_INTEGRATION.md).
