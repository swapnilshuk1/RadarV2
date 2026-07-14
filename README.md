# RADAR — Local Setup

Executive opportunity intelligence, running fully on your machine.

## Prerequisites
- Node.js 20+ (https://nodejs.org)
- npm 10+ (bundled with Node)

## Run
```bash
npm install
npm run dev
```
Then open http://localhost:8080

## Build for production
```bash
npm run build
npm run preview
```

## Project structure
- `src/routes/`      — TanStack Start file-based routes (index, scraped, opportunity/$jobHash, qa/mapping)
- `src/components/`  — UI (radar/* is the domain UI)
- `src/data/`        — candidate profile, opportunity fixtures, scraped-job feed
- `src/lib/`         — helpers (personalization, error capture, radar-lint)
- `docs/`            — scraper remediation notes

## Architectural Invariants (RADAR v2)
To keep the application highly modular, maintainable, and explainable, we enforce these design constraints:
1. **Immutability**: The public output of Layer 3 — the `RecommendationRecord` — is strictly read-only and frozen.
2. **Prose Isolation**: No internal module before the Narrative Formatter (`narrative.ts`) is allowed to write natural language sentences or prose.
3. **Decoupled UI**: React components in `src/components` and `src/routes` never import from internal engine modules (`src/lib/intelligence/*`). They must only consume the presented `Opportunity` DTOs via the orchestration repository (`OpportunityProvider`).
4. **Pure Engine**: The recommendation engine (`engine.ts`) is a pure function. It accepts candidate status inputs (like `activePursuits`) and is entirely unaware of the storage implementation (e.g. `localStorage`).
5. **Fixture Seeds**: Raw fixtures (`OpportunitySource[]` in `src/data/opportunity-fixtures.ts`) represent seed data and must never contain hardcoded recommendations or decisions.

## Notes
- All data is local fixture data. Wire the scraper (see `docs/scraper-quick-wins.md`) to replace `src/data/scraped-jobs.ts` and `src/data/opportunity-fixtures.ts`.
- The `Search` button on the shortlist currently simulates a scrape. Point it at your real scraper endpoint once ready.
- No Lovable badge or analytics run when served from `npm run dev` locally.
