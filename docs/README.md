# RADAR documentation

This directory contains current guidance only.

| Document                                                               | Purpose                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Product mission](PRODUCT_MISSION.md)                                  | Executive dossier outcome and non-negotiable product requirements             |
| [Architecture](ARCHITECTURE.md)                                        | Code map, evidence, identities, semantic stages, persistence and serving      |
| [Production integration](PRODUCTION_INTEGRATION.md)                    | Current versions, script entry points and compatibility limits                |
| [Backfill runbook](operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md) | Population accounting, recovery, reviewed dossiers and activation             |
| [Deployment guide](../DEPLOYMENT.md)                                   | Local proof, exact release artifact and production verification               |
| [Repository README](../README.md)                                      | Primary workspace, setup and validation commands                              |
| [Agent instructions](../AGENTS.md)                                     | Working boundaries and required reading                                       |
| [Scraper guide](../scripts/scraper/README.md)                          | Acquisition and enrichment responsibilities                                   |
| [Dossier preview](../scripts/dossier/README.md)                        | Local rendering of an already generated dossier                               |
| [Factual review worker](operations/DOSSIER_REVIEW_WORKER.md)           | Labelled drafts, portable Gemini review, durable retry and reviewed promotion |

Current source lives in `C:\Users\swapn\Downloads\Radar V2` on `main`. Keep an
active backfill on its pinned checkout until it finishes. Source constants and
the approved target's actual state determine operational versions and counts.
Documentation and a successful build are not proof of live deployment or completed
population coverage.

Generated reports belong in `.radar/`; reusable acquisition snapshots belong in
`tests/fixtures/`. Do not add dated handoffs, experiment reports, superseded
architecture generations or copied release-count snapshots to this directory.
