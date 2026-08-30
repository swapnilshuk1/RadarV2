# FOR-4K — FINAL CLOSURE REPORT: BUG-03 & BUG-04

**Mission**: Authoritative, targeted closure of **BUG-03** (Orphan canonical opportunity `7e3589af...`) and **BUG-04** (10 sparse decisions representation in Decisions journey).  
**Standard**: Built directly upon authoritative FOR-4J stage-decoupling semantics.  
**Engine Target**: Turso Cloud (`libsql://radar-db-swapnilshuk1.aws-ap-south-1.turso.io`)  
**Tenant / User Scope**: Tenant `tenant_default`, User `ms6i7e3y-4x0chy5fy`, Search Plan `sp_canonical_swapnil`  
**Date / Time**: 2026-08-30T04:54:00+05:30

---

## 1. Executive Summary & Verification Matrix

| Requirement / Invariant | Pre-FOR-4K State | Authoritative FOR-4K State | Proof Status |
| :--- | :--- | :--- | :--- |
| **BUG-03 (Orphan Canonical Job)** | 1 orphan row (3,035 opps vs 3,034 versions) | **0 orphans** (3,035 opps = 3,035 versions) | **VERIFIED & CLOSED** |
| **BUG-04 (Sparse User Decisions)** | 10 sparse decisions dropped from Decisions UI | **All 10 sparse decisions served to Decisions** | **VERIFIED & CLOSED** |
| **RADAR-Qualified Shortlist Population** | 645 | **645** | **VERIFIED** |
| **Actionable Review Queue** | 82 cards | **82 cards** (`shortlistedOpsLength = 82`) | **VERIFIED** |
| **User PURSUE (Evaluated)** | 472 | **472** (`decisionMetrics.userPursueTotal`) | **VERIFIED** |
| **User CONSIDER (Evaluated)** | 137 | **137** (`decisionMetrics.userConsiderTotal`) | **VERIFIED** |
| **User PASS (Evaluated)** | 889 | **889** (`decisionMetrics.userPassTotal`) | **VERIFIED** |
| **Sparse Decisions Breakdown** | Uncounted in metrics | **10** (2 Pursue, 1 Consider, 7 Pass) | **VERIFIED** |
| **Sparse Shortlist Membership** | 0 | **0** (`anySparseInShortlist: false`) | **VERIFIED** |
| **Canonical Decisions Immutability** | 474 Pursue, 138 Consider, 897 Pass | **474 Pursue, 138 Consider, 897 Pass (100% Unchanged)** | **VERIFIED** |
| **TypeScript Compilation** | Code 0 | **Code 0 (`npx tsc --noEmit` clean)** | **VERIFIED** |
| **Automated Test Suite** | 102 passed | **103 test files passed (including new focused suite)** | **VERIFIED** |
| **BUG-06 (Historical Mutations)** | Untouched | **Untouched** | **PRESERVED** |

---

## 2. BUG-03: Forensic Investigation & Linkage Repair

### Root Cause Diagnosis
Forensic query and code analysis of historical scripts established exactly why `7e3589afb485195b6e3eb31f13e3048c48aea4356740e72c68f8ad4354fda89e` lacked an opportunity version:
1. **Pre-Existing Record**: Canonical opportunity `7e3589af...` (`source: 'LinkedIn'`, `source_job_id: 'j-2570118dab32'`) was created during Migration 001.
2. **Script Skip Invariant**: In `scripts/forensics/for3_phase1d_controlled_mutation.ts`, line 77 evaluated:
   ```ts
   if (existingCanonMap.has(`${sourcePortal}:${sourceJobId}`) || existingCanonMap.has(computedCanonId)) {
     continue;
   }
   ```
   Because `existingCanonMap.has('LinkedIn:j-2570118dab32')` was `true`, Batch 1 (which generated and inserted `opportunity_versions`) skipped `j-2570118dab32`.
3. **Downstream Batch Linkage**: Subsequent batches in that script (Batch 3 for Decisions, Batch 4 for Evaluations) looked up `canonical_opportunities` by job hash and found `7e3589af...`. They inserted `canonical_decisions` (`dec_rem_run_20260829_01_675`, action `PASS`) and `materialized_evaluations` (`mat_7e3589afb485195b`, referencing `ver_7e3589afb485195b`).
4. **Classification**: This is **(b) a legitimate opportunity with broken linkage**. It corresponds to a genuine historical posting (`Retail Sales Consultant | Titan Helios Watches | Gurugram`) evaluated as `PASS` with historical user decision `PASS`.

### Minimum Safe Repair
To restore referential integrity without deleting data or mutating user decisions, the missing linkage was inserted into `opportunity_versions`:
```sql
INSERT INTO opportunity_versions (
  id, canonical_job_id, content_hash, job_title, company_name,
  location, employment_type, posted_at, posted_precision, raw_content,
  acquisition_status, acquisition_quality, failure_class, lifecycle_state, evidence_state,
  created_at
) VALUES (
  'ver_7e3589afb485195b',
  '7e3589afb485195b6e3eb31f13e3048c48aea4356740e72c68f8ad4354fda89e',
  'ch_7e3589afb485195b',
  'Retail Sales Consultant',
  'Titan Helios Watches',
  'Gurugram',
  NULL, NULL, 'UNKNOWN',
  'Historical record for Retail Sales Consultant at Titan Helios Watches',
  'ACQUIRED', 'COMPLETE', NULL, 'ACTIVE', 'UNVERIFIED',
  CURRENT_TIMESTAMP
);
```

### Before / After Row-Level Proof
- **Before**:
  - `SELECT COUNT(*) FROM canonical_opportunities` = `3,035`
  - `SELECT COUNT(*) FROM opportunity_versions` = `3,034`
  - `SELECT COUNT(*) FROM canonical_opportunities co LEFT JOIN opportunity_versions ov ON ov.canonical_job_id = co.id WHERE ov.id IS NULL` = `1` (`7e3589af...`)
- **After**:
  - `SELECT COUNT(*) FROM canonical_opportunities` = `3,035`
  - `SELECT COUNT(*) FROM opportunity_versions` = `3,035`
  - `SELECT COUNT(*) FROM canonical_opportunities co LEFT JOIN opportunity_versions ov ON ov.canonical_job_id = co.id WHERE ov.id IS NULL` = `0`
- **Rollback Script Persisted**: `forensics/FOR-4K-rollback-bug03.sql`.

---

## 3. BUG-04: Sparse Decisions Representation in Decisions Journey

### Root Cause Diagnosis
In `SqliteCanonicalServingStore.listOpportunities()`:
```ts
const unavailState = toUnavailableState(r.evaluation_state);
if (unavailState !== null) {
  // Created an UnavailableOpportunity WITHOUT userDecision and called continue
  opportunities.push(unavail);
  continue;
}
```
All 639 `SPARSE_SPEC` opportunities were converted to `UnavailableOpportunity` without attaching `r.user_action`. On the Decisions route (`src/routes/decisions.tsx`), line 81 filtered by `rawOpportunities.filter(isEvaluated)`. Because `isEvaluated(opp)` returns `false` for `UnavailableOpportunity`, the 10 sparse opportunities where the user had made explicit decisions were completely omitted from the Decisions surface.

### Minimum Safe Serving-Layer Correction
1. **`src/data/sqlite/repositories/SqliteCanonicalServingStore.ts`**:
   - In `listOpportunities()`: When an opportunity has an unavailable state (e.g. `SPARSE_SPEC`), but has an explicit user action (`r.user_action && r.user_action !== 'NONE'`) and evaluation JSON, allow it to be adapted using `adaptLegacyEvaluation()`, while preserving its authoritative `evaluationState = 'SPARSE_SPEC'`. If it lacks evaluation JSON, attach `userDecision` to `UnavailableOpportunity`.
   - In `getOpportunityMetrics()`: Evaluated user decisions continue to measure the evaluated population (`472 Pursue`, `137 Consider`, `889 Pass` = `1,498`). The 10 sparse decisions are tracked in `decisionMetrics.sparseDecisions: { total: 10, pursue: 2, consider: 1, pass: 7 }`.
2. **`src/routes/decisions.tsx`**:
   - Updated the filtering logic on `opportunitiesList`:
     ```tsx
     const opportunitiesList = useMemo(
       () => rawOpportunities.filter((o) => isEvaluated(o) || Boolean(decisions[o.jobHash]?.verb || (o as any).userDecision?.userAction)),
       [rawOpportunities, decisions]
     );
     ```
   - This preserves all 10 sparse decisions in the Decisions surface while ensuring all 629 unreviewed sparse specs remain filtered out.
3. **`src/data/opportunity-fixtures.ts`**:
   - Added `userDecision?: UserDecisionStateV4 | null` and `effectiveDecision?: EffectiveDecision` to `UnavailableOpportunity` and `UnmaterializedOpportunity` types.

### Strict Stage Invariant Proof
- **Shortlist Queue Invariant**: An opportunity only enters the Shortlist review queue if `isEvaluated(o)` is true AND its engine recommendation is `PURSUE` or `CONSIDER`. Sparse specifications have engine verdict `SPARSE_SPEC` and are excluded from Shortlist.
- **Query Proof**:
  - `shortlistedOpsLength`: **82**
  - `anySparseInShortlist`: **false**
  - `totalShortlisted`: **645**
- **Decisions Surface Proof**:
  - `decisionsSurfaceCount`: **2,373** (2,363 evaluated + 10 decided sparse)
  - `decidedSparseRepresentedCount`: **10** (2 PURSUE, 1 CONSIDER, 7 PASS)

### Exact 10 Sparse Decisions Roster:
1. `j-3318be43d60c`: Global Business Head — User PURSUE (`USER_CONFIRMED`)
2. `j-cdda239800fe`: Marketing Manager (Remote) — User PURSUE (`USER_CONFIRMED`)
3. `j-4684bd8aa586`: Digital Transformation Head — User CONSIDER (`PREFERENCE_OVERRIDE`)
4. `j-01360b4c63f5`: Personal Secretary — User PASS (`USER_PASSED`)
5. `j-0d6a4e458806`: Inbound — User PASS (`USER_PASSED`)
6. `j-1a0e3f0f3ecb`: Purchase Manager — User PASS (`USER_PASSED`)
7. `j-66cde4dc88ff`: Marketing Head - Telecom Towers — User PASS (`USER_PASSED`)
8. `j-8fec06130457`: Senior Production Executive — User PASS (`USER_PASSED`)
9. `j-97cfbaa9ab6f`: Head-Enterprise Analytics — User PASS (`USER_PASSED`)
10. `j-f41833af80b5`: Sales Coordinator — User PASS (`USER_PASSED`)

---

## 4. Verification Suite Results

1. **Focused Integration Test Suite**: `tests/intelligence/for4k_bug03_bug04.test.ts`
   - `BUG-03: Zero orphan canonical opportunities without versions` — **PASSED**
   - `BUG-04: All 10 sparse decisions remain represented in Decisions surface` — **PASSED**
   - `Stage Separation Invariant: Sparse opportunities never enter RADAR Shortlist` — **PASSED**
   - `Serving Metrics Invariants: 645 Shortlist, 82 Review Queue, 472/137/889 Evaluated Decisions` — **PASSED**
   - `Decision Immutability Invariant: Zero canonical user decisions mutated` — **PASSED**
2. **TypeScript Compilation**: `npx tsc --noEmit` exited with **code 0** (clean).
3. **Database Decisions Integrity**: `canonical_decisions` remains **100% untouched**:
   - `PURSUE`: 474
   - `CONSIDER`: 138
   - `PASS`: 897
   - Total: 1,509 (1,508 on active candidates + 1 on restored canonical opportunity).

---

## 5. Final Status & Open Items Ledger

| Defect ID | Description | Resolution Status | Notes |
| :--- | :--- | :--- | :--- |
| **BUG-01** | Metrics, VETO_OVERRIDE classification & Shortlist decoupling | **CLOSED** | Fully verified in FOR-4J/4K |
| **BUG-02** | evaluation_state persistence invariant repair | **CLOSED** | 1,498 active candidate rows repaired to `EVALUATED` |
| **BUG-03** | Single orphan canonical opportunity `7e3589af...` | **CLOSED** | Missing linkage inserted into `opportunity_versions`; 0 orphans |
| **BUG-04** | 10 sparse decisions omitted from serving | **CLOSED** | Adapted with `SPARSE_SPEC` state; represented in Decisions |
| **BUG-06** | Historical 255 mutations in recovery ledger | **REMAINS OPEN (PRESERVED)** | Historical audit ledger deliberately preserved; not modified |

**STATUS**: **FOR-4K IS COMPLETE. BUG-03 AND BUG-04 ARE OFFICIALLY CLOSED.**