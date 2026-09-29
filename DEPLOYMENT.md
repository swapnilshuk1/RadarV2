# RADAR deployment and release verification

Current guide as of 19 September 2026. The primary checkout is
`C:\Users\swapn\Downloads\Radar V2` on `main`. See the
[architecture](docs/ARCHITECTURE.md) and [backfill runbook](docs/operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md).
Use this guide for release preparation and verification. RADAR is currently
pre-production; deployment should optimize for safe iteration rather than simulate
a production change-control program. The verification policy is
[Verification and release standard](docs/VERIFICATION_AND_RELEASE.md).

## Pre-production deployment principle

Deploy only the runtime needed for the target being exercised. Do not install,
start, probe or require every subsystem merely because it exists in the repository.

The browser scraper is a separate operational capability. If the remote
pre-production target does not run scraping, Chromium/Playwright is not a deployment
prerequisite, the scraper process should not be required for readiness, and scraper
preflight should not be part of that deployment. Run browser preflight on the
machine that actually executes scraping.

Likewise, whole-fleet PM2/readiness checks belong only to a target intended to run
that whole fleet. A web + Pursuit/dossier target should verify those processes and
their dependencies rather than manufacture unused workers to satisfy a generic
topology.

For current pre-production use, think in three distinct targets:

- acquisition workstation: scraper + Chromium/Playwright;
- pre-production app host: web plus the workers needed for the journey under test;
- future production: an explicitly designed service topology, not today's entire
  repository copied wholesale into a "production" checklist.

## Prove locally and identify the release

Use an isolated local database with explicit environment overrides. `npm run dev`
starts the web application plus the supervised evaluator service; evaluation remains
STOPPED until an authorized user presses **Start evaluation** in RADAR. It never runs
migrations. Apply migrations explicitly with `npm run db:migrate` against the selected
non-production target. Use `npm run dev:full` only when intentionally exercising the
complete local worker fleet.
During development, validate only the behavior invalidated by the change. Do not
run TypeScript/build/full certification as a ritual after each correction. On the
final release candidate, run the authoritative certification once; it already
contains TypeScript and the production build. CI packages `.output` for its exact
commit SHA. Pushing `main` runs CI; it does not deploy or activate serving.

Choose an artifact built for the actual target operating system, CPU architecture
and Node runtime. A Windows build is not a Linux deployment artifact, and a Linux
x64 artifact is not proof of ARM64 compatibility. Verify the live host rather than
assuming a particular OCI machine shape or architecture.

## Prepare a concrete production execution plan

Record the SHA/artifact, target host/database, the processes actually intended to
run, required migrations/configuration and stop conditions. For a pre-production
target, do not require rollback ceremony, browser dependencies or unrelated worker
health unless the deployment can actually mutate data or relies on those components.
Verify storage/profile access only for workers that will consume it.

Current v8 rollout requires operational context search and the configured model
providers. Google ADC must work under the production process identity. For Bedrock
Mantle intelligence models, configure `BEDROCK_MANTLE_API_KEY` or provide an absolute
external path via `BEDROCK_MANTLE_KEY_FILE=/absolute/external/secret/path`. All
production credentials (API keys, service account files, Mantle keys) must reside
strictly outside deployment artifacts and repository trees. Keys being present
locally do not establish production access or quota. Keep credentials outside Git
and release archives.

`scripts/deploy.ts` and older deployment helpers can perform live writes and
restarts. Their presence is not authorization to execute them. Production server,
database and process changes require explicit approval after local proof. Do not
deploy simply to complete a code cleanup or documentation update.

## Verify before activation

After deployment, verify the actual running SHA, database target, migration state,
the intended process set and the rendered journey being exercised. Verify provider
access only when that release path actually uses the provider. Do not fail a
pre-production deployment because an intentionally absent worker or browser runtime
is missing. Inspect evaluation, dossier and publication coverage separately when
those paths are part of the target. Backfill and `STAGED_EVALUATED` publication do
not themselves activate a new context.

Activate only after the approved readiness and rendered-dossier evidence is clean.
Guard against an unexpected active-pointer change. Rollback restores the previous
approved release/context; it does not erase newer immutable evaluations, source
evidence or user decisions.
