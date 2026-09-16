# Staged Research production candidate

This branch contains a production-candidate staged Research engine in `src/dossier/staged-research.ts` plus a three-case frozen verification runner in `scripts/dossier/run-staged-production-research.ts`.

The legacy `buildDossier()` / monolithic `runFrozenResearch()` path remains unchanged until the frozen Schnell, Artificilux, and 2070 cases validate this implementation. This is deliberate rollback isolation, not a second shadow ontology.

The staged engine makes the application own requirement/operating-condition identities, immutable stage associations, screening-driver admissibility, canonical assembly, and final `Research` validation. The model owns role interpretation, per-requirement screening adjudication, per-requirement candidate mapping, field resolution, pursuit reasoning, and narrative planning. Screening and mapping are isolated per requirement and execute with bounded concurrency; a local repair can regenerate only the failing stage object, never accepted unrelated stages.

After the three-case runner succeeds semantically, the next code change is to wire `runStagedFrozenResearch()` into `buildDossier()` behind a reversible option, then inspect the actual three final dossiers before making it default.
