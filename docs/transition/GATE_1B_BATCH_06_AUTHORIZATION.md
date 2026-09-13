# GATE_1B_BATCH_06 — Extraction Architecture Implementation & Blind Pre-Certification

## 1. Batch Identity & Governance Context

- **Gate**: `GATE_1B` (Substrate, Provenance, and Extraction Architecture Decision)
- **Batch ID**: `GATE_1B_BATCH_06`
- **Title**: `Extraction architecture implementation & blind pre-certification`
- **Scope Revision**: `2`
- **Status**: `ACTIVE`
- **Preceding Batch**: `GATE_1B_BATCH_05` (`CLOSED`, Architecture Decided, Evaluator Provenance Resolved)
- **Scope Revision Record**: `docs/transition/GATE_1B_BATCH_06_SCOPE_REVISION_2.md`
- **Extraction Architecture Decision**: `DECIDED`
  - **Role**: `ASYMMETRIC_HYBRID_RICH_PROPOSITION_VERIFIED`
  - **Candidate**: `DETERMINISTIC_FOR_CURRENT_TRANSITION`
- **Governing Runbook**: `docs/transition/GATE_1B_BATCH_06_VALIDATION_RUNBOOK.md`

---

## 2. Program Execution Model: Unified Program for Steps 1–5

In accordance with transition governance, **Batch 06 executes as a single governed program**, not fragmented into multiple micro-approval gates. The executing agent is authorized to implement Steps 1 through 5 uninterrupted until either the pre-registered blind validation test passes or an explicit stop condition fires:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Commit and SHA-256 lock new production evaluator (evaluator-batch06.ts).│
│         - scripts/transition/evaluator-v2.ts & evaluator-r2.ts are IMMUTABLE.   │
│         - Batch 06 creates a new evaluator artifact from frozen error taxonomy. │
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
│ STEP 3: Assemble, Human Adjudicate, Dual-Review, and Hash Lock Holdouts.       │
│         - HUMAN TRUTH BOUNDARY: Agent packages sources and prepares blank       │
│           templates; agent MUST NOT author/adjudicate reference truth.          │
│         - Independent human reviewers provide truth with ZERO model visibility. │
│         - Mandatory dual human review on high-risk facts & negative boundaries. │
│         - If human truth is unavailable, agent STOPS at adjudication boundary.  │
│         - PRIMARY SET: ≥50 roles (30 natural + 20 adversarial) + 15–20 resumes. │
│         - SECONDARY SET: Disjoint holdout, independently adjudicated, sealed.   │
│         - SHA-256 hashes for BOTH sets committed before any pipeline execution. │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: Confirm pre-registered threshold freeze & failure semantics.           │
│         - 0 high-risk false affirmatives (zero tolerance)                       │
│         - 0 polarity inversions (zero tolerance)                                │
│         - 0 applicability boundary leaks (zero tolerance)                       │
│         - 100% candidate span provenance (zero tolerance)                       │
│         - ≥ 50.0% typed recall                                                  │
│         - ≥ 90.0% candidate metric token fidelity & chronology binding          │
│         - P95 latency ≤ 15.0s (ingestion SLO)                                   │
│         - Cost ≤ $0.04 / doc (operational budget SLO)                           │
│         - Failure Semantics: Fatal safety failure halts certification and      │
│           requires architecture review; does not automatically disprove class.  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: Run once, score once.                                                   │
│         - Pre-run verification of fixture hashes                                │
│         - Single blind execution pass on Primary Set + baseline dual run        │
│         - Evaluate against frozen truth using locked Batch 06 evaluator         │
│         - Secondary holdout opened ONLY if permitted tunable remediation needed │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ CHECKPOINT BOUNDARY: Production Shadow Mode Approval                            │
│ - If Step 5 PASSES: Halt. Present validation certification report. Request      │
│   governance approval before Step 6 (shadow mode deployment on live scrape).   │
│ - If FATAL SAFETY FAILURE: Halt immediately. Step 5 = FAIL. Require            │
│   architecture review before any promotion or rerun.                            │
│ - If IMPLEMENTATION-TUNABLE failure: Execute single permitted remediation cycle │
│   on pre-frozen secondary holdout. Never tune and re-test on primary set.       │
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
- Modifying historical evaluator artifacts (`scripts/transition/evaluator-v2.ts`, `evaluator-r2.ts`).
- Modifying historical audit reports outside `audit-reports/gate1b-batch06/`.
- Implementation agent authoring, synthesizing, or self-adjudicating reference truth.
- Altering reference truth fixtures after observing model outputs.
- Retesting or tuning on the primary set after observing test failures.
- Modifying the evaluator after locking hashes in Step 1.
- Executing Step 6 (shadow mode on live production scrapers) without deliberate governance review and approval.

---

## 4. Governance & Acknowledgement Rules

Every committed implementation change touching non-governance paths must be recorded in `docs/transition/IMPLEMENTATION_LEDGER.json` with exact commit SHA, verified invariants, and passing `npx tsc -p tsconfig.verify.json --noEmit` checks.
All changes must satisfy `npm run transition:check`.
