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
- **Database**: Cloud LibSQL via `@libsql/client` (Turso Cloud) — sole source of truth for opportunities, profiles, and decisions. In-memory SQLite (`:memory:`) reserved strictly for fast unit tests.
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
DatabaseAdapter (src/data/database/ via getDatabaseAdapter())
        │
        ▼
Turso Cloud Engine (@libsql/client) [In-Memory SQLite solely for unit tests]
```

### Invariants:
1. **Strict Downward Dependencies**: Dependencies MUST always point downward. Higher-level layers may call lower-level layers, never the reverse.
2. **UI Isolation**: Repositories, domain entities, and server services MUST NOT import UI components or client state hooks.
3. **No Raw SQL in UI/Services**: UI routes and domain services MUST NOT execute raw SQL queries; all data access must pass through repository methods on `StorageProvider`.
4. **Pure DatabaseAdapter**: `DatabaseAdapter` implementations must strictly handle query execution and parameter binding—never embed domain business logic.
5. **Canonical Database Invariant**: Turso Cloud is the ONLY production/development database (containing 2,231 screened opportunities, user career profiles, and decisions). Local `radar.sqlite` is permanently disabled and eliminated. All scripts and queries MUST call `getDatabaseAdapter()`.

---

## 4. Subsystem Maturity Matrix (Stable vs. In Evolution)

To balance system stability with rapid iteration, agents must distinguish between stable core infrastructure and evolving domain features:

| Subsystem / Layer | Maturity | Guidance for AI Agents |
| :--- | :--- | :--- |
| **`DatabaseAdapter` & Persistence** | 🟢 **STABLE** | Sole source of state (Turso Cloud). Never alter interface without explicit instruction. Never introduce parallel storage files (`.json`, `.txt`, `.sqlite`). |
| **Migrations & Core Schema** | 🟢 **STABLE** | Always use incremental migrations (`001_`, `002_`, etc.). Never rewrite historical SQL migrations. |
| **Repository Contracts (`StorageProvider`)** | 🟢 **STABLE** | Extend existing repositories in `src/data/sqlite/repositories/`. Do not bypass repositories with raw inline queries in UI routes. |
| **Executive Decision Persistence** | 🟢 **STABLE** | Server functions (`decisions-server.ts`) + client hook (`decisions-store.ts`) sync directly with Turso Cloud. Keep fast optimistic UI updates intact. |
| **SSR / Routing Framework** | 🟢 **STABLE** | TanStack Start & Router file routes in `src/routes/`. Preserve route contracts and SSR server function conventions. |
| **Scraper Portals & Stealth Manager** | 🟡 **IN EVOLUTION** | Portal selectors, HTTP fallbacks, and anti-bot stealth logic adapt continuously to target portal layout changes. |
| **Qualification & Policy Engine** | 🟡 **IN EVOLUTION** | Scoring weights, evidence matchers, and policy calibration routines (`scripts/run-policy-calibration.ts`) iterate based on benchmark tests. |
| **Executive UI & Headspace Views** | 🟡 **IN EVOLUTION** | UI dashboards, card layouts, and filtering controls refine user experience. Keep components focused, responsive, and visually clean. |

---

## 5. Engineering Principles & Anti-Overengineering Rules

To maintain a lean, high-performing codebase without unnecessary complexity:

0. **ABSOLUTE FIRST COMMANDMENT (NO BANDAID WORKAROUNDS & SYMPTOM SILENCING)**: NEVER offer temporary workarounds, defensive null/empty fallbacks, or bypasses when an underlying system failure or formatting/character constraint warning occurs. A warning or limit is a diagnostic signal of an upstream ontology mismatch. You MUST trace the data lineage upstream and resolve the issue directly at its source (the EKB/Knowledge layer) via semantic normalization, never via local string-cleanup or truncation filters in the editorial/presentation layers.
1. **Extend Existing Abstractions First**: Before creating a new service, helper, or class, search the codebase. Extend existing repositories (`StorageProvider`) and services rather than writing duplicate or parallel infrastructure.
2. **Single Source of Persistence**: All persistent domain state (opportunities, companies, documents, user decisions) MUST use `DatabaseAdapter` (Turso Cloud). NEVER introduce parallel file-based storage (`.json`, `.txt`, or `.sqlite`) for persistent user state.
3. **Ephemeral Cloud Safe**: Assume production runs on ephemeral cloud containers (e.g. Render, Vercel). NEVER write mutable application data to local container filesystems.
4. **Minimal Viable Abstraction**: Write straightforward, explicit TypeScript functions and SQL queries. Avoid speculative abstractions, unnecessary wrapper classes, or deep inheritance hierarchies.
5. **Preserve Compatibility & Comments**: Do not remove existing docstrings, TypeScript types, or architecture comments unless explicitly instructed.
6. **Continuous Build Verification**: Every architectural or domain change must be validated with `npx tsc --noEmit` and `npm run build` before declaring completion.

---

## 6. Directory Layout

```
radar-local-v2/
├── AGENTS.md                          # Mandatory agent guidelines and system architecture
├── DEPLOYMENT.md                      # Oracle Cloud server & Git push deployment protocol
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

## 12. Continuous Certification Gate & Development Commands

RADAR v2 enforces a single, authoritative continuous certification workflow:
```
Code Change ──► Affected Contracts ──► npm run certify ──► Deploy ──► npm run smoke
```

### Invariant-First Contributor Protocol (Mandatory for all AI Agents):
Whenever touching, modifying, or writing tests:
1. **Identify the Invariant**: State what system behavior, data relationship, security boundary, or UI contract is being verified.
2. **Check for Authoritative Home**: Inspect `tests/TEST_INVENTORY.md` to locate the canonical domain suite.
3. **If Unique and Valid**: Keep and modernize the test in its proper canonical domain.
4. **If Duplicate**: Consolidate into the authoritative suite rather than proliferating milestone-numbered files (`mXX`, `pXX`, `phaseXX`).
5. **If Obsolete**: Archive to `tests/archive/` with explicit written justification.
6. **Continuous Certification Gate**: Ensure `npm run certify` and `npm run smoke` pass cleanly before declaring completion.

```bash
# 1. Authoritative Continuous Certification Gate (TypeScript + 7 Deterministic Stages)
npm run certify

# 2. Production Post-Deployment Smoke Check (Live Turso Health & Feed Parity)
npm run smoke

# 3. Unified System Diagnostic Inspection
npm run diagnose

# 4. Type check TypeScript code
npx tsc --noEmit

# 5. Build production bundle (SSR + Nitro)
npm run build
```

---

## 13. Executive Advisory Design Constitution & Component Invariants

All AI coding agents MUST strictly follow these UI & component architectural invariants:

### A. Golden Rule of Component Restraint & Constitutional Dependency
> **NEVER invent a new UI component if an existing editorial component can express the information.**
>
> **Constitutional Dependency**: All executive prose MUST originate from the Editorial Repository (`src/lib/intelligence/editorial/`). Components may NEVER author ad-hoc executive language outside registered editorial patterns.

### B. Component Hierarchy Architecture
Every view in RADAR v2 MUST adhere to the 5-tier structural hierarchy:
```
Page (e.g. Executive Dossier, Shortlist Queue)
  └── Chapter (e.g. Executive Brief, Proof Chain)
        └── Section (e.g. Mandate Overlap, Watch For)
              └── Component (e.g. Recommendation Panel, Proceed Block)
                    └── Primitive (e.g. Label, Badge, Divider)
```

### C. Editorial Invariants (Version 2.1 Standard)
1. **Evidence-Grounded Truth**: Never claim evidence, reporting lines, P&L scale, or founder proximity that is not explicitly verified by the evidence graph or job projections.
2. **Certainty Matched to Confidence**: Editorial confidence tracks assessment confidence exactly. Superlatives require benchmark data.
3. **Advice Over Description**: Frame insights as a trusted executive partner would ("Proceed this week; validate reporting line on initial call").
4. **Document-Level Coherence**: Every pattern tells a unified story across headline, opening, bridge, and closing.
5. **Frozen Navigation Landmarks**: Structural section headers (`EXECUTIVE BRIEF`, `STRATEGIC CAREER VALUE`, `THE CASE`, `THE ROLE`, `YOUR ADVANTAGE`, `OPEN QUESTIONS`, `DECISION BOUNDARIES`, `SUPPORTING EVIDENCE`, `DOSSIER LEDGER`) are permanent UI landmarks and must **never** be altered.
6. **Name the Consequence**: Every brief states what changes if the reader acts, and what is forfeited if they do not.
7. **One Concrete Anchor Per Brief**: At least one number, named function, counterparty, or dated event must appear in the composed narrative.
8. **Risk in the First Clause**: State material risk before qualifying it in pause-if lines.
9. **No Two Patterns Share a Skeleton**: Sentence architecture is part of the voice. Registered patterns must declare one of 4 Headline Skeletons (`fact-first`, `comparison-first`, `consequence-first`, `observation-first`), with a maximum 40% distribution cap across any single session.

### D. Visual System & Color Jobs
1. **One Idea Per Screen**: Each viewport section conveys a single advisory statement or proof point.
2. **Evidence Before Recommendation**: Claims and score cards must precede executive verdict controls.
3. **Whitespace Communicates Confidence**: Spacing is calibrated using semantic tokens (`space-1` to `space-7`).
4. **Typography Carries Hierarchy, Not Decoration**: `font-serif` (Instrument Serif) for editorial headlines, `font-sans` (Manrope) for body copy, and `font-mono` (JetBrains Mono) for quantitative metadata.
5. **Every Component Answers an Executive Question**: Components must state purpose (*Proceed If*, *Pause If*, *Watch For*).
6. **Color Indicates Judgement—Not Branding**:
   - 🟢 **Green (`--signal`)**: *Confidence* (High match alignment)
   - 🟡 **Amber (`--caution`)**: *Unknown* (Friction / Verification required)
   - 🔴 **Red / Neutral (`--pass`)**: *Contradiction* (Strategic divergence)
   - ⚪ **Grey (`--muted`)**: *Evidence* (Fact provenance & metadata)
   - ⚫ **Black (`--foreground`)**: *Action* (Primary user decision triggers)

### D. Paper Surface & Elevation Philosophy
- Components exist as sheets of paper. Separation is achieved strictly through rhythm, spacing (`space-1` to `space-7`), typography hierarchy, and subtle ruled hairlines—NEVER heavy drop shadows or floating SaaS cards.

### E. Motion Restraint Protocol
- *Motion never entertains. Motion only explains. Motion is always interruptible. Motion never blocks reading.*
- Standard transitions: `fade-in` (150ms), `expand-drawer` (200ms ease-out). No spring bounces, flips, or sliding animations.

### F. Data Formatting Standards
- **Currency**: `₹2.4 Cr` or `$250K` (Never raw unformatted integers like `24000000`).
- **Dates**: `06 Aug 2026` (DD MMM YYYY).
- **Percentages**: `94% fit overlap`.
- **Confidence**: `High (Verified provenance)`.
- **Locations**: `Bengaluru (Hybrid)` or `San Francisco, CA`.

### G. Strict Design System & Token Discipline Invariant
> **ABSOLUTE PROHIBITION OF AD-HOC INLINE TAILWIND MAGIC VALUES**
1. **No Magic Pixel Dimensions or Arbitrary Offsets**: NEVER write ad-hoc arbitrary Tailwind values in JSX such as `text-[11px]`, `text-[10px]`, `max-w-[1180px]`, or `p-[3px]`.
2. **No Arbitrary Opacity Hacks**: NEVER write ad-hoc opacity modifiers like `border-border/60`, `border-border/40`, `border-primary/30`, `bg-surface-raised/40`, or `text-foreground/90`. Always use established semantic CSS tokens (`var(--border)`, `var(--border-strong)`, `var(--surface-raised)`).
3. **Mandatory Use of Registered Design System Classes**: All UI views MUST use centralized design utility classes defined in `src/styles.css`:
   - `.memo-container` (Centralized 1180px container with responsive `space-y-12`)
   - `.memo-card` (`border border-border bg-surface-raised p-5 rounded-md`)
   - `.memo-callout` (`border-l-2 border-primary bg-surface-raised p-4`)
   - `.memo-opinion-box` (`border-2 border-primary/30 bg-surface-raised p-6 my-6 rounded-lg`)
   - `.label-mono` / `.memo-badge` (`font-mono uppercase tracking-[0.18em] text-[0.65rem]`)
4. **Audit First Rule**: Before writing or modifying any UI route/component, agents MUST inspect `src/styles.css` to verify available design system classes and enforce 100% token reuse.

---

## 14. Canonical Git Push & Oracle Server Deployment Protocol

Whenever deploying or pushing RADAR v2 to the live Oracle Cloud Server, AI agents MUST follow this exact, deterministic procedure without searching or guessing credentials:

### Target Infrastructure & Credentials:
- **Server IP**: `130.210.41.232` (or hostname `130.210.41.232.sslip.io`)
- **SSH User**: `ubuntu`
- **SSH Private Key Location**: `C:\Users\swapn\.ssh\oracle_official.key` (or `~/.ssh/oracle_official.key`)
- **SSH Config Alias**: `oracle-radar` (defined in `~/.ssh/config`)
- **Remote Directory**: `/home/ubuntu/radar-local-v2`
- **Process Manager**: `pm2` (Process Name: `radar-v2`)
- **Git Remote**: `origin` -> `https://github.com/swapnilshuk1/RadarV2.git` (Branch: `main`)
- **Live URL**: `http://130.210.41.232.sslip.io/`

### Automated 1-Command Deployment:
```bash
# Run automated full deployment (Typecheck -> Build -> Git Push -> Remote Pull & PM2 Restart)
npm run deploy
```
*Or directly via script:*
```bash
# Windows PowerShell:
.\scripts\deploy.ps1 "Your commit message"

# Node / TypeScript:
npx tsx scripts/deploy.ts "Your commit message"

# Direct SSH command:
ssh -o StrictHostKeyChecking=no -i "C:\Users\swapn\.ssh\oracle_official.key" ubuntu@130.210.41.232 "cd /home/ubuntu/radar-local-v2 && git fetch origin main && git reset --hard origin/main && npm install && npm run build && pm2 restart radar-v2 && pm2 status"
```



