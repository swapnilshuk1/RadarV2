# Secondary audit: local fixes and release state

Initial audit status: local fixes validated; no commit, push, merge, deployment, worker operation, production migration, or production database mutation was performed during that audit. Production inspection used read-only Git/process/file queries and SELECT statements. Local fixtures, test databases, build output and preview servers were used for verification. The follow-up below prepares these local fixes for a single branch commit and exact-SHA CI; it does not authorize production deployment.

## Findings and disposition

| # | Finding | Verified result and local change |
|---|---|---|
| 1 | Missing Context Intelligence | Confirmed in v6. `ProductionStagedInputAdapter.buildContextInput` now acquires context through `ProductionContextProvider`, checks source relevance using `selectRelevantContextSources`, extracts grounded claims and freezes acquisition outcomes. New semantics use `staged-v7` / `staged-decision-v7`; v6 evidence is not rewritten. |
| 2 | Empty candidate-conflict handling | Confirmed. `compareCandidateSources` compares all exactly bound candidate sources, checks returned source IDs and retains the conflict questions in the v7 snapshot. Historical v6 reconstruction fails closed for multiple sources rather than silently discarding conflicts. |
| 3 | Input fingerprint accepted for point serving | Confirmed. `SqliteOpportunityQueries.getDossier` passes the materialized evaluation fingerprint. `SqliteRichDossierStore.get` requires exact equality and no longer accepts the input alias. A regression simulates another evaluation of the same input. |
| 4 | Stale composition selection | The reported equality was already removed in `01cf0e3`. The existing selection is now shared through `selectStagedDossierWork`, with a regression proving that a valid v3.4 dossier is selected by `--publish-only` before publication and skipped after publication. |
| 5 | Invalid completed JSON accepted by persistence | Confirmed. `SqliteStagedEvaluationStore.save` now calls `parseCanonicalStagedDecisionResult` before INSERT, checks verdict/viability against the record, validates policy/contract correspondence and rejects malformed unavailable records. The TypeScript `unknown` input is treated as untrusted at this boundary. |
| 6 | No rich dossier render in certification | Confirmed. `staged-rich-serving.test.ts` now runs composition, persistence, publication, serving DTO lookup, actual `DossierView` rendering, both template switches and an evidence-dialog interaction. |
| 7 | Integrity work missing from main | Still a release blocker. Remote refs were checked: main is `77b36d0f696b40243e04edf9bd6526decfdffa9e`; rebuild is `63fd408cddee33297ebe165e58d15bef2de0c0e3`. The audit fixes remain uncommitted locally for review. |
| 8 | Runtime unverified | Read-only inventory completed. It exposes a real mismatch between the newer checkout and older compiled web app. Coverage also remains incomplete; details below. |

## Implementation references

- `src/lib/intelligence/staged/ProductionContextProvider.ts`: `ProductionContextProvider.acquire`; verified company domains are tenant-scoped. Search sends the company and role, never candidate sources. Retrieved text is retained, and field acquisition is not confused with field resolution.
- `src/lib/intelligence/staged/ProductionStagedInputAdapter.ts`: `build` validates context/profile identity; `buildContextInput` acquires and freezes sources. A completed v7 evaluation without its snapshot fails closed instead of fetching newer evidence.
- `src/data/sqlite/repositories/SqliteStagedInputStore.ts`: `get` validates model/source binding and snapshot hash; `save` retains the first snapshot and returns the persisted winner under concurrent work.
- `src/dossier/pipeline.ts`: `selectRelevantContextSources` owns semantic company/source relevance; `compareCandidateSources` owns semantic conflict identification. Returned references are checked deterministically.
- `src/lib/intelligence/staged/stagedPolicy.ts`: supported versions and policy/contract correspondence. The worker continues to dispatch v6 and v7 through the staged queue.
- `src/data/sqlite/repositories/SqliteStagedEvaluationStore.ts`: `save`, before any database INSERT.
- `src/data/sqlite/repositories/SqliteOpportunityQueries.ts`: `getDossier`; `src/data/sqlite/repositories/SqliteRichDossierStore.ts`: `get`.
- `src/lib/intelligence/staged/dossierBackfillSelection.ts`: `selectStagedDossierWork`, used by `scripts/compose-staged-dossiers.ts`.
- `scripts/dossier/preview-staged.ts`: `--file` previews a local exported dossier with no database or model call.

## Validation actually performed

- TypeScript static verification: PASS, including the final source changes.
- Focused local tests: 4 files / 31 tests PASS.
- Certification manifest: 65 files / 575 tests PASS. The exact manifest and inventory were updated to include the new regression file.
- Local production-mode Vite build: PASS. Test database mode was forced for the build; no application deployment occurred.
- `git diff --check`: PASS.
- Real persisted PURSUE and PASS dossiers were checked against their exact staged evaluation fingerprint and canonical decision trace, exported to ignored local files, then rendered on localhost. Both templates and evidence dialogs passed browser checks with no page errors. There were 47 rendered passages in the PURSUE sample and 61 in the PASS sample.

Initial verification was blocked by an approval-backend 404. After permission access was restored, checks ran. The first focused run exposed a test fixture that attempted to create two contexts with identical identity fields; the fixture was corrected to use a distinct search snapshot. The first broad run also caught the new file missing from the manifest registry and an overly broad test-environment override interfering with production-mode tests. Those were corrected; the passing counts above are from the subsequent runs.

The local browser previews are `http://127.0.0.1:4326` (PURSUE) and `http://127.0.0.1:4327` (PASS). Read-only production data and screenshots are under `.radar/local-audit-20260918/`, which is ignored by Git. Real CONSIDER coverage cannot be claimed: the inspected v6 population contains no CONSIDER result.

## Read-only production evidence

Inventory timestamp: **18 September 2026, 16:34 IST** (`2026-09-18T11:04:32.551Z`). This is a snapshot, not a live counter.

- Oracle checkout: `/home/ubuntu/radar-release-4434880`, HEAD `63fd408cddee33297ebe165e58d15bef2de0c0e3`.
- Compiled web artifact: all **144 regular files compared** matched the retained `radar-linux-77b36d0.tar.gz` archive, with no content or symlink differences. The bundle contains `dossier-v3.3`. A prior metadata-sensitive tar comparison differed; the subsequent byte comparison established the code identity.
- Web entry SHA-256: `0f746c32d9f78f7298c90f8af6fb768f9ec4662be53ee1bf81b5480f9a5f54d7`.
- Active serving context: `12bfb09a2a5d437b971972a2caae50cb27fe816b043741601e448cc613621ec8`.
- Inspected v6 context: `6b278ba4743cdaacf692e4eb24425b24743856ca6f984d73dda5e10723c41c30`.
- Eligible acquired population: 401; explicitly excluded navigation captures: 16; usable population: 385.

| Measure | Count |
|---|---:|
| `staged_completed` | 301 |
| `staged_pending` | 0 |
| `staged_processing` | 0 |
| `staged_dead_letter` | 86 |
| `staged_waiting_enrichment` | 1 |
| Completed PASS evaluations | 290 |
| Completed PURSUE evaluations | 11 |
| Completed CONSIDER evaluations | 0 |
| Separate `INPUT_UNAVAILABLE` evaluation | 1 |
| v3.4 dossiers | 79 |
| v3.4 unavailable-presentation markers | 1 |
| `STAGED_EVALUATED` projections | 79 (69 PASS / 10 PURSUE) |
| Canonical user decisions in the inspected tenant/person scope | 0 |

The 86 dead letters comprise 84 historical provider HTTP-403 failures and two source/extraction failures. The earlier evaluation canary completed. The dossier canary stopped with: `Dossier generation needs source/reasoning repair: Internal evidence identifiers belong in evidenceRefs, never visible prose`. It was not retried in this task.

A separate read-only acquisition-configuration check confirmed **Tavily is not configured** and this tenant has **zero registered company identities / verified official domains**. Deploying the new acquisition code alone would therefore record unavailable acquisition until an approved source configuration is supplied. This remains a real readiness blocker, not a passed Context Intelligence rollout.

PM2 reported the web, enrichment and evaluation daemons online; the staged backfill, rollout supervisor and dossier canary were stopped. No process was started, stopped or restarted on Oracle during this inspection.

Verified real samples:

- PURSUE: **JioStar — Associate Director - Entertainment Ad Sales, Digital, LCS**, job `e2d2f7f804e90bb3667ea45123a7df6e3991ebe31882e8da820278cdef9f11b4`.
- PASS: **LoQal AI Ventures Private Limited — Performance Marketing Executive**, job `44baf02771eb45f8e68e100362b00fd330f82e1362558598e6871f57ccfa6f58`.

## Remaining release work

The code fixes do not mean production is ready. Main and the running web artifact are still older; the backfill is incomplete; the latest dossier canary failed; the new migration and v7 evaluator have not been deployed. Actual configured context acquisition and a real v7 model evaluation have not been run. Verified company-domain coverage and/or Tavily configuration must be established before claiming real Context Intelligence coverage.

New external evidence must earn a distinct v7 evaluation and dossier; it cannot be attached retrospectively to a v6 decision. Main integration remains pending review of these local changes. Production migration, deployment, backfill recovery and serving activation require the owner's explicit approval after localhost review.

## Release-blocker follow-up: 18 September 2026, 17:05 IST

The release has five distinct proof obligations: an exact committed/pushed SHA with successful CI; real configured v7 context acquisition and evaluation; deployment of that verified artifact; convergence of the eligible cohort; and a successful newly generated dossier canary. Passing local fixture tests or rendering an existing dossier does not close the latter four obligations.

A fresh SELECT-only cohort join at `2026-09-18T11:35:07.024Z` used the same tenant, person, search plan, context, active/acquired opportunity version and `CANDIDATE` filters as `stagedRolloutReadiness`. Exclusion means an exact job/version `recovery_queue` entry with reason `SOURCE_NOT_JOB_DESCRIPTION`.

| Cohort membership | Evaluation queue state | Count |
|---|---|---:|
| Usable | `staged_completed`, completed evaluation present | 301 |
| Usable | `staged_dead_letter`, no evaluation | 84 |
| Explicitly excluded source | No evaluation queue row | 13 |
| Explicitly excluded source | `staged_dead_letter` | 2 |
| Explicitly excluded source | `staged_waiting_enrichment` | 1 |
| Total acquired cohort | | 401 |

There were zero v6 queue rows outside this cohort. Therefore `401 = 301 + 84 + 16`, and the queue total is `388 = 301 + 84 + 2 + 1`. The 13 absent queue rows are explicit exclusions, not unaccounted work. The usable population is 385, with 84 terminal queue failures still unresolved. This accounting does not retry, reclassify or remove anything. The active context was unchanged. Tavily remained unconfigured; the tenant still had zero company identities.

The failed canary ran as a source-based Node/tsx composition process, separately from the stale compiled web application. `ProductionStagedDossierService.compose` calls `composeStagedDossier`, which calls `composeDossier`; `validatePassages` in `grounding.ts` rejects evidence identifiers in passage text. The local v7 changes have not replaced that composition/validation behavior. Existing successful PURSUE/PASS preview renders therefore do **not** prove the failed canary is repaired, and the old web bundle alone does not explain its failure. The validation failure prevented publication of the invalid dossier; it is not evidence that those identifiers reached a served dossier. A fresh generation must succeed before this blocker can close.

Before preparing the branch commit, TypeScript passed and the four selected context-input, production-integration, rich-serving and Bedrock files passed 26 tests. The earlier 575-test run and build are documented above; CI must repeat its complete configured checks at the pushed SHA. The CI workflow packages Linux output and has no deployment step. This follow-up performs no Oracle write, worker operation, retry, enrichment, migration or activation.
