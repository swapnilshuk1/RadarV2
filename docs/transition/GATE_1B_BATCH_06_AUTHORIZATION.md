# GATE_1B_BATCH_06 — Extraction Architecture Implementation & Blind Pre-Certification

## 1. Batch Identity & Governance Context

- **Gate**: `GATE_1B` (Substrate, Provenance, and Extraction Architecture Decision)
- **Batch ID**: `GATE_1B_BATCH_06`
- **Title**: `Extraction architecture implementation & blind pre-certification`
- **Scope Revision**: `1`
- **Status**: `ACTIVE`
- **Preceding Batch**: `GATE_1B_BATCH_05` (`CLOSED`, Architecture Decided, Evaluator Provenance Resolved)
- **Extraction Architecture Decision**: `DECIDED`
  - **Role**: `ASYMMETRIC_HYBRID_RICH_PROPOSITION_VERIFIED`
  - **Candidate**: `DETERMINISTIC_FOR_CURRENT_TRANSITION`
- **Governing Runbook**: `docs/transition/GATE_1B_BATCH_06_VALIDATION_RUNBOOK.md`

---

## 2. Program Execution Model: Unified Program for Steps 1–5

In accordance with transition governance, **Batch 06 executes as a single governed program**, not fragmented into multiple micro-approval gates. The executing agent is authorized to implement Steps 1 through 5 uninterrupted until either the pre-registered blind validation test passes or an explicit stop condition fires:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Reconcile, commit, and SHA-256 lock production evaluator.               │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: Implement & freeze Verifier and Structural Admission Engine.           │
│         - HighRiskSemanticVerifier                                              │
│         - StructuralAdmissionEngine                                             │
│         - AsymmetricHybridRoleExtractor                                         │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Assemble, adjudicate blind reference truth, dual-review, and hash lock. │
│         - ≥ 50 role JDs (30 fresh + 20 adversarial)                             │
│         - 15–20 resumes                                                         │
│         - Strict blind adjudication (zero model output visibility)              │
│         - Dual human review on high-risk & negative constraints                │
│         - Commit SHA-256 fixture hashes to repository                           │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: Confirm pre-registered threshold freeze.                                │
│         - 0 high-risk false affirmatives (zero tolerance)                       │
│         - 0 polarity inversions (zero tolerance)                                │
│         - 0 applicability boundary leaks (zero tolerance)                       │
│         - 100% candidate span provenance (zero tolerance)                       │
│         - ≥ 50.0% typed recall                                                  │
│         - ≥ 90.0% candidate metric token fidelity & chronology binding          │
│         - P95 latency ≤ 15.0s (ingestion SLO)                                   │
│         - Cost ≤ $0.04 / doc (operational budget SLO)                           │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: Run once, score once.                                                   │
│         - Pre-run verification of fixture hashes                                │
│         - Single blind execution pass + concurrent deterministic baseline dual  │
│         - Evaluate against frozen truth using locked evaluator                  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ CHECKPOINT BOUNDARY: Production Shadow Mode Approval                            │
│ - If Step 5 PASSES: Halt. Present validation certification report. Request      │
│   governance approval before Step 6 (shadow mode deployment on live scrape).   │
│ - If ARCHITECTURE-FALSIFYING failure: Halt immediately. Report falsification.   │
│ - If IMPLEMENTATION-TUNABLE failure: Execute single permitted remediation cycle.│
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Allowed Paths & Scope Boundaries

### Allowed Path Prefixes:
- `AGENTS.md`
- `docs/`
- `scripts/transition/`
- `src/lib/intelligence/extraction/`
- `src/lib/intelligence/candidate/`
- `src/lib/intelligence/shared/`
- `fixtures/`
- `audit-reports/gate1b-batch06/`
- `.github/workflows/transition-control.yml`
- `.github/CODEOWNERS`
- `package.json`

### Strictly Forbidden in Batch 06:
- Gate 1B hard-forbidden paths:
  - `src/lib/intelligence/engines/`
  - `src/lib/intelligence/policy/`
  - `src/lib/intelligence/editorial/`
  - `src/lib/intelligence/dossier/`
  - `src/lib/intelligence/evaluation/`
  - `src/lib/intelligence/rematerialization/`
  - `src/lib/intelligence/EvaluationWorker.ts`
  - `src/lib/intelligence/engine.ts`
  - `src/lib/intelligence/serving/`
  - `src/lib/opportunity`
  - `src/routes/`
  - `src/data/sqlite/repositories/SqliteDossierPresentationStore.ts`
  - `src/data/sqlite/repositories/SqliteEvaluationStore.ts`
  - `src/data/sqlite/repositories/SqliteMaterializedEvaluationStore.ts`
  - `src/data/sqlite/repositories/SqliteOpportunityQueries.ts`
- Altering reference truth fixtures after observing model outputs.
- Modifying the evaluator after locking hashes in Step 1.
- Executing Step 6 (shadow mode on live production scrapers) without deliberate governance review and approval.

---

## 4. Governance & Acknowledgement Rules

Every committed implementation change touching non-governance paths must be recorded in `docs/transition/IMPLEMENTATION_LEDGER.json` with exact commit SHA, verified invariants, and passing `npx tsc -p tsconfig.verify.json --noEmit` checks.
All changes must satisfy `npm run transition:check`.
