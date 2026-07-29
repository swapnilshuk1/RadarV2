# RADAR v2 — Session Handoff

**Overwrite this file at the end of every working session.**
Any AI model reads this + `AGENTS.md` + `docs/ARCHITECTURE_DECISIONS.md` to
reconstruct full context in under 5 minutes.

---

## Current Status

**Last Updated**: 2026-07-29  
**Active Branch**: `feature/phase-0-documentation`  
**Completed Phases**: Phase 0 (documentation)  
**In Progress**: Phase 1 — Schema Repair  

---

## Next Task

> Copy-paste this as your first message to any new AI session:

```
You are continuing work on RADAR v2 — Executive Job Intelligence Radar.

Read these files FIRST, in order, before doing anything:
1. AGENTS.md                          — architecture rules and invariants (MANDATORY)
2. docs/ARCHITECTURE_DECISIONS.md     — 10 immutable ADRs (MANDATORY)  
3. docs/SESSION_HANDOFF.md            — where we left off (this file)
4. docs/IMPLEMENTATION_LOG.md         — decisions made so far

Current task: Execute Phase 1 — Schema Repair.
Create src/data/sqlite/migrations/006_recreate_decisions.sql to recreate the
decisions table that was dropped by migration 002. Use CREATE TABLE IF NOT EXISTS
for safety. Apply migration to Turso. Confirm the 38 existing decisions 
(person_id: "swapnil-shukla") are still present after migration.
Then move to Phase 2 — Google OAuth.
```

---

## Open Items / Blockers

1. **Google Cloud Console** — OAuth 2.0 credentials not yet created. Before Phase 2:
   - Create project at console.cloud.google.com
   - Enable Google OAuth 2.0 API
   - Create OAuth Client ID (Web Application)
   - Add redirect URIs: `http://localhost:3000/api/auth/callback` and Render URL
   - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and Render dashboard

2. **`LUCIA_SECRET`** — Generate a random 32-character secret and add to `.env`

---

## Architecture Reminders

- Engine must be a **pure function** (ADR-001) — no I/O, no clock, no env, no randomness
- All ingestion paths produce `CandidateProjection` via `ICandidateProjectionBuilder` (ADR-004)
- `decisions` table exists but was dropped by migration 002 — Phase 1 recreates it
- Your Google account: `swapnilshuk@gmail.com` (DB already updated)
- Your existing `person_id`: `"swapnil-shukla"` (38 decisions, all safe in Turso)

---

## Key File Locations

| What | Where |
|:---|:---|
| Golden profile backup | `src/data/candidate-profile.backup.json` |
| Domain entities | `src/domain/entities.ts` |
| Candidate types (new) | `src/domain/candidate.ts` (Phase 5a — not yet created) |
| Builder interface (new) | `src/domain/builders.ts` (Phase 5a.5 — not yet created) |
| Engine | `src/lib/intelligence/engine.ts` |
| Identity engine | `src/lib/intelligence/identity-engine.ts` |
| Decisions server | `src/lib/intelligence/decisions-server.ts` |
| Decisions store (client) | `src/lib/decisions-store.ts` |
| Profile server | `src/lib/intelligence/profile-server.ts` |
| Migrations | `src/data/sqlite/migrations/` |
| Auth (new) | `src/lib/auth/` (Phase 2 — not yet created) |

---

## Test Baseline (from npm run test:eqe — establish before Phase 3)

*Record exact EQE scores here after running npm run test:eqe on clean main*

```
[Run npm run test:eqe and paste scores here before Phase 3 begins]
```
