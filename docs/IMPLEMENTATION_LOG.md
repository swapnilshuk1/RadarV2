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

## Phase 5a.5 — Projection Builder Interface
**Date**: 2026-07-30  
**Branch**: `main`  
**Status**: ✅ Complete

### What Changed
- Created `src/domain/builders.ts` and defined the `ICandidateProjectionBuilder` interface.
- Updated `src/lib/intelligence/builders/CandidateProjectionBuilder.ts` to export `CandidateProjectionBuilderImpl` that implements the new interface via `.fromDatabase()`.
- Updated `src/lib/intelligence/engine.ts` and `src/lib/intelligence/opportunity-provider.ts` to instantiate and use `CandidateProjectionBuilderImpl.fromDatabase(candidateProfile)`.

### Verified
- `npx tsc --noEmit` runs completely clean with no type errors.

---

---

## Phase 5b — DB Migration & Persistence
**Date**: 2026-07-30  
**Branch**: `main`  
**Status**: ✅ Complete

### What Changed
- Created `009_profile_queryable_columns.sql` to establish the `career_profiles` table storing `projection_json`.
- Refactored `SqlitePersonStore.ts` with `saveProjection` and `getLatestProjection`.
- Executed `scripts/migrate-profile-to-db.ts` to transition golden candidate profile into Turso.

---

## Phase 5c — Service Layer & Async Loaders
**Date**: 2026-07-30  
**Branch**: `main`  
**Status**: ✅ Complete

### What Changed
- Created `src/lib/intelligence/opportunity-service.ts` as the primary application service boundary.
- Created `src/lib/intelligence/opportunity-server.ts` providing TanStack Start transport adapters.
- Refactored UI routes (`index.tsx`, `opportunity.$jobHash.tsx`, `decisions.tsx`, `qa.mapping.tsx`) to use async loaders.
- Deprecated `OpportunityProvider` with JSDoc `@deprecated` flags.

---

## Phase 6 — Evidence Extraction Engine & Projection Pipeline
**Date**: 2026-07-30  
**Branch**: `main`  
**Status**: ✅ Complete

### What Changed
- Added ADR-011: Evidence is Immutable (`docs/ARCHITECTURE_DECISIONS.md`).
- Created `src/domain/evidence.ts` declaring `ExtractedFact`, `EvidenceGraph`, and `ExtractionProvenance` schemas.
- Added migration `010_candidate_documents_and_evidence.sql` and `SqliteDocumentStore.ts` for candidate document metadata and evidence graph persistence.
- Implemented `EvidenceExtractionService.ts` for LLM-based factual evidence extraction.
- Implemented `EvidenceNormalizer.ts` and `OntologyResolver.ts` for deterministic acronym expansion and V4 Capability mapping.
- Refactored `CandidateProjectionBuilderImpl.ts` and created `OperatingLevelEngine.ts` to infer operating level/altitude cleanly.
- Implemented `ProjectionPipeline.ts` as a resumable stage-based orchestrator (`DOCUMENT_UPLOADED` -> `COMPLETED`).
- Added end-to-end integration test `scripts/test-projection-pipeline.ts`.

### Verified
- `npx tsx scripts/test-projection-pipeline.ts` completed cleanly with full stage execution against Turso.
- `npx tsc --noEmit` clean.
- `npm run test:eqe` passes 100%.

---

## Phase 7 — UI Document Upload Gateway, Versioned Intent & Live Integration
**Date**: 2026-07-30  
**Branch**: `main`  
**Status**: ✅ Complete

### What Changed
- Added `ADR-012: Intent is Explicit and Independent` (`docs/ARCHITECTURE_DECISIONS.md`).
- Applied migration `011_document_contents_and_intent.sql` to Turso DB separating `document_contents` (storing `raw_text` & `text_hash`) from document metadata, and creating versioned `career_intents`.
- Created `src/lib/intelligence/extraction/text-parser.ts` to compute SHA-256 `textHash` over extracted resume text.
- Enhanced `ProjectionPipeline.ts` with instant `text_hash` deduplication and refined stages (`DOCUMENT_REGISTERED` -> `COMPLETED`).
- Created `src/lib/intelligence/document-server.ts` providing non-blocking fire-and-forget transport adapters (`uploadDocumentFn`, `getPipelineStatusFn`, `saveIntentFn`, `getLatestIntentFn`).
- Built `src/routes/profile.tsx` featuring drag-and-drop resume upload, live pipeline stage stepper, and versioned `IntentSettingsPanel`.

### Verified
- `npx tsc --noEmit` passed cleanly.
- `npm run build` passed in 9.54s (Nitro + Vite SSR).

---

## Phase 8 — Live Scraper Orchestration, Audit Lineage & System Hardening (Final Phase)
**Date**: 2026-07-30  
**Branch**: `main`  
**Status**: ✅ Complete (Platform Freeze)

### What Changed
- Created `src/lib/intelligence/EvaluationCoordinator.ts` as the central event-driven trigger for recommendation refreshes (`CORPUS_UPDATED`, `PROJECTION_UPDATED`, `INTENT_UPDATED`, `ONTOLOGY_UPGRADED`).
- Decoupled scraping and upload transport adapters from evaluation execution logic.
- Created `scripts/audit-phase8-lineage.ts` to assert 5 core structural invariants in Turso Cloud SQLite (Projection, Evidence, Document Content, Decision, Career Intent).
- Verified full live scraper pipeline integration with Turso storage providers.

### Verified
- `npx tsx scripts/audit-phase8-lineage.ts`: **5/5 Invariants PASSED** (0 Failed).
- `npx tsc --noEmit`: Clean static type compilation.
- `npm run test:eqe`: **100% Certified** across all 4 extractors and policy calibration suites.
- `npm run build`: Production Nitro + Vite SSR build completed in **6.75s**.



