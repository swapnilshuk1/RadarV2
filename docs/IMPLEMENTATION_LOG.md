# RADAR v2 — Implementation Log

One entry per completed phase. Append only — never edit past entries.
AI agents should read this to understand what has already been done and why.

---

## Phase 0 — Pre-Flight Documentation
**Date**: 2026-07-29  
**Branch**: `feature/phase-0-documentation`  
**Status**: ✅ Complete

### What Changed
- Created `docs/ARCHITECTURE_DECISIONS.md` — 10 immutable ADRs governing all future engineering
- Created `docs/IMPLEMENTATION_LOG.md` — this file
- Created `docs/SESSION_HANDOFF.md` — session handoff template for AI model continuity
- Committed `src/data/candidate-profile.backup.json` — golden profile backup (9.8KB)
- Updated `people.email` in Turso from `swapnil@radar.io` → `swapnilshuk@gmail.com`

### Key Decisions Made
- ADR-001 strengthened to "Engine is Pure Function" (not merely "Engine never reads DB")
- Phase 5 split into 5a (domain types), 5a.5 (builder interface), 5b (persistence)
- Google account confirmed as `swapnilshuk@gmail.com`
- Magic login preserved behind `NODE_ENV === "development"` flag throughout all phases

### Verified
- `npm run test:eqe` baseline established (scores recorded in SESSION_HANDOFF.md)
- `npx tsc --noEmit` passes on clean main branch

---

## Phase 1 — Schema Repair
**Date**: 2026-07-29  
**Branch**: `main`  
**Status**: ✅ Complete

### What Changed
- Created `006_recreate_decisions.sql` to re-establish the dropped decisions table safely.

### Verified
- 38 decisions for `swapnil-shukla` remain safely intact in Turso.

---

## Phase 2 — Google OAuth
**Date**: 2026-07-29  
**Branch**: `feature/phase-2-google-auth` / `main`  
**Status**: ✅ Complete

### What Changed
- Installed `lucia` and `arctic` for auth orchestration.
- Created `007_auth_tables.sql` to initialize `auth_sessions`, `oauth_accounts`, and `people` table columns (`name`, `avatar_url`, `onboarded`, `role`, `email_verified`).
- Set up `src/routes/api/auth/google.ts`, `callback.ts`, and `logout.ts` routes.
- Modified `__root.tsx` and `login.tsx` to handle authentication lifecycle.

### Verified
- `npx tsc --noEmit` and build passed.

---

## Phase 3 — Pure Engine Refactor
**Date**: 2026-07-29  
**Branch**: `feature/phase-3-pure-engine` / `main`  
**Status**: ✅ Complete

### What Changed
- Decoupled `DeterministicScorer` from fs and global imports.
- Updated `OpportunityProvider` and `runEngine()` signatures to avoid ambient `candidateProfile` state.

### Verified
- `npm run test:eqe` confirmed output remains identical, establishing deterministic execution.

---

## Phase 4 — Per-User Decisions Fix
**Date**: 2026-07-29  
**Branch**: `main`  
**Status**: ✅ Complete

### What Changed
- Removed `DEFAULT_PERSON_ID` (`swapnil-shukla`) from `decisions-server.ts`.
- Refactored `cip.ts` and `engine.ts` to strictly pass the dynamic `candidateProfile` derived from the active session.
- Ensured OAuth is the primary and only pathway in `login.tsx`.

### Verified
- `npx tsc --noEmit` and `npm run test:eqe` passed smoothly.
- DB updates properly reflect correct multi-tenant attributes without crashing.

---

## Phase 5a — Formal Domain Types
**Date**: 2026-07-30  
**Branch**: `main`  
**Status**: ✅ Complete

### What Changed
- Created `src/domain/candidate.ts` declaring strict interfaces for candidate profiles (`CandidateProfile`, `CandidateIdentity`, `CandidateExperience`, etc.).
- Updated `src/lib/intelligence/engine.ts` and `src/lib/intelligence/cip.ts` to replace `any` types with the formal `CandidateProfile` domain type.
- Updated `src/data/candidate-profile.ts` and `src/types/candidate.ts` to correctly import and export the newly typed schema.

### Verified
- `npx tsc --noEmit` runs completely clean with no type errors.

---

<!-- Add new entries below as phases complete -->
