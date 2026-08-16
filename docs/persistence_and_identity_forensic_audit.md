# RADAR v2 Persistence & Identity Forensic Audit Report

**Audit Mode**: READ-ONLY FORENSIC ANALYSIS  
**Constraint Adherence**: ZERO mutations performed across codebase, database, schemas, or environments.  
**Scope**: Opportunity persistence lineage, database drift, identity inventory, decision ownership, and deployment determinism.  
**Date**: August 2026  
**Classification**: CONFIDENTIAL / ARCHITECTURAL AUDIT  

---

## 1. Executive Summary

| Diagnostic Domain | Status | Forensic Finding |
| :--- | :--- | :--- |
| **Turso Cloud Persistence** | 🟢 **CANONICAL** | Contains all live ingested data: **2,673 opportunities**, **2,022 parsed JD documents**, **427 recorded user decisions**, and **1 valid executive projection**. |
| **Opportunity Data Loading** | 🔴 **BYPASSED** | The recommendation engine (`engine.ts`) completely bypasses `DatabaseAdapter` and reads static JSON (`src/data/live-scraped.json`, 1,581 items) or local SQLite (`radar.sqlite`, 507 items) directly from disk. |
| **Candidate Identity Lineage** | 🔴 **SPLIT** | Google OAuth (`swapnilshuk@gmail.com`) created `ms6i7e3y-4x0chy5fy` with all 427 decisions and valid projection. Legacy seeds left `swapnil-shukla` with corrupted projection and 2 CV documents. |
| **Opportunity Count Discrepancy** | 🟢 **EXPLAINED** | **1,581** was the array length of static file `live-scraped.json`. **2,673** is the true database count in Turso Cloud. |
| **Deployment Packaging** | 🔴 **DRIFT RISK** | `deploy.sh` archives local `radar.sqlite` (which has 0 profiles) and `live-scraped.json`, causing the remote server to depend on local files instead of Turso. |

---

## 2. Runtime Persistence Map

```text
                                RUNTIME DATA PATH AUDIT
                                ───────────────────────

   Client Request (GET / Shortlist Page)
            │
            ▼
   Route Loader (`src/routes/index.tsx`)
            │
            ▼
   Server Function (`getOpportunitiesFn`)
            │
            ▼
   Domain Service (`OpportunityService.listForUser(userId)`)
            │
            ▼
   Recommendation Engine (`runEngine(projection, active)`)
            │
            ▼
   Opportunity Reader (`readOpportunities()` in `src/lib/intelligence/engine.ts`)
            │
            ▼
   `loadBaseOpportunities()` Execution Pipeline:
            │
            ├─► [Path 1: PRIMARY] `fs.readFileSync("src/data/live-scraped.json")`
            │     └─► Status: OPERATIONAL ARTIFACT / STALE JSON SNAPSHOT
            │     └─► Found on Disk: YES (1,581 records)
            │     └─► Data Adapter Bypassed: YES (Direct JSON read from disk)
            │
            ├─► [Path 2: FALLBACK] `new Database("radar.sqlite")` via `require("better-sqlite3")`
            │     └─► Status: LOCAL LEGACY FILE
            │     └─► Found on Disk: YES (507 records)
            │     └─► Data Adapter Bypassed: YES (Synchronous C++ binding read from disk)
            │
            └─► [Path 3: CANONICAL - NEVER REACHED] `repos.opportunities.listActiveOpportunities()`
                  └─► Status: CANONICAL APPLICATION DATA (Turso Cloud)
                  └─► Database Count: 2,673 records
                  └─► Data Adapter Executed: NO (Engine never invokes DatabaseAdapter)
```

### Persistence Path Classifications:

| Persistence Path / Source | Mechanism | Classification | Status & Risk |
| :--- | :--- | :--- | :--- |
| **Turso Cloud (`@libsql/client`)** | `DatabaseAdapter` $\rightarrow$ `SqliteOpportunityStore` | **CANONICAL APPLICATION DATA** | Contains all live ingested data (2,673 jobs), but currently **bypassed by `engine.ts`**. |
| **`src/data/live-scraped.json`** | Direct `fs.readFileSync` in `engine.ts` | **OPERATIONAL ARTIFACT** | Stale static dump (1,581 jobs). Currently serves as the **actual runtime source of truth**. |
| **`radar.sqlite` (Local File)** | `better-sqlite3` in `engine.ts` & fallback in `adapter` | **LEGACY / TEST ARTIFACT** | Severely out of sync (507 jobs, 0 career profiles). Bundled into production deployments. |
| **`candidate-profile.json`** | Direct `fs.readFileSync` in `ProfileImporter` | **TEST FIXTURE / SEED** | Static template used in offline CLI test scripts. |

---

## 3. Opportunity Count Reconciliation: 1,581 vs. 2,673

### The Discrepancy Explained
- **2,673 (Turso Cloud Database)**: The canonical count of opportunities stored in the cloud SQLite database (`radar-db-swapnilshuk1.aws-ap-south-1.turso.io`), accumulated across multiple scraping and qualification runs.
- **1,581 (`live-scraped.json` on disk)**: A static JSON export on disk containing pre-calculated dimensional fits from an earlier batch.
- **507 (`radar.sqlite` on disk)**: A stale, partial snapshot in the local SQLite file.

### Forensic Breakdown by Status Buckets

```text
┌────────────────────────────────────────────────────────────────────────┐
│ TURSO CLOUD DATABASE (2,673 Total Opportunities)                       │
├──────────────────────────────┬─────────────────────────────────────────┤
│ Active Opportunities         │ 323                                     │
│ Normalized Opportunities     │ 1,692                                   │
│ Verified Opportunities       │ 651                                     │
│ Discovered Opportunities     │ 7                                       │
│ Linked to Companies          │ 2,673 (100%)                            │
│ With Parsed JD Documents     │ 2,022 (75.6%)                           │
└──────────────────────────────┴─────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ LOCAL SQLITE: radar.sqlite (507 Total Opportunities)                   │
├──────────────────────────────┬─────────────────────────────────────────┤
│ Active Opportunities         │ 251                                     │
│ Normalized Opportunities     │ 251                                     │
│ Discovered Opportunities     │ 5                                       │
│ Career Profiles              │ 0 (Completely Empty)                    │
│ User Decisions               │ 0 (Completely Empty)                    │
└──────────────────────────────┴─────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ FILESYSTEM ARTIFACT: live-scraped.json (1,581 Total Records)           │
├──────────────────────────────┬─────────────────────────────────────────┤
│ Unique Job Hashes            │ 1,581                                   │
│ Duplicate Records            │ 0                                       │
│ Pre-computed Telemetry Nodes │ 1,581                                   │
└──────────────────────────────┴─────────────────────────────────────────┘
```

**Conclusion**: When the UI previously displayed 1,581 opportunities, the engine was executing `loadBaseOpportunities()` against `src/data/live-scraped.json`, completely disconnected from the 2,673 opportunities in Turso Cloud.

---

## 4. Identity Forensics & Turso Identity Inventory

Querying Turso Cloud read-only revealed **3 distinct person records**:

```text
                                  USER IDENTITY & LINEAGE MAP
                                  ───────────────────────────

   Google OAuth Sign-in                                          Legacy Seeding & Scripts
  (swapnilshuk@gmail.com)                                           (swapnil@radar.io)
            │                                                               │
            ▼                                                               ▼
   Person ID: ms6i7e3y-4x0chy5fy                                   Person ID: swapnil-shukla
   ────────────────────────────                                   ─────────────────────────
   • people table: candidate_state = NULL                         • people table: candidate_state = 730 bytes
   • career_profiles: Valid (2,280 bytes)                         • career_profiles: Broken (377 bytes)
     - operatingLevel: STRATEGIC (95%)                              - missing: operatingLevel, workNature,
     - workNature: EXECUTIVE_WORK (90%)                               decisionAuthority, commercialScope,
     - decisionAuthority: ENTERPRISE (90%)                            yearsOfExperience, executiveThemes
     - commercialScope: ENTERPRISE (90%)                          • candidate_documents: 2 PDFs (Swapnil CV)
     - executiveThemes: [Growth, Transformation, ...]             • evidence_graphs: 2 graphs (1,960 bytes)
   • decisions: 427 decisions                                     • decisions: 424 decisions
   • auth_sessions: 25 active sessions                            • auth_sessions: 0 sessions
   • When evaluated: 1,581 opportunities generated                • When evaluated: FAILS INTEGRITY CHECK
```

### Complete Inventory:

| Metric / Field | Verified OAuth User (`ms6i7e3y-4x0chy5fy`) | Legacy Seed User (`swapnil-shukla`) | Guest Identity (`guest-user`) |
| :--- | :--- | :--- | :--- |
| **Email** | `swapnilshuk@gmail.com` | `swapnil@radar.io` | `guest@radar.advisory` |
| **Full Name** | `Swapnil Shukla` | `NULL` | `NULL` |
| **OAuth Provider** | `google` | `None` | `None` |
| **OAuth Provider User ID** | `111860729786828443942` | `None` | `None` |
| **Active Auth Sessions** | **25 sessions** | 0 sessions | 0 sessions |
| **Decisions Count** | **427 decisions** | **424 decisions** | 0 decisions |
| **`people.candidate_state`** | `NULL` | **730 bytes** | `NULL` |
| **Candidate Documents** | 0 | **2 documents** (`Swapnil_Shukla_Resume_M.pdf`) | 0 |
| **Evidence Graphs** | 0 | **2 graphs** (1,960 bytes) | 0 |
| **`career_profiles` Record** | `profile-ms6i7e3y-4x0chy5fy` | `profile-swapnil-shukla` | None |
| **Projection Size & Integrity** | **2,280 bytes (100% VALID)** | **377 bytes (CORRUPTED / INVALID)** | None |
| **Created At** | `2026-07-29 19:54:50` | `2026-07-22 00:29:59` | `2026-07-29 20:14:06` |

---

## 5. Decision Ownership & Lineage

```text
Decision Ownership Lineage:
• ms6i7e3y-4x0chy5fy (Google OAuth):  427 decisions
• swapnil-shukla    (Legacy Seed):   424 decisions
• test-user-1786879068487 (Sec Test):   1 decision
```

### Overlap Analysis:
- **424 decisions overlap exactly** between `ms6i7e3y-4x0chy5fy` and `swapnil-shukla` with identical action values (`PURSUE`, `CONSIDER`, `PASS`).
- **3 additional decisions** exist exclusively under `ms6i7e3y-4x0chy5fy` (latest decision recorded: `2026-08-12 08:54:12`).
- **0 conflicting decisions** exist.
- **Zero Data Loss Guarantee**: All 424 decisions recorded under `swapnil-shukla` already exist under `ms6i7e3y-4x0chy5fy`.

---

## 6. Candidate Projection Ownership

- **Canonical Valid Projection**: Lives in `career_profiles` under `profile-ms6i7e3y-4x0chy5fy` (`person_id = "ms6i7e3y-4x0chy5fy"`).
  - Contains complete 20-year executive profile: `STRATEGIC` operating level (95%), `EXECUTIVE_WORK` work nature (90%), `ENTERPRISE` commercial scale (90%), `HYBRID` work model, and executive themes `['Growth', 'Transformation', 'Commercial', 'Customer', 'Digital']`.
- **Corrupted Stale Projection**: Lives in `career_profiles` under `profile-swapnil-shukla` (`person_id = "swapnil-shukla"`).
  - Has `years_experience = 0`, empty archetype, and missing metadata fields, which triggers:
    `[SqlitePersonStore] Stored projection for user 'swapnil-shukla' failed integrity check: missing [operatingLevel, workNature, decisionAuthority, commercialScope, preferredWorkModel, executiveThemes, yearsOfExperience].`

---

## 7. Deployment Determinism & Packaging Audit

Forensic inspection of [`deploy.sh`](file:///c:/Users/swapn/Downloads/radar-local-v2/deploy.sh#L33-L42):

```bash
tar -czf radar-deploy.tar.gz \
    .output/ \
    package.json \
    package-lock.json \
    radar.sqlite \
    src/data/ontology/ \
    src/data/live-scraped.json \
    --exclude='node_modules' \
    --exclude='.git'
```

### Findings:
1. `radar.sqlite` is packaged in production archives despite having 0 user profiles and stale jobs.
2. `live-scraped.json` is packaged in production archives because `engine.ts` looks for it on disk.
3. **Can Oracle Run Cleanly Without Local DB Files?**:
   - **YES**. When `engine.ts` is refactored to read through `DatabaseAdapter`, and `/opt/radar/.env` contains `TURSO_CONNECTION_URL` and `TURSO_AUTH_TOKEN`, the server connects directly to Turso Cloud, eliminating the need to bundle `radar.sqlite` or `live-scraped.json`.

---

## 8. Hardcoded Identity Inventory across Codebase

| Location | Occurrence | Classification | Safe to Remove? |
| :--- | :--- | :--- | :--- |
| [`src/routes/login.tsx:40-42`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/routes/login.tsx#L40-L42) | `userId: "swapnil-shukla-dev"`, `email: "swapnil@radar.advisory"` | **UI DEV ARTIFACT** | ⚠️ Bypasses real auth; replace with pure OAuth / Lucia dev session. |
| [`src/lib/intelligence/EvaluationCoordinator.ts:37`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/EvaluationCoordinator.ts#L37) | `payload.personId \|\| "swapnil-shukla"` | **LEGACY FALLBACK** | ⚠️ Must require explicit authenticated `personId`. |
| [`src/lib/intelligence/candidate-sync.ts:15`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/candidate-sync.ts#L15) | `personId: string = "swapnil-shukla"` | **LEGACY DEFAULT** | ⚠️ Must require dynamic `personId`. |
| [`src/lib/intelligence/profile-server.ts:417`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/profile-server.ts#L417) | `mode: "swapnil" \| "new_user"` | **LEGACY ENUM** | ⚠️ Should be dynamic session initialization. |
| [`src/routes/api/auth/callback.ts:87`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/routes/api/auth/callback.ts#L87) | Comment: `// Try to match by email (links existing Swapnil account)` | **COMMENT ONLY** | ✅ Harmless comment. |
| `scripts/audit_*.mjs` & CLI tools | `userId = "swapnil-shukla"`, `user-swapnil` | **CLI TEST HARNESS** | ✅ Permissible for offline testing / EQE benchmarks. |
| `tests/evaluation-cache-correctness.test.ts` | `personId: "swapnil-shukla"` | **UNIT TEST FIXTURE** | ✅ Permissible for isolated test suites. |

---

## 9. Test vs. Production Boundary Analysis

| Module / Construct | Current Runtime Usage | Target Architecture Classification |
| :--- | :--- | :--- |
| `better-sqlite3` in `src/data/database/index.ts` | Fallback if `TURSO_CONNECTION_URL` missing | **TEST ONLY / DEV OFFLINE** |
| `better-sqlite3` in `src/lib/intelligence/engine.ts` | Direct synchronous file access to `radar.sqlite` | **VIOLATION (Remove completely)** |
| `better-sqlite3` in `src/data/sqlite/read_models/` | Direct synchronous queries for read models | **UNUSED LEGACY (Retire)** |
| `:memory:` SQLite | Unit tests (`npm run test:eqe`, vitest) | **TEST ONLY (Compliant)** |
| `SqliteOpportunityStore` | Queries `DatabaseAdapter` asynchronously | **PRODUCTION & DEV RUNTIME (Compliant)** |

---

## 10. Data Safety & Schema Constraints Assessment

Foreign keys referencing `people(id)` in Turso:

```text
Table FK Constraints on people(id):
├── auth_sessions.user_id         (ON DELETE CASCADE)
├── oauth_accounts.user_id        (ON DELETE CASCADE)
├── career_profiles.person_id     (NO ACTION)
├── candidate_documents.person_id (NO ACTION)
├── evidence_graphs.person_id     (NO ACTION)
├── career_intents.person_id      (NO ACTION)
├── decisions.person_id           (UNIQUE constraint: person_id + opportunity_id)
├── matches.person_id             (NO ACTION)
└── recommendations.person_id     (NO ACTION)
```

### Safe Transactional Unification:
1. **Transfer Documents & Evidence**: Reassign `candidate_documents` and `evidence_graphs` owned by `swapnil-shukla` $\rightarrow$ `ms6i7e3y-4x0chy5fy`.
2. **Purge Duplicate Decisions**: Delete redundant decisions on `swapnil-shukla` (all 424 already exist on `ms6i7e3y-4x0chy5fy`).
3. **Purge Corrupted Profile & Legacy Person**: Delete `profile-swapnil-shukla` from `career_profiles` and delete `swapnil-shukla` from `people`.

---

## 11. Target Architecture & Recommended Implementation Sequence

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TARGET CANONICAL ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────────┘

     HTTP / SSR / RPC Requests
                 │
                 ▼
     Server Functions (`createServerFn` with `requireAuthUser()`)
                 │
                 ▼
     Domain Services (`OpportunityService`)
                 │
                 ▼
     Recommendation Engine (`runEngine`)
                 │
                 ▼
     Repositories (`StorageProvider.opportunities`)
                 │
                 ▼
     DatabaseAdapter (`TursoAdapter` via `@libsql/client`)
                 │
                 ▼
     Turso Cloud SQLite Database (Single Source of Truth: 2,673 Jobs, Live Profiles)
```

### Recommended Sequence:

1. **Phase 1: Runtime Persistence Unification**
   - Refactor `engine.ts` to load active opportunities and documents asynchronously through `repos.opportunities.listActiveOpportunities()`.
   - Remove `fs.readFileSync("src/data/live-scraped.json")` and direct `require("better-sqlite3")` from `engine.ts`.
2. **Phase 2: Transactional Identity Lineage Resolution**
   - Run a safe migration script to reassign candidate documents and evidence graphs to `ms6i7e3y-4x0chy5fy` and retire `swapnil-shukla`.
3. **Phase 3: Codebase Hardcoded Identity Purge**
   - Remove hardcoded `"swapnil-shukla"` fallbacks from `EvaluationCoordinator.ts`, `candidate-sync.ts`, and `profile-server.ts`.
4. **Phase 4: Deployment Pipeline Optimization**
   - Update `deploy.sh` to remove `radar.sqlite` and `src/data/live-scraped.json` from deployment archives.
   - Verify Oracle server environment configuration.
5. **Phase 5: Verification**
   - Verify TypeScript compilation (`npx tsc --noEmit`), build (`npm run build`), test suite (`npm run test:eqe`), and live Shortlist UI rendering against Turso Cloud.

---

> **NO CODE OR DATA MUTATIONS WERE PERFORMED.**
