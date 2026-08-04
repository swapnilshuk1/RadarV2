# AGENTS.md — RADAR v2 Architectural Blueprint & Agent Guidelines

This document provides context, domain model guidelines, architectural invariants, maturity classifications, and key operational procedures for all AI coding agents working on RADAR v2.

---

## 1. System Purpose & Domain Scope
**RADAR v2** is an Executive Job Intelligence Radar and Qualification Engine.
- **Target Persona**: High-tier executives (VP, Director, CXO).
- **Core Value**: Scrapes, normalizes, evaluates, and ranks executive job opportunities across multiple portals (LinkedIn, Naukri, Workday, SmartRecruiters, Greenhouse, Lever).
- **Key Modules**:
  1. Multi-portal Scraping Pipeline (Playwright + Stealth Plugin).
  2. Evidence & Fact Extraction Engine.
  3. Deterministic Scorer & Reasoning Chain.
  4. Executive Headspace / Decision Interface (Pursue, Consider, Pass).

---

## 2. Core Tech Stack
- **Framework**: TanStack Start / TanStack Router (SSR + Hydration), Vite, Nitro engine.
- **Database**: Dual local/remote SQLite via `@libsql/client` (Turso) & `better-sqlite3`.
- **Database Abstraction**: `DatabaseAdapter` interface (`one`, `many`, `execute`, `transaction`).
- **Web Scraping**: Playwright Extra with `puppeteer-extra-plugin-stealth`.
- **Styling**: Vanilla CSS tokens, modern dark mode glassmorphism, responsive components.

---

## 3. Dependency Direction & Layering Rules

```
UI Routes & Views (src/routes/)
        │
        ▼
Server Functions (@tanstack/react-start createServerFn)
        │
        ▼
Domain Services (OpportunityService, Scorer, etc.)
        │
        ▼
Repositories (src/data/sqlite/repositories/ via StorageProvider)
        │
        ▼
DatabaseAdapter (src/data/database/)
        │
        ▼
SQLite Engine (better-sqlite3 / Turso @libsql/client)
```

### Invariants:
1. **Strict Downward Dependencies**: Dependencies MUST always point downward. Higher-level layers may call lower-level layers, never the reverse.
2. **UI Isolation**: Repositories, domain entities, and server services MUST NOT import UI components or client state hooks.
3. **No Raw SQL in UI/Services**: UI routes and domain services MUST NOT execute raw SQL queries; all data access must pass through repository methods on `StorageProvider`.
4. **Pure DatabaseAdapter**: `DatabaseAdapter` implementations must strictly handle query execution and parameter binding—never embed domain business logic.

---

## 4. Subsystem Maturity Matrix (Stable vs. In Evolution)

To balance system stability with rapid iteration, agents must distinguish between stable core infrastructure and evolving domain features:

| Subsystem / Layer | Maturity | Guidance for AI Agents |
| :--- | :--- | :--- |
| **`DatabaseAdapter` & Persistence** | 🟢 **STABLE** | Sole source of state. Never alter interface without explicit instruction. Never introduce parallel storage files (`.json`, `.txt`). |
| **Migrations & Core Schema** | 🟢 **STABLE** | Always use incremental migrations (`001_`, `002_`, etc.). Never rewrite historical SQL migrations. |
| **Repository Contracts (`StorageProvider`)** | 🟢 **STABLE** | Extend existing repositories in `src/data/sqlite/repositories/`. Do not bypass repositories with raw inline queries in UI routes. |
| **Executive Decision Persistence** | 🟢 **STABLE** | Server functions (`decisions-server.ts`) + client hook (`decisions-store.ts`) sync directly with Turso/SQLite. Keep fast optimistic UI updates intact. |
| **SSR / Routing Framework** | 🟢 **STABLE** | TanStack Start & Router file routes in `src/routes/`. Preserve route contracts and SSR server function conventions. |
| **Scraper Portals & Stealth Manager** | 🟡 **IN EVOLUTION** | Portal selectors, HTTP fallbacks, and anti-bot stealth logic adapt continuously to target portal layout changes. |
| **Qualification & Policy Engine** | 🟡 **IN EVOLUTION** | Scoring weights, evidence matchers, and policy calibration routines (`scripts/run-policy-calibration.ts`) iterate based on benchmark tests. |
| **Executive UI & Headspace Views** | 🟡 **IN EVOLUTION** | UI dashboards, card layouts, and filtering controls refine user experience. Keep components focused, responsive, and visually clean. |

---

## 5. Engineering Principles & Anti-Overengineering Rules

To maintain a lean, high-performing codebase without unnecessary complexity:

0. **ABSOLUTE FIRST COMMANDMENT (NO BANDAID WORKAROUNDS)**: NEVER offer temporary workarounds, alternative menus, or bypasses when an underlying system failure or connection issue occurs. ALWAYS investigate the exact root cause, diagnose the underlying logs and configuration, and resolve the primary issue directly.
1. **Extend Existing Abstractions First**: Before creating a new service, helper, or class, search the codebase. Extend existing repositories (`StorageProvider`) and services rather than writing duplicate or parallel infrastructure.
2. **Single Source of Persistence**: All persistent domain state (opportunities, companies, documents, user decisions) MUST use `DatabaseAdapter` (Turso/SQLite). NEVER introduce parallel file-based storage (`.json` or `.txt`) for persistent user state.
3. **Ephemeral Cloud Safe**: Assume production runs on ephemeral cloud containers (e.g. Render, Vercel). NEVER write mutable application data to local container filesystems.
4. **Minimal Viable Abstraction**: Write straightforward, explicit TypeScript functions and SQL queries. Avoid speculative abstractions, unnecessary wrapper classes, or deep inheritance hierarchies.
5. **Preserve Compatibility & Comments**: Do not remove existing docstrings, TypeScript types, or architecture comments unless explicitly instructed.
6. **Continuous Build Verification**: Every architectural or domain change must be validated with `npx tsc --noEmit` and `npm run build` before declaring completion.

---

## 6. Directory Layout

```
radar-local-v2/
├── AGENTS.md                          # Mandatory agent guidelines and system architecture
├── radar.sqlite                       # Primary SQLite database file
├── src/
│   ├── data/                          # Data layer: SQLite providers, schemas, migrations
│   │   ├── database/                  # DatabaseAdapter interface & LibSQL/Turso implementation
│   │   └── sqlite/                    # Migration SQL files and repository stores
│   │       ├── migrations/            # Auto-applied SQL migration scripts (001-005+)
│   │       └── repositories/          # Concrete Sqlite repository implementations
│   ├── domain/                        # Domain entities & repository interfaces
│   │   ├── entities.ts                # Primary TypeScript entity definitions
│   │   └── repositories.ts            # Repository contracts (StorageProvider)
│   ├── lib/                           # Domain services, state hooks, and server functions
│   │   ├── decisions-store.ts         # React decision state hook (optimistic UI + server sync)
│   │   ├── intelligence/              # Server-side functions (@tanstack/react-start)
│   │   │   ├── decisions-server.ts    # Decision persistence server functions
│   │   │   └── scrape-server.ts       # Scraper control server functions
│   │   └── recommendation/            # Scoring & Qualification engine
│   └── routes/                        # TanStack Router page views & endpoints
├── scripts/                           # CLI tools, scrapers, and qualification harness
│   ├── scrape.ts                      # Live multi-portal scraper runner
│   └── scraper/                       # Scraper architecture (portals, manager, stealth)
└── docs/                              # Architecture Decision Records (ADRs)
```

---

## 7. Database Schema & Adapter Architecture

The application abstracts database access using `DatabaseAdapter`:

```ts
export type QueryParams = readonly unknown[];

export interface DatabaseAdapter {
  one<T>(sql: string, params?: QueryParams): Promise<T | null>;
  many<T>(sql: string, params?: QueryParams): Promise<T[]>;
  execute(sql: string, params?: QueryParams): Promise<{ rowsAffected: number; lastInsertRowid?: number | bigint | string }>;
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T>;
}
```

### Core Schema Tables
- `opportunities`: Core job opportunities (`id`, `canonical_title`, `location`, `company_id`, `created_at`).
- `companies`: Target companies (`id`, `name`, `domain`, `industry`).
- `documents`: Raw JD text and scraped payloads (`id`, `opportunity_id`, `content`, `payload_type`).
- `decisions`: User executive choices (`id`, `person_id`, `opportunity_id`, `action`, `reason`, `updated_at`).
  - **Constraint**: `UNIQUE(person_id, opportunity_id)` enabling clean `UPSERT` operations.
- `people` & `candidate_profiles`: User identity, career profiles, and resume versions.

---

## 8. Repository Responsibilities (`StorageProvider`)

All storage access is accessed via `getRepositories()` in `src/data/sqlite/provider.ts`:

- `sources`: Tracks data sources (portals, search terms).
- `companies`: Registers and queries target companies.
- `opportunities`: Ingests, updates, and queries active job postings.
- `acquisition`: Stores raw document payloads and search discovery logs.
- `knowledge`: Manages extracted evidence and fact nodes.
- `reasoning`: Manages claims, match scores, and reasoning chains.
- `people`: Manages user career memory and candidate profiles.
- `decisions`: Manages user decision choices (`recordUserDecision`, `getUserDecisions`, `deleteUserDecision`, `clearUserDecisions`).

---

## 9. Scraper Pipeline Architecture

The scraping pipeline uses a stealth Playwright engine managed by `RunController` (`scripts/scraper/run/manager.ts`).

### Portal Scraper Rules (`scripts/scraper/portals/*`)
- **Stealth Initialization**: `getPortalContext()` in `base.ts` handles stealth plugin injection and automatic cloud/Render environment detection.
- **State Machine Transitions**:
  `initializing` ➔ `running` ➔ `enriching` ➔ `completed` (or `failed`).
- **Cloud Flags**: When running in cloud containers, scrapers inject `--no-sandbox`, `--disable-gpu`, `--disable-setuid-sandbox` and set `headless: true`.
- **Session Management**: Public job search pages are prioritized to prevent login locks. For authenticated portals, session cookies are restored from local state.

---

## 10. Evaluation & Qualification Pipeline

The recommendation engine (`DeterministicScorer.ts` & `OpportunityService.ts`) calculates fit based on multi-dimensional executive dimensions:
1. **Scope & Scale**: Seniority level, P&L responsibility, team size.
2. **Domain Fit**: Marketing, Growth, Digital Transformation, Commercial leadership.
3. **Strategic Alignment**: Company trajectory, market position, location preferences.

Qualification scores are saved in the `assessments` and `recommendations` tables in SQLite/Turso.

---

## 11. Executive Decision Lifecycle

When a user swipes or makes a decision on an opportunity:
1. **UI Layer (`decisions-store.ts`)**: `useDecisions()` performs an immediate optimistic UI update and writes to `localStorage` cache.
2. **Server Sync (`decisions-server.ts`)**: Invokes `saveDecisionFn()` via TanStack `createServerFn`.
3. **Database Layer (`SqliteDecisionSupportStore.ts`)**: Executes `INSERT INTO decisions (...) ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=CURRENT_TIMESTAMP`.
4. **Hydration & Migration**: On fresh device login or Render deployment, `useDecisions()` fetches canonical decisions directly from Turso/SQLite and merges any un-synced local decisions.

---

## 12. Development & Verification Commands

```bash
# Type check TypeScript code
npx tsc --noEmit

# Build production bundle (SSR + Nitro)
npm run build

# Run Executive Qualification Harness (EQE)
npm run test:eqe

# Run Live Scraper Pipeline locally
npx tsx scripts/scrape.ts

# Audit Database Lineage & Health
npx tsx scripts/audit-lineage.ts
```
