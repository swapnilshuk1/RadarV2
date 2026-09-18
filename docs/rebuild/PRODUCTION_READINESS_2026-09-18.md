# Production-readiness pass — 18 September 2026

## Release decision

**HOLD production rollout.** This pass produces a coherent v7 release candidate and real local vertical evidence. It does not authorize a claim that production is ready. Broad context acquisition remains unconfigured, and inspection found factual overstatements in otherwise structurally valid dossiers. No Oracle process, production database, enrichment queue, evaluation queue, or active serving pointer was changed by this pass.

The product owner's instruction authorizes production preparation and activation after clean local and rollout evidence. That condition has not been met. This is a technical/configuration hold, not a request for another routine approval.

## Architecture delivered

The preceding `55d8eea` commit supplies the six requested architecture changes: first-class production context acquisition; comparison of exactly bound candidate sources; exact evaluation-fingerprint dossier retrieval; shared composition/publication selection; canonical staged validation before persistence; and composition through persistence, publication, serving DTO and interactive `DossierView` certification.

This commit closes defects exposed by real vertical execution:

- `ProductionStagedEvaluationService.evaluate` selects the v7 decision path. `runStagedFrozenDecisionDetailed` now supplies the candidate claims referenced by career-capital judgments to final reasoning. The v7 instruction defines pursuit actions separately from screening viability. The v6 decision request and instruction remain unchanged.
- `validateStagedCareerCapital` provides all detected reference/axis defects together during v7 local repair, including the exact arrays that must be empty on a non-material axis. It neither changes the model's materiality judgment nor accepts invalid references. Historical validation remains fail-fast.
- `validateClaims` and `validatePassages` accept grounded candidate-plus-company-context comparisons as inferred relational analysis. Candidate achievements still require candidate evidence; context cannot become a candidate fact.
- `extractValidatedSourceClaims` accepts an empty result from an uninformative CONTEXT page. Empty JD/candidate evidence still fails. A retrieved page need not be pressured into producing claims.
- Composition repair asks for the schema of the current call, rather than demanding unrelated resolution fields. `reviewStagedEditorialAction` receives only the immutable pursuit action and current prose, preventing the editorial reviewer from re-adjudicating screening or career capital. Uppercase action labels belong in the application's verdict display, not competing labels inside the thesis/recommendation.
- Presentation semantics use `dossier-v3.5`; historical v3.4 rows are retained. Evaluation semantics remain the unreleased `staged-v7` / `staged-decision-v7` candidate, separate from production v6.

`scripts/dossier/validate-staged-readiness.ts` operates only on an explicitly created SQLite database under `.radar/`. It never opens a production adapter. It imports exact source/profile/job bindings, runs the real production services, publishes locally and resolves the real serving DTO. `preview-staged.ts --dto --file=...` renders an exported DTO without opening a database or calling a model.

## Real validation and provenance

One capability probe succeeded before generation. Real validation used Bedrock Converse `zai.glm-5`, the exact reconciled profile `projection-8acff2997f98e0d6418d8b01c5244128a6b9d6aa61232a5e791afd6210fea8e4`, and six production job/version bindings copied using SELECT-only exports. No latest-profile fallback was used.

Local v7 context: `b1be87d811740cc55edec6a26a33f86e84f6616f30b6f80131cb74de3269da26`.

| Company | Canonical job prefix | Final evaluation | Screening | Acquired context claims |
|---|---|---|---|---:|
| WPP Media | `41b2566124ad` | PURSUE | STRONG | 22 |
| JioStar | `e2d2f7f804e9` | CONSIDER | FRAGILE | 46 |
| Artificilux | `1f1904c58f28` | CONSIDER | STRONG | 0 |
| 2070 Health | `b4a8bc7406dc` | PASS | BLOCKED | 91 |
| Schnell Builders | `cc312ec056c8` | PASS | BLOCKED | 35 |
| Ericsson | `44d233205afa` | PASS | BLOCKED | 0 |

Official company retrieval was proven for WPP Media, JioStar, 2070 Health and Schnell. Their verified domains were registered only in the local copies. Ericsson and Artificilux retain explicit unavailable acquisition. All six use one authoritative candidate source; multi-source conflict behavior is covered by focused fixtures, not claimed as a real multi-document cohort result.

These are retained iterations, not a six-case first-pass-success claim. The first local run exposed missing candidate claims at final reasoning, an overreaching editorial reviewer, a non-material compensation reference that exhausted repair, and a Bedrock network failure during Schnell composition. A local-export omission of authentication/context rows was also corrected in a separate copy. Final presentation runs reused completed immutable evaluations; Ericsson required a new evaluation after its failed attempt. No failed artifacts or prior evaluation records were erased. Verdict differences between separately generated runs are not a controlled causal estimate of the effect of context.

Private evidence is under `.radar/v7-readiness-20260918/`: exact production input exports, probe result, verified domains, frozen inputs, timestamped model calls/failures, local databases, evaluations, DTOs, dossiers, browser text and screenshots. `candidate-2` retains the earlier outcomes; `final-validation` retains the final assembled local cohort. These files contain candidate/source data and are intentionally not committed.

The final isolated database reached **6 completed evaluations, 6 rich dossiers and 6 publications; `unprepared=0`, `pending=0`, exclusions=0**. Its coverage function reports ready. This establishes local pipeline convergence only: the semantic findings below still prevent release, and these six rows are not the production population.

## Verification

Focused checks passed **5 files / 66 tests**, covering staged decisions, composition, grounding, context input and rich serving. The DTO render test exercises both layouts and an evidence dialog. TypeScript verification and `git diff --check` passed during implementation. A stale scripted-review fixture was corrected to recognize the typed review input rather than a prompt sentence.

All six real serving DTOs also rendered in the actual localhost `DossierView`: both templates, an evidence-dialog quote, no browser page errors, and no internal evidence IDs in visible passage text. Screenshots and rendered text were retained. This browser pass verifies presentation/integration; it does not override the semantic review findings.

The complete certification is run once by `.github/workflows/ci.yml` at this commit: TypeScript, production build, certification manifest and a retained Linux `.output` artifact named `radar-linux-output-<SHA>`. The exact Actions result and artifact, not this document, establish whether those checks passed. No deployment is performed by that workflow.

## Semantic review remains open

Mechanical validity and rendered richness do not prove every factual statement. The review found examples that must not be concealed by the passing structural checks:

- The 2070 Health career-capital paragraph says **“40 direct reports”**. The bound candidate claim establishes recruiting/managing a **40-member cross-functional Center of Excellence**, not 40 direct reporting relationships. Citation existence did not prevent this precision inflation.
- The final Artificilux thesis compares its pay with **“senior leadership benchmarks”**, although no supplied market-pay evidence supports that comparison. Its source salary can be stated; the external benchmark cannot be presented as established.
- The final Schnell career-capital paragraph says **“a marketing leader without property-sales background”**. The sources do not evidence the required property-sales history; that is not proof that the candidate has no such background. The existing structural/wording checks did not catch this construction.
- The WPP thesis describes an authority reduction from title/reporting differences while the role's actual team scale remains unspecified. Some career-tradeoff language is stronger than the evidence warrants. This needs evidence-bounded interpretation, not a deterministic title classifier.
- 2070's studio-level funding and organizational evidence must remain distinguishable from the particular portfolio/platform hiring mandate. Retrieved company context is real, but the entity/scope implications require review before broad activation.
- Existing broad missing-evidence prose checks also rejected some statements about employers or other applicants as if they asserted candidate absence. Bounded repair recovered examples, but unnecessary repairs remain a throughput concern. This pass does not add more English classifiers to hide it.

The earlier JioStar CONSIDER thesis's conflicting uppercase “PASS” wording is the concrete reason for the new editorial action-label rule and its regression test. The rule does not alter canonical verdicts.

## Production baseline and remaining rollout conditions

The latest production population inventory in this pass was SELECT-only at `2026-09-18T11:35:07.024Z`; it is a timestamped baseline, not a current convergence claim:

`401 acquired = 301 completed + 84 usable dead-letter jobs + 16 explicit invalid-source exclusions`.

The 388 queue rows were 301 completed, 86 dead letters and one waiting row. Two dead letters and the waiting row belong to the 16 exclusions; the other 13 exclusions have no evaluation queue row. There were no v6 rows outside the cohort. Thus the earlier apparent missing population was explained without reclassification or deletion. There were 79 v3.4 dossiers/publications.

Production's compiled web artifact was byte-matched to the old `77b36d0` artifact and still used dossier-v3.3; the newer source checkout was not proof of a newer deployed web bundle. See `SECONDARY_AUDIT_2026-09-18.md` for that read-only evidence.

Tavily is not configured locally; the last read-only production inspection also found no Tavily configuration and zero verified company identities. The local four-domain demonstration does not establish population-wide context acquisition. A search key location/configuration or verified company-domain coverage is still needed; secrets must not be placed in reports or chat.

Only after configuration and semantic review are clean should the verified artifact be deployed, enrichment dependencies recovered, a distinct v7 cohort evaluated, v3.5 dossiers composed and `STAGED_EVALUATED` publications produced. Production readiness must independently reach `unprepared=0`, `pending=0` with legitimate exclusions. Then verify the deployed SHA, live dossiers and all counts before `activateReadyStagedRollout` switches the pointer.

The preserved rollback pointer is `12bfb09a2a5d437b971972a2caae50cb27fe816b043741601e448cc613621ec8`. It was not changed. Main integration, production convergence, deployment verification and activation remain incomplete; the local cohort must not be reported as the production population.
