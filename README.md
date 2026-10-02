# RADAR

RADAR turns a preserved job opportunity, an explicitly bound candidate profile,
and acquired company context into an evidence-grounded executive dossier.
Read [AGENTS.md](AGENTS.md) and the
[product mission](docs/PRODUCT_MISSION.md) before changing it.

Start with the [documentation index](docs/README.md),
[current architecture](docs/ARCHITECTURE.md),
[first-scrape runbook](docs/operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md) and
[deployment guide](DEPLOYMENT.md) for implementation and operational details.

Successful CI for a push to `main` automatically deploys the certified commit to
Oracle. Failed CI keeps the current release running; manual certified-SHA retry
and rollback remain available in **Actions → Deploy Oracle**.

## Workspace

Use `main` as the integration baseline. Create short-lived branches or worktrees for
isolated changes and remove them after merge. Local databases, credentials,
checkpoints and generated artifacts are machine state and must remain outside Git.

## Current application

```text
Portal scrape -> preserved payload -> canonical opportunity/version
             -> enrichment dependency -> durable evaluation job
             -> frozen JD + candidate sources + acquired context
             -> staged decision -> validated draft -> labelled publication
                                    -> durable factual review -> reviewed revision
             (context activation remains a separate explicit operation)
```

The current release contracts are `staged-v8`, `staged-decision-v8`,
`dossier-v4.1` and `memo-facts-v4`. Publication does not activate a context.

Pursuit preparation runs through its own durable worker after migrations
065–070: `npm run worker:pursuit`. It always has deterministic semantic output;
Mantle can enrich the package, with Gemini as an optional secondary. A completed
job does not by itself prove model use. Check `model_invocations` with
`pipeline='pursuit'`, thesis `model_id`/`derivation`, and recorded tokens for a
model-backed run. See [production integration](docs/PRODUCTION_INTEGRATION.md)
for configuration and readiness details.

GLM-5 evaluation and memo writing use **Bedrock Mantle Chat Completions** in
`us-east-1`. Supply credentials through `BEDROCK_MANTLE_API_KEY` or point
`BEDROCK_MANTLE_KEY_FILE` at a key file stored outside the repository. The
environment key takes precedence. Restart running workers after rotating credentials.
Gemini factual review retains its separate ADC configuration.

PURSUE/CONSIDER drafts carry **AI draft · factual review pending**. Run
`npm run worker:reviews` as a separate supervised process after migration 052.
Gemini 3.8 Flash remains the default reviewer; model adapters are independent of
the queue. See the [review-worker runbook](docs/operations/DOSSIER_REVIEW_WORKER.md)
for configuration, retry behavior and local verification. Reviewed dossiers retain
their strict receipt validation; drafts never masquerade as reviewed output.

Gemini review reuses an explicit, one-hour cache of fixed candidate evidence and
review instructions when the input meets the provider's minimum size. Each job's
evidence and memo remain separate. Cache hits are visible in token usage; the
optimization can be disabled with `RADAR_GEMINI_CONTEXT_CACHE=off`.
Historical persisted results remain readable; they are never relabelled as a
new evaluation policy or used as substitute candidate evidence.

| Responsibility                                                 | Location                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Acquisition contracts, validation, planning and web boundary  | `src/acquisition/`                                                                                                      |
| Acquisition workers, portal execution and enrichment queue     | `scripts/scraper/`, `scripts/scrape.ts`, `scripts/enrich.ts`                                                           |
| Candidate profile, projection, pipeline and profile transport   | `src/candidate/`                                                                                                        |
| Opportunity contracts, serving, pagination and actions         | `src/opportunity/`                                                                                                      |
| Durable scheduling and evaluation worker                       | `src/evaluation/work-scheduler.ts`, `src/evaluation/worker.ts`                                                        |
| Evaluation input, context acquisition, checkpoints and policy  | `src/evaluation/staged-input.ts`, `context-provider.ts`, `durable-model.ts`, `policy.ts`                          |
| Evidence extraction, conflicts and source fingerprints         | `src/dossier/evidence.ts`                                                                                              |
| Role requirements and mapping contracts                        | `src/dossier/staged-role.ts`                                                                                           |
| Screening, decision policy and provenance validation           | `src/dossier/staged-screening.ts`, `staged-decision.ts`, `staged-decision-contract.ts`, `staged-decision-integrity.ts` |
| Whole-memo composition and compact factual review              | `src/dossier/composition.ts`, `staged-composition.ts`, `memo-review.ts`, `factual-review-integrity.ts`                 |
| Canonical executive memo and Template B                        | `src/dossier/contracts.ts`, `DossierView.tsx`                                                                          |
| Dossier composition/review workers and publication             | `src/dossier/runtime/`                                                                                                  |
| Persistence, migrations and serving queries                    | `src/data/`                                                                                                            |
| Application routes and shared interface                        | `src/routes/`, `src/components/`                                                                                       |

The semantic screening lab and regression corpus remain available. Historical
experiment reports are evidence, not production entry points. Retired code can
be recovered from Git history. Database migrations remain ordered and intact.

## Local development

The configured OCI workspace uses `RADAR_RUNTIME_ROLE=acquisition`, limiting local
development to web and the scrape worker regardless of full/minimal mode. Oracle
uses `processing`, distributed OCI storage, web and seven processing workers.
Apply migration 071 before activating acquisition/ingress. See [OCI storage](docs/OCI_STORAGE.md)
for credentials, leases, source refresh versus a new run, retention and recovery.
The isolated full-stack instructions below apply when no split-host role is set.

Install the Node/npm versions declared in `package.json`, then `npm ci`.
Use an explicitly selected isolated local database. `npm run dev` starts the web
application on port 3000 plus the complete supervised worker fleet, including
scraping and enrichment, so **Run search** is picked up automatically. The evaluator is
non-consuming until an authorized user presses **Start evaluation** in RADAR; merely
starting the evaluator does not spend model credits. Other workers consume queued
work and may invoke model providers. Apply migrations explicitly with
`npm run db:migrate` when the selected non-production database needs them.

```powershell
$env:RADAR_ENV = 'dev'
$env:TURSO_CONNECTION_URL = 'file:./.radar/local-review/app.sqlite'
$env:TURSO_DATABASE_URL = $env:TURSO_CONNECTION_URL
$env:TURSO_AUTH_TOKEN = 'local-only'
npm run dev
```

`npm run dev:full` remains an alias for the complete worker fleet. For explicit
web-and-evaluator-only development, use `npm run dev -- --minimal`; searches will
remain queued unless a separate scrape worker is running. The evaluator obeys the
same Start/Pause/Resume/Stop control in both modes.

Review an already generated dossier without running models:

```text
npm run dev:dossier -- --file=<path-to-dossier.json>
```

Configuration is local and untracked. Context search requires Tavily; production
model credentials and Google ADC must be configured for the actual runtime.
Never copy local credentials to a deployment automatically.

## Validation and operations

Verification is incremental. During implementation, run the smallest relevant
tests or `npm run certify:affected`; do not repeatedly run TypeScript, the
production build and the full certification suite after every correction.
`npm run certify` is the authoritative full release gate and should normally run
once on the final release candidate. It already contains TypeScript and the
production build.

If a narrow check fails, fix that behavior and rerun the failed/affected checks
while iterating. Documentation, formatting or inventory-only changes do not
invalidate unrelated browser, migration, security or build evidence. See
[verification and release standard](docs/VERIFICATION_AND_RELEASE.md).

CI retains verified Linux output for its exact commit. Pushing code does not deploy it.

Worker processing runs via dedicated commands such as
`npm run worker:evaluations`, `npm run worker:dossiers`, `npm run worker:reviews`,
`npm run worker:corpus`, `npm run worker:scrape`, and `npm run worker:pursuit`.
A pre-production target should run only the workers it actually needs. In
particular, a remote target that does not scrape does not need Chromium/Playwright
or a scraper heartbeat. Inspect configuration and database target before execution. Keep ingestion,
evaluation, composition, publication and
activation counts separate. An idle queue is not a completed backfill, and PASS
results need not appear on the shortlist.

Production execution and activation require an approved plan after local proof.
See the [current production integration guide](docs/PRODUCTION_INTEGRATION.md).
