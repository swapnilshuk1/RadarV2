# RADAR Stage 2B — Canonical Identity & Candidate Projection Unification: Final Report

**Date**: 16 August 2026  
**Status**: ✅ **PASS — CANONICAL IDENTITY UNIFIED**  
**Database**: Turso Cloud (`libsql://radar-db-swapnilshuk1.aws-ap-south-1.turso.io`)

---

## 1. Executive Summary

In Stage 2B, the legacy seeded RADAR identity (`swapnil-shukla` / `swapnil@radar.io`) was systematically and transactionally unified with the verified Google OAuth executive identity (`ms6i7e3y-4x0chy5fy` / `swapnilshuk@gmail.com`). 

All candidate assets (documents, evidence graphs, career intent) were safely reassigned to the canonical identity. All 424 overlapping decisions under the legacy identity were proven to be exact duplicates of the canonical decisions and safely purged. The corrupted legacy projection stub was deleted, leaving the verified, rich V4 `CandidateProjection` as the sole canonical executive profile. All hardcoded identity fallbacks and fake session UI controls were purged from the runtime production codebase.

---

## 2. Final Identity & Record Inventory

| Category / Table | Canonical Identity (`ms6i7e3y-4x0chy5fy`) | Legacy Identity (`swapnil-shukla`) | Lineage & Status |
| :--- | :--- | :--- | :--- |
| **Email** | `swapnilshuk@gmail.com` | *None* | Verified Google OAuth |
| **Name** | `Swapnil Shukla` | *None* | Verified |
| **Role / Verified** | `user` / `email_verified: 1` | *None* | Active |
| **OAuth Accounts** | 1 (`google`, ID `111860729786828443942`) | 0 | Canonical OAuth Link |
| **Auth Sessions** | 25 active sessions | 0 | Preserved |
| **Decisions** | **427 decisions** (PURSUE, CONSIDER, PASS) | **0 decisions** (424 purged) | **100% Integrity** |
| **Candidate Documents** | **2 documents** (`doc-test-1785363795507`, `doc-1786340748254`) | 0 | Reassigned |
| **Document Contents** | **2 content blobs** | 0 | Preserved |
| **Evidence Graphs** | **2 graphs** (`ev-graph-doc-test-...`, `ev-graph-doc-1786340748254-...`) | 0 | Reassigned |
| **Career Intent** | **1 row** (`intent_ms6i7e3y-4x0chy5fy`) | 0 | Reassigned |
| **Career Profile (V4)** | **1 row** (`profile-ms6i7e3y-4x0chy5fy`, 2,280 bytes) | 0 (Purged corrupted stub) | **100% Valid V4 Schema** |
| **People Record** | **1 row** (`ms6i7e3y-4x0chy5fy`) | **0 rows** (Safely deleted) | **Single Canonical User** |

---

## 3. Pre-Migration Forensic Verification Results

Prior to any database mutation, exhaustive preflight forensics proved:
1. **100% Decision Overlap**: Exactly 424 out of 424 legacy decisions matched canonical decisions with identical `opportunity_id` and identical `action` (`PURSUE`, `CONSIDER`, `PASS`). 0 conflicts existed.
2. **Canonical Exclusives**: 3 decisions (`j-0f125978bd6f`, `j-570849acdea0`, `j-f4bf8c23d4ae`) existed exclusively under the canonical identity.
3. **V4 Candidate Projection Validation**:
   - `profile-ms6i7e3y-4x0chy5fy`: **100% Valid** under `validateCandidateProjection()` (20 YOE, Strategic level, 52 skills, Enterprise scope).
   - `profile-swapnil-shukla`: **Invalid/Corrupted** (failed all 7 core V4 integrity dimensions).

---

## 4. Transactional Migration Execution

The migration was executed in a single atomic ACID write transaction (`TursoAdapter.transaction` / `client.transaction("write")`):
```text
[Turso Transaction Log]
- Reassigned 2 candidate documents to ms6i7e3y-4x0chy5fy
- Reassigned 2 evidence graphs to ms6i7e3y-4x0chy5fy
- Reassigned 1 career intent profile to ms6i7e3y-4x0chy5fy (id: intent_ms6i7e3y-4x0chy5fy)
- Removed 424 redundant duplicate decisions for swapnil-shukla
- Removed 1 invalid legacy career profile (profile-swapnil-shukla)
- Removed 1 legacy candidate_projection row
- Verified zero dependent records remain pointing to legacy user ID
- Deleted 1 legacy people record [swapnil-shukla]
```

Post-migration orphan scanning across **every table and foreign key column in the Turso schema** verified **0 residual references** to `swapnil-shukla`.

---

## 5. Codebase Identity Purge

Hardcoded identity fallbacks and dev mock session artifacts were eliminated from runtime code:

1. [`src/lib/intelligence/EvaluationCoordinator.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/EvaluationCoordinator.ts): Removed `payload.personId || "swapnil-shukla"`. Invalidation occurs globally, and user-specific re-evaluation runs dynamically when `personId` is provided.
2. [`src/lib/intelligence/candidate-sync.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/candidate-sync.ts): Removed default `personId = "swapnil-shukla"`; `personId` is now an explicit, required parameter.
3. [`src/lib/intelligence/profile-server.ts`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/lib/intelligence/profile-server.ts): Cleaned `initializeSessionFn` from legacy mode unions (`"swapnil" | "new_user"`); now uses standard authenticated user context.
4. [`src/routes/login.tsx`](file:///c:/Users/swapn/Downloads/radar-local-v2/src/routes/login.tsx): Removed fake client-side login bypasses (`"Direct Executive Access (Swapnil Shukla)"` and `"Test Onboarding Journey"`) injecting `swapnil-shukla-dev`. Pure Google OAuth (`/api/auth/google`) is the sole authentic entrypoint.

---

## 6. Verification & Automated Test Suite Results

| Test Suite / Command | Scope | Result | Details |
| :--- | :--- | :--- | :--- |
| **`tests/canonical-identity.test.ts`** | Canonical Identity & Projection Integrity | ✅ **PASS (8/8)** | Verifies canonical user, 0 legacy rows, 0 orphans, 427 decisions, 2 docs, 2 EGs, valid V4 projection, live dynamic scoring |
| **`tests/security/`** | Auth & Scraper Security | ✅ **PASS (18/18)** | 15 auth tests + 3 scraper smoke tests passed |
| **`tests/runtime-persistence-source.test.ts`** | Runtime Turso Source of Truth | ✅ **PASS (6/6)** | Verifies DatabaseAdapter sole path, 0 filesystem reads |
| **`npm run test:eqe`** | Executive Qualification Engine | ✅ **CERTIFIED** | 100% precision across Commercial Accountability, Mandates, Reporting Lines, Tech Stack |
| **`npx tsc --noEmit`** | TypeScript Type Checker | ✅ **PASS (0 errors)** | Full codebase typecheck clean |
| **`npm run build`** | Production SSR / Nitro Build | ✅ **PASS** | Client, SSR, and Nitro server bundles generated with zero errors |

---

## 7. Final Invariant Certification

- [x] Turso is the sole production runtime and identity database.
- [x] Exactly one canonical executive identity exists: `ms6i7e3y-4x0chy5fy` (`swapnilshuk@gmail.com`).
- [x] Exactly 427 canonical decisions are preserved with 100% data integrity.
- [x] Canonical V4 `CandidateProjection` is 100% valid and operational.
- [x] All candidate CV documents and evidence graphs belong to `ms6i7e3y-4x0chy5fy`.
- [x] Legacy identity `swapnil-shukla` is completely purged from all tables with zero orphaned rows.
- [x] Runtime code contains zero hardcoded `swapnil-shukla` fallbacks.
- [x] All automated test suites and production builds pass.

```text
================================================================================
FINAL VERDICT: PASS — CANONICAL IDENTITY UNIFIED
================================================================================
```
