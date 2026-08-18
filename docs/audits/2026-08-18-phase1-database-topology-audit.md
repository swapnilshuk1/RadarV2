# RADAR V4 — Phase 1: Database Topology Forensic Audit

**Document Classification**: Architectural Forensic Audit  
**Date**: 2026-08-18  
**Scope**: Complete Persistence Topology, Adapter Selection, Database Inventories, and SQLite Elimination Feasibility.  
**Constraint**: Forensic Analysis Only — Zero Code or Data Modified.

---

## 1. Executive Summary & Core Recommendation

### Core Recommendation
> **`radar.sqlite` can and MUST be safely eliminated from the codebase.**

#### What Must Happen First:
1. **Refactor Legacy Scripts**: 18 maintenance and audit scripts currently bypass the canonical `DatabaseAdapter` by hardcoding `new Database("radar.sqlite")`. They must be converted to use `getDatabaseAdapter()` / `getRepositories()`.
2. **Deactivate `sync-to-turso.ts` Destructive Overwrite**: `scripts/sync-to-turso.ts` is currently wired to overwrite Turso Cloud with stale local data from `radar.sqlite` (507 stale jobs overwriting 2,675 live jobs). This script must be neutralized.
3. **Environment Isolation**: Formalize Turso database branches (`radar-dev` vs `radar-prod`) in `.env` so local development and tests query the canonical schema without needing a local drifting file on disk.

---

## 2. Forensic Answers to Targeted Audit Questions

### Q1: Exactly how is the database adapter selected?
In [`src/data/database/index.ts:L46-L145`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/database/index.ts#L46-L145), `getDatabaseAdapter()` executes the following resolution ladder:
1. Calls `loadEnvFile(".env")`, `loadEnvFile("gemini.env")`, `loadEnvFile("groq.env")`.
2. Checks `tursoUrl = process.env.TURSO_CONNECTION_URL || process.env.TURSO_DATABASE_URL` and `tursoToken = process.env.TURSO_AUTH_TOKEN`.
3. Checks `isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.RENDER === "true"`.
4. **Production Fail-Fast**: If `isProduction` is true and credentials are missing, it throws: `"[DatabaseAdapter] Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment."`
5. **Turso Cloud Path**: If `tursoUrl` and `tursoToken` are present, returns `new TursoAdapter(tursoUrl, tursoToken)` backed by `@libsql/client`.
6. **Local Fallback Path**: If non-production and Turso credentials are missing, attempts to load `better-sqlite3` and returns `new SqliteAdapter(sqliteDb)` targeting `dbPath || process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), "radar.sqlite")`.
7. **No-Op Fallback**: If `better-sqlite3` fails to load, returns an in-memory dummy no-op adapter so the server does not crash with an unhandled exception.

---

### Q2: What environment variables determine Local SQLite vs Turso?

| Variable | Purpose | Target Engine |
| :--- | :--- | :---: |
| `TURSO_CONNECTION_URL` (or `TURSO_DATABASE_URL`) | LibSQL remote connection URL (`libsql://...`) | **Turso Cloud** |
| `TURSO_AUTH_TOKEN` | JWT bearer token for Turso Cloud database | **Turso Cloud** |
| `NODE_ENV` / `VERCEL` / `RENDER` | Triggers strict production fail-fast enforcement | **Turso Cloud (Enforced)** |
| `SQLITE_DB_PATH` | File path override for local SQLite file | **Local SQLite** |

---

### Q3: Direct References Inventory

#### Direct References to `radar.sqlite`
- `src/data/database/index.ts` (L98, L100) — Default file path in SQLite fallback.
- `scripts/check-database-breakup.ts` (L6)
- `scripts/check-queue-status.ts` (L7, L62)
- `scripts/corpus-recognition-report.ts` (L40)
- `scripts/corpus/health.ts` (L21)
- `scripts/counterfactual-stability-test.ts` (L26)
- `scripts/diagnose-text-availability.ts` (L7)
- `scripts/evidence-gap-attribution.ts` (L56)
- `scripts/kg-coverage-audit.ts` (L18)
- `scripts/mine-unrecognized-tech.ts` (L10)
- `scripts/qualify/harness.ts` (L6)
- `scripts/rebuild-read-models.ts` (L11)
- `scripts/recommend.ts` (L31)
- `scripts/reprocess-corpus.ts` (L44)
- `scripts/sync-to-turso.ts` (L41)
- `tests/deployment-determinism.test.ts` (L40, L55, L105, L114) — Assertion verifying absence in bundle.

#### Direct References to `better-sqlite3` & `new Database(...)`
- `src/data/database/index.ts` (L87)
- `src/data/database/sqlite.ts` (L2)
- `src/data/sqlite/migrations/runner.ts` (L23)
- `src/data/sqlite/read_models/*.ts` (`CareerMemoryReadModel.ts`, `ExecutiveDashboardReadModel.ts`, `OpportunityInboxReadModel.ts`)
- `scripts/audit-lineage.ts` (L3)
- `scripts/check-database-breakup.ts` (L14, L110)
- `scripts/check-queue-status.ts` (L14, L58)
- `scripts/corpus-recognition-report.ts` (L194)
- `scripts/corpus/health.ts` (L84)
- `scripts/corpus/publish.ts` (L3)
- `scripts/counterfactual-stability-test.ts` (L50)
- `scripts/diagnose-text-availability.ts` (L7)
- `scripts/evidence-gap-attribution.ts` (L62)
- `scripts/generate-plan.ts` (L6)
- `scripts/golden/seed-acquisition.ts` (L11)
- `scripts/kg-coverage-audit.ts` (L20)
- `scripts/mine-unrecognized-tech.ts` (L535)
- `scripts/qualify/harness.ts` (L103)
- `scripts/rebuild-read-models.ts` (L12)
- `scripts/recommend.ts` (L88)
- `scripts/reprocess-corpus.ts` (L59)
- `scripts/scraper/persist/queue.ts` (L48)
- `scripts/sync-to-turso.ts` (L51)
- `scripts/test-phase7-population.ts` (L2)
- `scripts/trace-unit.ts` (L8)

#### Direct References to `TURSO_CONNECTION_URL` & `TURSO_AUTH_TOKEN`
- `src/data/database/index.ts` (L58-L63)
- `scripts/sync-to-turso.ts` (L32-L36)
- `tests/deployment-determinism.test.ts` (L19-L50, L144-L145)
- `tests/runtime-persistence-source.test.ts` (L173-L181)

---

### Q4: Scripts/Tests Bypassing Canonical Database Adapter

The following 18 scripts bypass `getDatabaseAdapter()` / `getRepositories()` and instantiate raw SQLite connections directly:
1. `scripts/corpus-recognition-report.ts`
2. `scripts/rebuild-read-models.ts`
3. `scripts/diagnose-text-availability.ts`
4. `scripts/qualify/harness.ts`
5. `scripts/kg-coverage-audit.ts`
6. `scripts/counterfactual-stability-test.ts`
7. `scripts/evidence-gap-attribution.ts`
8. `scripts/corpus/health.ts`
9. `scripts/corpus/publish.ts`
10. `scripts/check-database-breakup.ts`
11. `scripts/check-queue-status.ts`
12. `scripts/mine-unrecognized-tech.ts`
13. `scripts/reprocess-corpus.ts`
14. `scripts/generate-plan.ts`
15. `scripts/golden/seed-acquisition.ts`
16. `scripts/recommend.ts`
17. `scripts/trace-unit.ts`
18. `scripts/sync-to-turso.ts`

---

### Q5: Complete Read/Write Paths for Core Entities

| Table | Primary Read Path | Primary Write Path | Repository Store |
| :--- | :--- | :--- | :--- |
| **`opportunities`** | `listOpportunitySources()`, `getById()`, `findByCanonicalTitle()` | `saveOpportunity()`, `createOpportunity()` | [`SqliteOpportunityStore.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteOpportunityStore.ts) |
| **`documents`** | `getDocument()`, `getDocumentByOpportunityId()`, `getRawDocument()` | `saveDocument()`, `saveRawDocument()` | [`SqliteDocumentStore.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteDocumentStore.ts) & [`SqliteAcquisitionStore.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteAcquisitionStore.ts) |
| **`candidate_evaluations`** | `listEvaluationsForUser()`, `getEvaluation()`, `getEvaluationMetrics()`, `getAdjacentEvaluations()` | `saveEvaluation()`, `deleteEvaluation()`, `clearEvaluations()` | [`SqliteEvaluationStore.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteEvaluationStore.ts) |
| **`evidence`** | `getEvidenceForOpportunity()`, `listEvidence()` | `recordEvidence()` | [`SqliteKnowledgeStore.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteKnowledgeStore.ts) |
| **`facts`** | `getFactsForOpportunity()`, `listFacts()` | `recordFact()` | [`SqliteKnowledgeStore.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteKnowledgeStore.ts) |
| **`decisions`** | `getUserDecisions()`, `getUserDecision()` | `recordUserDecision()`, `deleteUserDecision()` | [`SqliteDecisionSupportStore.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteDecisionSupportStore.ts) |
| **`evaluation_jobs`** | `getNextPendingJob()`, `getJobStatus()` | `enqueueJob()`, `markJobCompleted()`, `markJobFailed()` | [`SqliteEvaluationStore.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/data/sqlite/repositories/SqliteEvaluationStore.ts) |

---

### Q6: Classification of `candidate_evaluations`
- **Architectural Intent**: Materialized Read Model Cache.
- **Actual Production Reality**: **Authoritative Serving Cache**.
  - `OpportunityService.listForUser()` and `getForUser()` deserialize `evaluationJson` directly.
  - Because it contains no runtime staleness invalidation or post-policy Attention Window recalculation on read, the table currently functions as an un-invalidated frozen store.

---

### Q7: Local vs Turso Schema and Repository Equivalence
- **Schema**: **Identical**. Both local and Turso share the identical SQL DDL (tables, primary keys, foreign keys, unique constraints).
- **Repositories**: **Identical**. Both local and Turso are accessed through the exact same `StorageProvider` implementations (`SqliteOpportunityStore`, `SqliteEvaluationStore`, etc.), utilizing SQL parameterized queries via the `DatabaseAdapter` interface.

---

### Q8: Production Dependency on SQLite Semantics
- **No divergence**. Both `better-sqlite3` and `@libsql/client` (Turso) implement SQLite 3 dialect semantics (`INSERT OR REPLACE`, `ON CONFLICT DO UPDATE`, `AUTOINCREMENT`).
- All repository methods are asynchronously structured (`async/await`), ensuring full compatibility with Turso's network transport.

---

### Q9: Where a Developer Could Falsely Believe `radar.sqlite` is Production
1. **`README.md` & `AGENTS.md`**: Both describe `radar.sqlite` as the primary database file.
2. **`scripts/sync-to-turso.ts`**: Implies local SQLite is the source of truth to be pushed upstream to Turso.
3. **Local Development Startup**: If `.env` lacks Turso credentials, the app silently falls back to local `radar.sqlite` with 507 jobs and 0 career profiles, masking production behavior.
4. **Offline Diagnostic Scripts**: Running scripts like `corpus-recognition-report.ts` outputs statistics based on 507 stale jobs rather than the 2,675 live production jobs in Turso.

---

## 3. Structural Diagrams & Inventories

### A. Current Architecture Diagram

```
                                    DATABASE RESOLUTION TOPOLOGY
                                 
                                     [getDatabaseAdapter()]
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       │                                               │
             [Turso Credentials Present?]                     [Production Mode?]
                       │                                               │
              YES ─────┴───── NO                              YES ─────┴───── NO
               │               │                               │               │
               ▼               ▼                               ▼               ▼
      [TursoAdapter]    [Check Environment]           [THROW ERROR]     [better-sqlite3]
             │                 │                                               │
             ▼                 └───────────────────────────────────────────────┤
     (Turso Cloud DB)                                                          ▼
  • 2,675 opportunities                                                (Local radar.sqlite)
  • 2,023 documents                                                    • 507 opportunities
  • 5,993 evaluations                                                  • 507 documents
  • 4,707 evidence                                                     • 0 evaluations
  • 8,514 facts                                                        • 762 evidence
                                                                       • 1,925 facts
```

---

### B. Complete SQLite Dependency Inventory

| Subsystem / File | Direct Dependency | Purpose | Target Action |
| :--- | :--- | :--- | :--- |
| `src/data/database/sqlite.ts` | `better-sqlite3` | In-memory / local SQLite driver | Retain for isolated memory testing (`:memory:`) |
| `src/data/database/index.ts` | `better-sqlite3`, `radar.sqlite` | Local fallback on missing Turso env | Remove fallback; fail-fast in dev if unconfigured |
| `src/data/sqlite/migrations/runner.ts` | `better-sqlite3` | Applies SQL files on startup | Refactor to execute via `DatabaseAdapter` |
| `src/data/sqlite/read_models/*.ts` | `better-sqlite3` | Legacy read-model rebuilder | Deprecate / remove |
| `scripts/sync-to-turso.ts` | `better-sqlite3`, `radar.sqlite` | Overwrites Turso with local DB | **DELETE / DISABLE IMMEDIATELY** |
| 17 Maintenance Scripts in `scripts/` | `better-sqlite3`, `radar.sqlite` | Offline corpus audits | Refactor to use `getDatabaseAdapter()` |

---

### C. Complete Turso Dependency Inventory

| Subsystem / File | Direct Dependency | Purpose |
| :--- | :--- | :--- |
| `src/data/database/turso.ts` | `@libsql/client` | Primary LibSQL/Turso database adapter |
| `src/data/database/index.ts` | `TursoAdapter` | Factory constructor returning singleton adapter |
| `src/data/sqlite/provider.ts` | `getDatabaseAdapter()` | Passes `TursoAdapter` into `StorageProvider` repositories |
| `src/lib/intelligence/opportunity-service.ts` | `StorageProvider` | Reads `candidate_evaluations` and queries Turso |
| `src/lib/intelligence/decisions-server.ts` | `StorageProvider` | Writes user swipes directly to Turso `decisions` table |

---

### D. Environment-Selection Matrix

| Environment | `TURSO_CONNECTION_URL` | `TURSO_AUTH_TOKEN` | Resolved Adapter | Target Database |
| :--- | :---: | :---: | :---: | :--- |
| **RADAR_DEV (Local)** | Set in `.env.local` | Set in `.env.local` | `TursoAdapter` | Turso Dev / Staging Branch |
| **RADAR_DEV (Offline/Test)**| Unset | Unset | `SqliteAdapter` | In-Memory (`:memory:`) Fixture |
| **RADAR_STAGING** | Set in Container Env | Set in Container Env | `TursoAdapter` | Turso Staging Database |
| **RADAR_PROD** | Set in Container Env | Set in Container Env | `TursoAdapter` | Turso Production Database |
| **RADAR_PROD (Missing Env)**| Unset | Unset | **Throws Fatal Error** | None (Prevents Data Drift) |

---

### E. Recommended Target Architecture

```
========================================================================================================================
                                      TARGET UNIFIED PERSISTENCE TOPOLOGY
========================================================================================================================

                                            [StorageProvider]
                                                   │
                                                   ▼
                                          [DatabaseAdapter]
                                                   │
                   ┌───────────────────────────────┴───────────────────────────────┐
                   │                                                               │
     [Standard Dev / Staging / Prod]                                      [Isolated Unit Tests]
                   │                                                               │
                   ▼                                                               ▼
             [TursoAdapter]                                                 [SqliteAdapter]
                   │                                                               │
                   ▼                                                               ▼
          (Turso Cloud LibSQL)                                            (In-Memory :memory:)
       • radar-prod (Production)                                          • Transient test fixtures
       • radar-staging (Staging)                                          • 0 disk-bound sqlite files
       • radar-dev (Local Development)

========================================================================================================================
```

---

### F. Risks and Gaps Before SQLite Removal

1. **Risk: Accidentally Overwriting Turso with `sync-to-turso.ts`**:
   - `scripts/sync-to-turso.ts` contains `INSERT OR REPLACE INTO` iterating over local `radar.sqlite`. If executed, it wipes 2,168 live opportunities and 5,993 evaluations.
   - **Remedy**: Delete or disable this script before any other migration work.
2. **Risk: Broken Offline Diagnostic Scripts**:
   - 18 scripts in `scripts/` will fail if `radar.sqlite` is removed without updating them to import `getDatabaseAdapter()`.
   - **Remedy**: Update all scripts to import `getRepositories()` from `src/data/sqlite/provider.ts`.
3. **Risk: Local Migration Runner (`runner.ts`)**:
   - `src/data/sqlite/migrations/runner.ts` currently requires `better-sqlite3` and executes synchronously against a local file.
   - **Remedy**: Upgrade `runner.ts` to execute migrations asynchronously through `DatabaseAdapter`.
