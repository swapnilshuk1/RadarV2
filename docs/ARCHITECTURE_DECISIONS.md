# RADAR v2 — Architecture Decision Records (ADRs)

These decisions are **immutable**. Once an ADR is written and committed, it is never
edited. If a decision changes, a new ADR is added that supersedes the old one by reference.
AI agents must read this file before making any architectural changes.

---

## ADR-001: Engine is a Pure Function

**Status**: Active  
**Date**: 2026-07-29

### Decision
The Evaluation Engine (`engine.ts`, `DeterministicScorer`, `V3EvaluationEngine`,
and all assessment engines) must be a **pure function** in the strict computer
science sense:

```
f(CandidateProjection, JobProjection[]) → RecommendationResult[]
```

### Constraints — The Engine:
- ❌ **Cannot perform I/O** — no file reads, no network calls, no DB queries
- ❌ **Cannot read the system clock** — no `Date.now()`, no `new Date()`
- ❌ **Cannot read environment variables** — no `process.env.*`
- ❌ **Cannot generate randomness** — no `Math.random()`, no `crypto.randomUUID()`
- ❌ **Cannot mutate its inputs** — `CandidateProjection` and `JobProjection` are frozen
- ❌ **Cannot maintain hidden state** — no module-level variables that affect output between calls
- ✅ **Must return identical outputs for identical inputs** — always, on any machine, at any time

### Rationale
Regression testing becomes trivial. Given a saved `CandidateProjection` and a saved
`JobProjection[]`, the score for any opportunity must be deterministically reproducible.
Score drift is immediately detectable. Historical recommendations are fully explainable.

### Violation to Fix
`engine.ts` line 28 currently imports `candidateProfile` as a module-level global.
This is an ADR-001 violation. Phase 3 of the implementation plan fixes it.

---

## ADR-002: Opportunity Corpus is Global; Decisions are User-Scoped

**Status**: Active  
**Date**: 2026-07-29

### Decision
Scraped job opportunities are **system-wide data** shared by all users.
The `opportunities` table intentionally has no `user_id` column.

What IS user-scoped: `decisions`, `recommendations`, `assessments`, `matches`, `intent`.

### Rationale
One scraper run feeds all users efficiently. Per-user scoring and intent filtering
is applied at the recommendation layer, not at the data ingestion layer.

---

## ADR-003: Projections are Immutable Value Objects

**Status**: Active  
**Date**: 2026-07-29

### Decision
`CandidateProjection` and `JobProjection` are frozen value objects.
The engine must never mutate them. Builders are the sole construction authority.

After construction, projections should be treated as `Readonly<CandidateProjection>`.

---

## ADR-004: All Profile Ingestion Paths Must Produce an Identical Projection Shape

**Status**: Active  
**Date**: 2026-07-29

### Decision
Whether the source is a resume upload, LinkedIn import, manual profile edit,
database load, or API import — the output must always be a valid `CandidateProjection`.

The `ICandidateProjectionBuilder` interface (Phase 5a.5) enforces this contract.
No ingestion path may bypass the builder and hand raw data directly to the engine.

### Rationale
Without a formal builder contract, each ingestion path develops its own ad-hoc
transformation logic. They diverge. The engine receives subtly different shapes.
Scores vary for the same person depending on how their profile was loaded.

---

## ADR-005: Evidence Must Always Map to Ontology Capabilities

**Status**: Active  
**Date**: 2026-07-29

### Decision
Raw evidence (from resume or JD text) is only meaningful after it is classified
against the canonical ontology. `KnowledgeGraphBuilder` is the **sole classification
authority**. No other module may perform capability matching directly against raw text.

---

## ADR-006: Ontology IDs Are Permanent

**Status**: Active  
**Date**: 2026-07-29

### Decision
Once a capability, dimension, or ontology term is assigned an ID, that ID is
**permanent**. Renaming or removing IDs breaks historical recommendation traceability.

Rule: **Add new IDs; never rename or remove existing ones.**

---

## ADR-007: All User-Specific Persistent State Goes Through DatabaseAdapter

**Status**: Active  
**Date**: 2026-07-29

### Decision
No module may introduce a parallel persistence mechanism (flat JSON files for
user data, cross-request in-memory globals, external caches) for user-specific
data.

**Exception**: `.scraper-artifacts/` is explicitly ephemeral and corpus-level,
not user-scoped. It is acceptable as a temporary local cache.

---

## ADR-008: Authentication Does Not Bleed Into Business Logic

**Status**: Active  
**Date**: 2026-07-29

### Decision
The auth layer resolves an `AuthenticatedUser` at the route/middleware boundary
(TanStack Router `beforeLoad` or server function wrapper).

Repositories and the engine receive a plain `userId: string` only.
They **never** call lucia, read cookies, or reference sessions internally.

### Correct Pattern
```
Route beforeLoad (resolves AuthenticatedUser from session cookie)
    ↓
Server Function (receives userId from context)
    ↓
Repository (parameterized by userId)
    ↓
Engine (receives CandidateProjection — knows nothing about auth)
```

---

## ADR-009: Every Recommendation References Its Full Provenance

**Status**: Active  
**Date**: 2026-07-29

### Decision
Every row written to `recommendations` and `recommendation_snapshots` must record:
- `profile_version` — which version of the candidate profile was used
- `engine_version` — which version of the scoring engine ran
- `ontology_version` — which version of the capability ontology was applied
- `model` — which LLM model produced any LLM-derived fields
- `prompt_version` — which prompt template was used

### Rationale
Enables full historical explainability: "Why did RADAR tell me to PASS on BMW
6 months ago?" can be answered with a complete audit trail.

---

## ADR-010: Migrations Are Append-Only

**Status**: Active  
**Date**: 2026-07-29

### Decision
Historical SQL migration files (`001_` through `N_`) are **never edited** after
they are committed and applied. Corrections are made via new numbered migrations only.

This ensures any fresh database can be bootstrapped to the current schema by
replaying all migrations in sequence.

---

## ADR-011: Evidence is Immutable

**Status**: Active  
**Date**: 2026-07-30

### Decision
Evidence graphs (`EvidenceGraph`) represent a point-in-time extraction from a source document. Once generated, they are **never edited in place**. Any corrections, re-extractions (due to improved prompts or models), or updates result in a *new* version of the `EvidenceGraph` being created.

### Rationale
This preserves data lineage and enables perfect auditability. By making evidence immutable, a downstream `CandidateProjection vX` can always be traced back to its exact `EvidenceGraph vY`, which points to the exact document and extraction logic used at that moment.

---

## ADR-012: Intent is Explicit and Independent

**Status**: Active  
**Date**: 2026-07-30

### Decision
Candidate Intent (`CareerIntent` — target salary minimum, target locations, target titles, work shift preferences) is **strictly explicit and human-configured**. Intent must **never be inferred or assumed** from historical resume evidence or CV documents.

### Rationale
A resume represents past accomplishments; intent represents future aspirations. Inferring desired salary or location from historical roles creates dangerous biases and breaks the executive's control over their career trajectory. Evidence belongs to documents; intent belongs to the human.

---

## Supersession Log

| Superseded ADR | Superseded By | Date | Reason |
|:---|:---|:---|:---|
| *(none yet)* | | | |
