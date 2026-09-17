# Staged Research production candidate

This branch now contains a staged production **decision** candidate in `src/dossier/staged-decision.ts`, with its compact contract in `src/dossier/staged-decision-contract.ts`, prompts in `src/dossier/staged-decision-prompts.ts`, and frozen three-case verification runner in `scripts/dossier/run-staged-production-research.ts`.

The legacy `buildDossier()` / monolithic `runFrozenResearch()` path remains unchanged. The prior v2 staged Research implementation in `src/dossier/staged-research.ts` is retained as a comparison artifact, but the v3 candidate is not authorized to assemble canonical `Research` or feed `buildDossier()`.

The v3 boundary makes the application own requirement/operating-condition identities, immutable stage associations, screening-driver admissibility, screening-gap constraints, and decision-reference validation. The model owns role interpretation, per-requirement screening adjudication, per-requirement candidate mapping, field resolution, screening-gap classification, and a compact pursuit decision.

The decision model deliberately excludes `narrativePlan` and other dossier/editorial prose. Final decision reasoning consumes frozen upstream judgments and may not reopen whether candidate evidence exists or whether a requirement is a screening gate. Candidate claims supplied to the final stage are scoped to career-capital trade and decision hinges, not capability remapping.

Unresolved screening gates are classified as `PARTIAL_EVIDENCE`, `MISSING_ARTIFACT`, `MISSING_EXPERIENCE`, or `AFFIRMATIVE_CONFLICT`. The application binds those classes to an admissible screening range: substantive missing experience or affirmative conflict requires `BLOCKED`; other unresolved gates are at most `FRAGILE`; directly satisfied gates are never screening drivers. With no unresolved gate, the decision cannot degrade screening viability to `FRAGILE` or `BLOCKED`.

A one-shot Schnell P&L/readiness screening differential is provided in `scripts/dossier/run-schnell-pnl-screening-differential.ts` to compare GLM 5 and Kimi K2.5 on the exact requirement missed in v2. This is a surgical semantic check, not a new benchmark.

After Schnell, Artificilux, and 2070 produce semantically credible v3 decision models, narrative/composition can be designed as a separate downstream consumer. Only after that boundary is validated should the staged path be adapted back into canonical `Research` and wired into `buildDossier()`.
