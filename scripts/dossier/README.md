# Dossier development slice

Run from the repository root. Use the existing GCP project and local Google ADC
credentials. Supply original source paths; nothing in this folder embeds a CV,
an old projection, or generated dossier prose.

```powershell
node --env-file="../Radar V2/.env" --import tsx scripts/dossier/dev.ts `
  --cases "../Radar V2/audit-reports/phase5-100-case-corpus/cases.jsonl" `
  --case 02 `
  --candidate "../Radar V2/audit-reports/phase5-100-case-corpus/Swapnil_Shukla_Executive_Resume_v3.md" `
  --candidate "../Radar V2/audit-reports/phase5-100-case-corpus/Swapnil_Shukla_Resume_M.md" `
  --context https://schnellbuilder.com/ `
  --context https://schnellbuilder.com/life-at-schnell/
```

Open http://127.0.0.1:4317 and generate. Generation uses the configured model and
can take several minutes. Both CVs have equal standing; unresolved differences
are retained. The page holds the result in process memory; restarting the server
requires regeneration. This is a development page, not a production serving path.

`--context` URLs are trusted operator configuration. The website provider acquires
company-published text; it does not certify those assertions or interpret an absent
fact as negative evidence. Additional search/registry providers implement the
`ContextProvider` interface. The sample input reader whitelists `job.rawText` and
identity fields from the export. Blob retrieval and durable dossier persistence
are not connected in this first slice.

The new `src/dossier` engine does not import previous intelligence engines.
The vendor transport moved to `src/lib/model`; old callers retain a re-export.
Scraper ingestion still uses its existing knowledge builder/ingestion service,
geography resolver, scraper plan and dimension contracts. None were removed or
redirected through the new dossier engine.

Checks:

```powershell
npx vitest run tests/intelligence/dossier-grounding.test.ts
npx tsc -p tsconfig.dossier.json --noEmit
npx tsc --noEmit
npm run build:dossier
npm run build
```
