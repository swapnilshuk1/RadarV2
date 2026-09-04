# RADAR Remediation Status

Baseline:
- base commit: `1f440e34f32fe06637596f5e48c2417f1bc19e19`
- branch: `remediation/00b-authoritative-test-fixtures`
- certification status: baseline typecheck passed; the certification and build runners start but this terminal integration returns before their child-process completion status. The Gate 0 integrity suites pass (16 tests); the new authorization regression fails as expected against the confirmed defect.

## Completed
- Current branch head — Gate 0 safety coverage made mandatory; added the authorization permission non-escalation regression matrix.
- Current branch head — repaired Gate 0b test fixtures so evaluated-output assertions establish candidate, opportunity, and referential prerequisites.

## Current
- remediation ID: Gate 0b — authoritative test fixtures
- branch: `remediation/00b-authoritative-test-fixtures`
- reproduction status:
  - `tests/policy/headspace-serving-contract.test.ts` — INVALID_FIXTURE. `memberships.user_id` was seeded without its required `users` row, causing a foreign-key failure before assertions.
  - `tests/intelligence/m9_4_1-evaluation-determinism.test.ts` — INVALID_FIXTURE for evaluated-output assertion: no `career_profiles.projection_json` existed for the worker's tenant/person lookup; STALE_ASSERTION for a missing-context fixture that expected the later missing-snapshot error.
  - `tests/intelligence/m53-worker.test.ts` — INVALID_FIXTURE. It asserted an evaluated `CONSIDER` while supplying no authoritative projection and only sparse job evidence.
  - `tests/security/scraper-auth-permission-non-escalation.test.ts` — PRODUCT_DEFECT. `resolveScraperAuthContext()` adds `run:scraper` and `read:credentials` to a member holding only `manage:search_plan`.

## Blocked / Requires Decision
- Gate 0 certification is intentionally red after adding the mandatory permission non-escalation regression. Fixing the resolver is Gate 1 work and is prohibited in this PR-sized Gate 0 unit.
- This terminal integration does not retain final output/exit status for nested `npm run certify` or `npm run build` child processes. An external run is required to distinguish an application hang from the runner defect.

## Deferred
- Gate 1 product remediation, including the authorization resolver fix, awaits external review of Gate 0.
