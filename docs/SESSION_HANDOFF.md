# RADAR v2 — Session Handoff

**Overwrite this file at the end of every working session.**
Any AI model reads this + `AGENTS.md` + `docs/ARCHITECTURE_DECISIONS.md` to
reconstruct full context in under 5 minutes.

---

## Current Status

**Last Updated**: 2026-07-30  
**Active Branch**: `main`  
**Completed Roadmap**: ALL PHASES COMPLETE (Phases 0 through 8)  
**Status**: 🚀 **RADAR v2 Core Platform Freeze & Production Certified**

---

## Post-Platform Roadmap — Three Independent Evolutionary Tracks

With the core platform foundation complete and frozen, future work naturally branches into three decoupled, parallel tracks:

### Track A — Intelligence Quality
- **Ontology**: Expand `CapabilityRegistry` and `TechnologyOntology` mappings.
- **Inference**: Refine `OperatingLevelEngine` and work nature classification.
- **Evidence Extraction**: Tune Groq LLM prompt versions and extraction schemas (ADR-011).
- **Recommendation Quality**: Calibrate policy weights (`run-policy-calibration.ts`).

### Track B — Product Experience & Headspace
- **Dashboards**: Enhance `/` shortlist, `/scraped`, and `/decisions` views.
- **Coaching & Explainability**: Add interactive reasoning chain inspector and decision rationale briefs.
- **Workflows**: Multi-device sync and executive application tracking.

### Track C — Scale & Observability
- **Acquisition Throughput**: Parallel portal scrapers (`LinkedIn`, `Naukri`, `Workday`).
- **Caching & Indexing**: Optimize Turso DB query indices and text hash lookups.
- **Observability**: Metrics dashboard for extraction accuracy and pipeline latency.

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
