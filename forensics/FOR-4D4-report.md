# FOR-4D4 — POST-EVALUATION SERVING SEMANTICS & HOMESCREEN RECONCILIATION REPORT

## Diagnostic Summary
A comprehensive read-only audit of the RADAR V4 homescreen metrics was conducted following the FOR-4D3 evaluation of the 904 backlog opportunities. Every visible number on the homescreen has been traced directly to its underlying relational source and formula.

---

## 1. Frozen Database Baseline
- **Canonical Opportunities**: 3,035
- **Active Candidate Opportunities**: 3,002 (`search_plan_candidates` with `attention_decision = 'CANDIDATE'`)
- **Materialized Evaluations**: 2,854
- **Canonical Decisions**: 1,509 (1,498 active candidate user decisions)
- **Evaluation Jobs**: 3,204

---

## 2. Reconciled Population Matrix (3,002 Served Opportunities)
- **HISTORICAL_RESTORED**: 1,498
- **FOR4C_HYDRATED**: 600
- **FOR4D3_EVALUATED_PURSUE**: 12
- **FOR4D3_EVALUATED_CONSIDER**: 221
- **FOR4D3_EVALUATED_PASS**: 198
- **FOR4D3_SPARSE_SPEC**: 473
- **OTHER**: 0
- **Total Sum**: 3,002 (Exact mutually exclusive coverage)

---

## 3. Discrepancy Reconciliation Results

### A. ALL (1504)
- **Formula**: `totalScreened (3002) - totalDecisions (1498) = 1504`
- **Meaning**: Represents all unreviewed active candidates that do not have a recorded user action in `canonical_decisions`.
- **Status**: **100% CORRECT**.

### B. 487 SHORTLISTED
- **Formula**: Pre-FOR-4D3 shortlisted count was 487. Post-FOR-4D3 canonical shortlist metric is `487 + 233 (FOR-4D3 recommendations) = 720`.
- **Meaning**: The browser tab displayed 487 due to a stale client route/loader cache prior to page refresh.
- **Status**: **EXPLAINED (STALE CLIENT CACHE)**.

### C. NEEDS MORE SIGNAL (639 / 639)
- **Formula**: `166 historical/FOR-4C sparse + 473 FOR-4D3 sparse = 639 total SPARSE_SPEC opportunities`.
- **Meaning**: Represents all opportunities whose evaluation state is `SPARSE_SPEC`. Zero leakage into decision or shortlist categories.
- **Status**: **100% CORRECT & ORTHOGONAL**.

### D. "All 487 shortlist opportunities have recorded decisions"
- **Formula**: `totalShortlisted (487) > 0 && shortlistedOps.length === 0`.
- **Meaning**: Rendered because in the pre-FOR-4D3 stale cache state, all 487 historical shortlisted items already had user decisions recorded in `canonical_decisions`.
- **Status**: **EXPLAINED (STALE CLIENT CACHE)**.

### E. 1498 DECISIONS & 308 ACTIVE PURSUITS
- **Formula**: Explicit user actions in `canonical_decisions`.
- **Meaning**: Exactly 1,498 active candidates have user decisions, of which 308 are PURSUE actions. FOR-4D3 engine recommendations did NOT alter user decisions.
- **Status**: **100% CORRECT & PROTECTED**.

---

## Zero Mutation Certification
- Database Mutations: 0
- Code Mutations: 0
- LocalStorage Mutations: 0
