# RADAR deployment and release verification

Current guide as of 19 September 2026. The primary checkout is
`C:\Users\swapn\Downloads\Radar V2` on `main`. See the
[architecture](docs/ARCHITECTURE.md) and [backfill runbook](docs/operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md).
Use this guide for release preparation and verification.

## Prove locally and identify the release

Use an isolated local database with explicit environment overrides; `npm run dev`
can run migrations and must not inherit a production database target accidentally.
Validate relevant behavior, TypeScript, the production build and the certification
manifest. CI packages `.output` for its exact commit SHA. Pushing `main` runs CI;
it does not deploy or activate serving.

Choose an artifact built for the actual target operating system, CPU architecture
and Node runtime. A Windows build is not a Linux deployment artifact, and a Linux
x64 artifact is not proof of ARM64 compatibility. Verify the live host rather than
assuming a particular OCI machine shape or architecture.

## Prepare a concrete production execution plan

Record the approved SHA/artifact, target host/database, web and worker processes,
required migrations/configuration, population scope, exact commands, stop
conditions, previous release and active-context rollback pointer. Verify that all
workers can access the existing payload/profile stores on the intended host.

Current v8 rollout requires operational context search and the configured model
providers. Google ADC must work under the production process identity. Keys being
present locally do not establish production access or quota. Keep credentials
outside Git and release archives.

`scripts/deploy.ts` and older deployment helpers can perform live writes and
restarts. Their presence is not authorization to execute them. Production server,
database and process changes require explicit approval after local proof. Do not
deploy simply to complete a code cleanup or documentation update.

## Verify before activation

After an approved deployment, verify the actual running SHA, process versions,
database target, migration state, provider access and rendered application. Inspect
evaluation, dossier and publication coverage separately. Backfill and
`STAGED_EVALUATED` publication do not themselves activate a new context.

Activate only after the approved readiness and rendered-dossier evidence is clean.
Guard against an unexpected active-pointer change. Rollback restores the previous
approved release/context; it does not erase newer immutable evaluations, source
evidence or user decisions.
