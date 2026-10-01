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
Server-side scraping is off by default. Set
`RADAR_SERVER_SCRAPER_ENABLED=true` only on a host that will run the scraper;
PM2, deployment process verification and readiness use the same setting.

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
starts the web application plus the complete supervised worker fleet; evaluation remains
STOPPED until an authorized user presses **Start evaluation** in RADAR. It never runs
migrations. Apply migrations explicitly with `npm run db:migrate` against the selected
non-production target. `npm run dev:full` retains the same full startup. Use
`npm run dev -- --minimal` for web and evaluator only; searches then require a
separate scraper worker. Local payload files are not shared with workers on other
hosts: use isolated databases or shared object storage when running multiple hosts.
During development, validate only the behavior invalidated by the change. Do not
run TypeScript/build/full certification as a ritual after each correction. On the
final release candidate, run the authoritative certification once; it already
contains TypeScript and the production build. CI packages `.output` for its exact
commit SHA. Pushing `main` runs CI; it does not deploy or activate serving.

## Deploy a selected certified commit to Oracle

In GitHub, open **Actions → Deploy Oracle → Run workflow** on `main` and click
**Run workflow**. Leave SHA blank to deploy the latest green `main` CI run, or
enter a full 40-character SHA when selecting an older certified release. This is
the normal deployment procedure: no local SSH, terminal preflight, rebuild or
recertification is needed. The workflow has no push trigger. It accepts only a
commit on `main` with a successful CI run and an unexpired release artifact. The
equivalent CLI commands are:

```text
gh workflow run deploy-oracle.yml --ref main
gh workflow run deploy-oracle.yml --ref main -f sha=<40-character-sha>
```

The action first resolves the exact CI artifact, then performs the Turso target
check, SSH host check, migration, PM2 replacement and readiness/smoke checks. A
retry of the same SHA reuses the archive already present on Oracle, so the normal
retry path does not upload the 151 MB release again. It is safe to retry a failed
workflow while the deployment concurrency lock is active; the selected SHA and
live readiness result are recorded in the workflow summary.

The GitHub `Oracle` environment was updated for OCI on 2 October 2026. Its
non-secret settings are:

| Setting                          | Verified value                                                                |
| -------------------------------- | ----------------------------------------------------------------------------- |
| SSH host / user                  | `161.118.175.246` / `ubuntu`                                                  |
| App directory                    | `/home/ubuntu/radar-sqlite-candidate`                                         |
| Public readiness URL             | `https://161.118.175.246.sslip.io`                                            |
| Web port behind Caddy            | `3001` (`RADAR_WEB_PORT` in the host environment)                             |
| Database                         | Turso `radar-db-preprod-clean-20260924`, fingerprint `turso:8917b590608c33c2` |
| Deployment mode / server scraper | `distributed` (OCI) / disabled                                               |

The designated laptop runs acquisition; Oracle uses `RADAR_RUNTIME_ROLE=processing`,
native OCI instance-principal reads, web and seven processing workers. Apply
migration 071 before switching ingress and acquisition together. Keep the GitHub
`Oracle` environment's `RADAR_DEPLOYMENT_MODE=distributed`: the deployment script
exports that setting over host configuration. Rollback must retain OCI access
for newly admitted source keys. See [OCI storage](docs/OCI_STORAGE.md) for the
current topology, source-refresh semantics, retention and runtime checks.

The app directory's historical name does **not** describe the active database.
The running app and workers use Turso. The host's `/home/ubuntu/radar-sqlite-candidate/.env`
holds the runtime credentials; the release archive contains none. The workflow
has `TURSO_CONNECTION_URL`, `RADAR_DEPLOY_RECOVERY_COMMAND`,
`ORACLE_SSH_PRIVATE_KEY`, and `ORACLE_SSH_KNOWN_HOSTS` as `Oracle` environment
secrets. The local Windows `.ssh` folder is not used by GitHub Actions after
setup. Rotate the corresponding GitHub secret if the Oracle key changes. The
recovery command creates a timestamped Turso branch before a release switch.

The workflow checks the certified artifact, database fingerprint, SSH host key,
Linux x64 / Node 22 runtime and exact release readiness. It recreates only
RADAR-managed PM2 processes so their working directory changes to the new
release; Caddy and the separate proof processes are not touched. Failed
activation attempts to restore the previously healthy release. Missing configuration or a
mismatched target fails before deployment mutation.

The current Oracle VM has about 1 GB of RAM and the certified archive is about
151 MB. Starting the web process and seven workers can take longer than one
minute while the host swaps. The workflow waits up to three minutes for system
readiness before attempting rollback. One click is configured; a deployment
finishing within three minutes is not yet proven on this VM. The CI run and
deployment run show the actual duration.

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
