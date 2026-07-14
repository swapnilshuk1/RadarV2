# RADAR Live Scraper — v1

Professional-grade, resumable job scraper for **LinkedIn**, **Indeed**, and **Naukri**.

## Pipeline

```text
Acquisition  → JobSnapshot         (portal handler + persistent context)
Extraction   → ExtractionResult    (deterministic-first, LLM fallback)
Assembly     → RecommendationRecord
Persistence  → src/data/live-scraped.json  (atomic write, system-of-record)
```

Each layer writes to `.scraper-cache/` and is version-guarded so a bumped
extractor invalidates old artifacts automatically.

## Resumable Run Manager

- `.scraper-cache/runs/<runId>/manifest.json` — every work unit
  (portal × keyword × page and per-card sub-units) with status.
- `.scraper-cache/runs/<runId>/journal.ndjson` — append-only, fsync'd log.
- `.scraper-cache/runs/latest.json` — pointer for the next `resume`.

On crash / SIGINT / SIGTERM:
1. Journal is fsync'd on every event.
2. Manifest is atomically re-written on every status change.
3. Next run with `{ resume: true }` (the default from the server function)
   reopens the same run, flips `running`→`pending`, and continues.

Version bumps in `scripts/scraper/versions.ts` invalidate an in-flight
resume automatically — the manager starts a fresh run instead of mixing
schemas.

## Portals

| Portal | Login | Detail scrape | Session cache |
|---|---|---|---|
| LinkedIn | Manual (2-min gate) | `.jobs-description__content` | `.scraper-cache/profiles/linkedin` |
| Indeed | Not required, CAPTCHA-gated | `#jobDescriptionText` | `.scraper-cache/profiles/indeed` |
| Naukri | Not required | `.styles_JDC__dang-inner-html__h0K4t` etc. | `.scraper-cache/profiles/naukri` |

Portals run in parallel (`portalConcurrency=3`) and cards inside each portal
run in a bounded pool (`cardConcurrency=4`). Detail tabs are always closed
after read to avoid the Naukri tab-bloat failure mode.

## Extraction contract (see `docs/extractor-remediation.md`)

- Every `Explicit` field passes through `anchor()` — the quote must literally
  appear in `rawText` or the field is downgraded to `Missing`.
- Word-boundary regex on sentence-tokenised text; no `text.includes()` for
  concept detection.
- Disqualifier windows force `Missing` when negating phrases sit within ±12
  words of a candidate hit.
- LLM (Gemini) is invoked **only** for Core dimensions the deterministic pass
  couldn't fill, and its output is written as `Inferred` / `provenance: "llm"`
  — never `Explicit`.

## Provenance & Quality

Replaces the old numeric confidence score:

- `provenance`: `"explicit" | "inferred" | "llm"`
- `quality`: `"high" | "medium" | "low"`

Every extractor also stamps `extractorId` (`"requiredLevel@1.0.0"` etc.) so a
regression can be traced to the module that produced it.

## Running

```bash
# Requires: bun add playwright-extra puppeteer-extra-plugin-stealth
# Optional: export GEMINI_API_KEY=... to enable LLM fallback
bun run scripts/scrape.ts
```

Or trigger from the app via `triggerScrapeFn` (server function).
