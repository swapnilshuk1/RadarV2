# Verification and release standard

RADAR is pre-production. Verification exists to catch material defects quickly,
not to turn each edit into a release ceremony. Evidence is cumulative: a check
that passed remains valid until a later change can reasonably invalidate it.

The governing rule is:

> Run the smallest set of checks that can disprove the change, then run the full
> release certification once on the final release candidate.

"Run everything again to be safe" is not an acceptable reason to repeat a gate.

## Verification levels

| Situation | Required evidence |
| --- | --- |
| Implementation edit | Tests directly covering changed behavior |
| Broader source change | `npm run certify:affected` or an equally narrow mapped set |
| Feature closeout | Feature suite plus directly coupled host/integration checks |
| Material UI/workflow change | One authenticated browser acceptance after code freezes |
| Final release candidate | One `npm run certify` invocation |
| Post-merge | Lightweight smoke unless the merge changed executable behavior |

Do not run TypeScript or the production build immediately before full
certification when certification will run the same checks again.
## Invalidation rules

A new commit does not automatically invalidate every previous result. Determine
what actually changed.

- Documentation-only: documentation formatting/link checks only.
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

| Target | Expected runtime |
| --- | --- |
| Acquisition workstation | Scraper + Playwright/Chromium and scraper preflight |
| Pre-production app host | Web + only the queues/workers being exercised; no scraper/browser unless explicitly needed |
| Future full production | Explicitly designed topology with only the services that production actually runs |

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
4. the single final certification result;
5. any intentionally unverified operational path.

After merge, do not automatically repeat certification. Run a merge-sensitive
smoke unless conflict resolution or executable changes made the previous evidence
stale.

Security, tenant/person isolation, canonical truth, migration integrity and durable
queue correctness remain hard requirements. Pre-production changes the amount of
ceremony, not those product invariants.
