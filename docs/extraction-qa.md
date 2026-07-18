# Extraction QA Harness

Deterministic benchmark for the JD extractor pipeline. Every extractor becomes
measurable; every LLM call becomes justifiable.

## Quickstart

```bash
npm run eval:seed     # one-off — write data/golden/cases/* from fixtures
npm run eval          # run extractors over the corpus, write reports/<ts>.json
npm run eval:viewer   # open http://localhost:4321 to inspect diffs
```

The first `npm run eval` writes `data/golden/baseline.json` (Core F1). Every
subsequent run fails (exit 1) if Core F1 falls below the baseline — this is the
regression gate.

## Golden corpus

Seeded from `src/data/opportunity-fixtures.ts` (11 hand-authored cases across
BMW India, Reliance, VML, TCS, Acme, Zestlabs, Tata Digital, HUL, Flipkart,
Snapdeal, and the entry-level rejection case). Each case folder contains:

- `jd.txt` — synthesized JD text (role/company/location + every evidence quote)
- `snapshot.json` — minimal `JobSnapshot` matching the scraper schema
- `expected.json` — golden `DimensionResult[]` graded against candidate output

## Metrics

For every (case, dimension):

- **Value match** — normalized string compare against the golden value
- **Anchor validity** — every candidate evidence quote must be a substring of `rawText`
- **True positive** = candidate present + value matches + anchors valid

Aggregated by importance tier:

| Tier | Precision | Recall | F1 |
| ---- | --------- | ------ | -- |
| Core | tp / (tp+fp) | tp / (tp+fn) | 2·P·R / (P+R) |
| Supporting | … | … | … |
| Context | … | … | … |

## Enrichment policy

The extractor pipeline supports three modes via `ENRICHMENT_MODE`:

- `deterministic` — extractors only. No LLM call. Cheapest, most reproducible.
- `smart` (**default**) — LLM fills only Core dimensions still Missing after
  the deterministic pass. Provider output is marked `Inferred`, never
  `Explicit`.
- `maximum` — LLM fills any Missing Core or Supporting dimension.

The provider is pluggable via `EnrichmentProvider` (`scripts/scraper/enrich/contract.ts`).
Gemini is the default; `noopProvider` disables the LLM even when the mode
would allow it.

## Adding a case

1. Copy a snapshot from a real scrape into `data/golden/cases/<slug>/snapshot.json`.
2. Hand-label the golden `expected.json` (dimensions + evidence quotes).
3. Copy the `rawText` into `jd.txt` for the viewer.
4. Re-run `npm run eval`. New cases contribute to precision/recall immediately.

## Files

- `scripts/scraper/extract/contract.ts` — `DimensionExtractor` interface
- `scripts/scraper/extract/registry.ts` — adapter over per-dimension modules
- `scripts/scraper/enrich/{contract,policy}.ts` — provider + coverage gate
- `scripts/scraper/enrich/providers/{gemini,noop}.ts` — provider implementations
- `scripts/golden/seed-from-fixtures.ts` — corpus seeder
- `scripts/eval/{metrics,run}.ts` — harness + reporting
- `scripts/eval/viewer/{server.ts,index.html}` — diff viewer
