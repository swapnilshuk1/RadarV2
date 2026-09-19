# Dossier preview

Run from the repository root to render an already generated dossier locally:

```text
npm run dev:dossier -- --file=<path-to-dossier.json>
```

`--dto` accepts an evaluated serving DTO containing `richDossier` instead of a
bare dossier. `--port=<number>` changes the default port 4318. The preview binds
to `127.0.0.1`, renders the single Template B executive memo and makes no model calls.
File mode does not open a database. `--directory=.radar/memo-proof` lists the completed
`*-dossier.json` files from the bounded local proof and lets you select one.

For database mode, explicitly configure an isolated local database and supply
`--context=<fingerprint> --job=<canonicalJobId>`. This is a developer preview;
production serving uses authorized scope resolution and the active context.

Generation uses `scripts/compose-staged-dossiers.ts` and the production staged
services, including canonical decision validation, frozen inputs, durable
checkpoints and factual review. There is no separate one-shot developer
evaluation/composition engine.

See the [architecture](../../docs/ARCHITECTURE.md) and
[integration guide](../../docs/PRODUCTION_INTEGRATION.md).

Use `validate-memo.ts` for at most three real examples on a private SQLite copy.
It calls the production composer and reviewer, persists the memo, checks the exact
serving DTO and retains checkpoints. See the [first scrape runbook](../../docs/operations/CONTEXT_REEVALUATION_DOSSIER_RUNBOOK.md).
