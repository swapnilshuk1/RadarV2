# Verification and release standard

RADAR is pre-production. Verification exists to catch material defects quickly,
not to turn each edit into a release ceremony. Evidence is cumulative: a check
that passed remains valid until a later change can reasonably invalidate it.

The governing rule is:

> Run the smallest set of checks that can disprove the change. Main CI is the
> single authoritative full certification for the merged release SHA.

"Run everything again to be safe" is not an acceptable reason to repeat a gate.

## Verification levels

| Situation                   | Required evidence                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| Implementation edit         | Tests directly covering changed behavior                                                               |
| Broader source change       | `npm run certify:affected` or an equally narrow mapped set                                             |
| Feature closeout            | Feature suite plus directly coupled host/integration checks                                            |
| Material UI/workflow change | One authenticated browser acceptance after code freezes                                                |
| Pull request                | CI release feedback: lint, formatting, TypeScript, and affected tests                                  |
| Main release candidate      | One authoritative `npm run certify` in main CI, followed by exact-SHA packaging and portability checks |
| Deployment                  | Automatic Oracle deploy consumes the retained artifact for the exact certified main SHA                |

Do not run TypeScript or the production build immediately before full
certification when certification will run the same checks again.

Local iteration should use focused tests and `npm run certify:affected`. Pull
request CI runs `npm run certify:feedback` against the pull request base; it is
fast, non-authoritative feedback that reports independent check results and
deliberately omits the SSR build and release artifact. After merge, main CI runs
the complete `npm run certify` once for the new exact commit, then packages,
verifies portability, and retains the commit-bound artifact. The automatic
deployment accepts only that successful main CI run and its matching artifact.
A failed PR feedback run should be fixed as a batch where practical; do not run
a local full certification merely to duplicate the PR feedback checks.

## Deployment-process hardening

`scripts/certification/registry.ts` owns test membership, certification groups,
and source ownership. The release suite retains 81 files; affected checks use
source ownership and conservatively select every group for unknown paths.
Generate the inventory with `npm run tests:inventory`, and check drift with
`npm run tests:inventory:check`. Migration fixtures clone an empty migrated
SQLite snapshot per worker and migration checksum; upgrade tests continue to
exercise migrations directly.

Certification runs five actual commands: lint, formatting, TypeScript, build,
and the unified test manifest. Independent static failures are collected before
dependent build/test work. The eight logical test groups remain visible in the
manifest report. A separate weekly/manual workflow exercises the full estate
without packaging or deploying a release.

Main CI compares runtime inputs with a receipt from a successful Oracle
deployment. A matching receipt permits a verification-only run. Missing,
invalid, or unavailable receipts conservatively require packaging. Git commit
and tree identities remain provenance; runtime input, payload, and archive
digests serve distinct purposes. Runtime artifacts include production
dependencies and operational scripts, with certification metadata retained.
CI checks portability, the runner checks the archive digest, and the host
checks the extracted payload. Cheap preflight precedes recovery-point creation.

Local verification cannot establish Linux artifact portability or successful
Oracle activation. Those checks remain in CI and deployment. Worker compilation
and consolidation of readiness/smoke checks remain follow-up work.

Local hardening verification (2026-10-04): complete certification passed all
five commands, with 831 tests passed and one skipped across 81 files. Five
changed fixture suites outside certification passed another 42 tests. A later
workflow-only correction prevents receipt reuse across a newer failed or
incomplete deployment; the seven focused release tests passed after that change.
The local Windows bundle for `830f05a0` was 94,057,489 bytes compressed and its
extracted payload passed integrity verification. This is local evidence, not a
deployment receipt or Linux portability result.

## Invalidation rules

A new commit does not automatically invalidate every previous result. Determine
what actually changed.

- Documentation-only: documentation formatting/link checks only, except for
  machine-checked registries such as `tests/TEST_INVENTORY.md`, which needs its
  inventory integrity test.
- Formatting-only: formatter on changed files plus `git diff --check`.
- Test-only: the new/changed tests and the inventory/manifest integrity checks.
- UI logic: affected UI/domain tests; browser acceptance only if behavior changed.
- Schema/migration: migration and persistence tests plus directly affected flows.
- Auth/scope/security: the affected security boundary tests.
- Worker/deployment topology: runtime/release tests for that topology.
- Model prompt or enrichment logic: affected semantic tests and, when needed, one
  controlled provider-backed check.
- Merge with no conflicts or semantic changes: smoke verification, not a full
  second certification.

If full certification fails, do not restart the entire suite after each narrow
fix. Preserve the passing evidence, rerun the failed or invalidated stage while
iterating, and run one complete certification after all known issues are resolved.

Existing failures on the base branch are baseline debt. Diagnose them once and
separate them from feature work; do not repeatedly rediscover them on every
candidate branch.

## Pre-production deployment posture

Deployment must reflect the runtime actually being exercised. Do not provision,
start, test or require a subsystem simply because it exists in the repository.

In particular, the browser scraper is not a generic deployment prerequisite.
Chromium/Playwright is required only on a machine that will actually execute the
browser-backed scraper or its browser preflight. A web/Pursuit/dossier deployment
that does not run scraping should not install Chromium, require a scraper heartbeat,
or fail readiness because the scraper is absent.

Likewise, do not require every worker for every pre-production deployment. Use
the runtime that matches the job:

| Target                  | Expected runtime                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| Acquisition workstation | Scraper + Playwright/Chromium and scraper preflight                                        |
| Pre-production app host | Web + only the queues/workers being exercised; no scraper/browser unless explicitly needed |
| Future full production  | Explicitly designed topology with only the services that production actually runs          |

Verify the selected processes, database, migrations and user journey. Whole-fleet
topology checks belong only to a deployment that actually intends to run that fleet.

The current release tooling may contain broader historical assumptions. Do not
paper over them by installing or starting unused infrastructure. Treat a mismatch
between the real pre-production topology and a generic deployment script as a
tooling defect to simplify.

## Browser and model checks

Browser acceptance is expensive evidence and should normally run once per material
workflow version. Documentation, formatting and unrelated test-manifest changes do
not invalidate a successful browser journey.

Provider-backed model checks are also deliberate, not automatic. Deterministic
fallback tests prove fallback behavior; they do not prove provider enrichment.
When the provider path itself changes or has never been exercised for a release,
run one bounded live package and inspect invocation telemetry. Do not repeat live
calls merely because another release gate changed.

## Release closeout

Before merge, record:

1. the final release-candidate SHA;
2. which targeted/affected checks passed;
3. browser acceptance, if the workflow required it;
4. the pull request feedback result;
5. any intentionally unverified operational path.

Main CI is the authoritative certification for the merged SHA and produces the
artifact used by deployment. Do not run another local full certification after
that succeeds. Confirm deployment health and run only the operational smoke
appropriate to the release.

Security, tenant/person isolation, canonical truth, migration integrity and durable
queue correctness remain hard requirements. Pre-production changes the amount of
ceremony, not those product invariants.
