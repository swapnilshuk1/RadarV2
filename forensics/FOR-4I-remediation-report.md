# FOR-4I / FOR-4J — TARGETED REMEDIATION & STAGE-DECOUPLING VERIFICATION REPORT

**Remediation Scope**: Targeted Closure of **BUG-01** (Metrics, VETO_OVERRIDE Classification, and Shortlist Decoupling) and **BUG-02** (evaluation_state Persistence Invariant Repair).  
**Mode**: Minimal Code Modification + Tightly Scoped Data Repair (0 Schema Changes, 0 Decision Mutations, 0 Scoring Changes, 0 UI Route Mutations).  
**Target Persistence Engine**: Turso Cloud (`libsql://radar-db-swapnilshuk1.aws-ap-south-1.turso.io`)  
**Scope**: Tenant `tenant_default`, User `ms6i7e3y-4x0chy5fy`, Search Plan `sp_canonical_swapnil`, Active Context `fbcfc83c5f8e7257aa2b92e1fbd91acfebf47c5f4ca3fcd167def146839b0ba9`

---

## 1. Architectural Model & Stage Decoupling (FOR-4J Invariant)

RADAR strictly enforces clean separation across the decision lifecycle:

```
RADAR RECOMMENDATION (Discovery / Qualification Engine)
  ├── Pursue: 389
  ├── Consider: 256
  └── Pass: 1,351 (+ 367 Sparse / Not Evaluable)
          │
          ▼
SHORTLIST (Total Shortlisted by RADAR = 645)
  ├── Decided (Moved to Decisions Surface): 563
  └── Actionable Review Queue (Unreviewed): 82 (22 Pursue + 60 Consider)
          │
          ▼
USER DECISION (Explicit User Verdict on 1,498 Opportunities)
          │
          ▼
DECISIONS (Pipeline Surfaces)
  ├── User Pursue: 472 (308 Confirmed Pursue + 42 Consideration Pursue + 122 Veto Override)
  ├── User Consider: 137 (43 Engine Pursue/Pass considered + 94 Engine Consider considered)
  └── User Pass: 889 (813 Engine Pass + 76 Engine Pursue/Consider passed)
          │
          ▼
[Downstream Application & Interview Workflow — Not Yet Designed]
```

### Essential Governance Rules:
1. **`VETO_OVERRIDE` belongs strictly to DECISIONS, NEVER to SHORTLIST**:
   - `VETO_OVERRIDE` = `Engine PASS` + `User PURSUE`.
   - RADAR never shortlisted it (RADAR said `PASS`). The user manually decided `PURSUE`.
   - Therefore, `isShortlisted` evaluates to `false` for `VETO_OVERRIDE`.
   - It does NOT inflate `totalShortlisted`.
2. **Once decided, items leave the Shortlist feed**:
   - Any user decision (`USER_CONFIRMED`, `PREFERENCE_OVERRIDE`, `VETO_OVERRIDE`, `USER_PASSED`) moves the item to the `/decisions` surface.
   - The active review queue on `/` displays only unreviewed qualified opportunities (`82`).

---

## 2. BUG-01: Root Cause, Remediation & Decoupling

### Root Cause:
1. **False PASS Fallthrough**: In `SqliteCanonicalServingStore.getOpportunityMetrics()`, `eff === "VETO_OVERRIDE"` was unhandled and fell into `effectiveBreakdown.pass++`, falsely inflating PASS by +122.
2. **Shortlist Cross-Stage Conflation**: `isShortlisted` and `totalShortlisted` were defined using effective decisions (`eff`), treating decided opportunities and veto overrides as "shortlisted" (reporting 691).

### Exact Code Changes:

#### `src/data/sqlite/repositories/SqliteCanonicalServingStore.ts`
```diff
         const eff = opp.effectiveDecision;
-        if (eff === "ENGINE_PURSUIT" || eff === "USER_CONFIRMED") {
+        if (eff === "ENGINE_PURSUIT" || eff === "USER_CONFIRMED" || eff === "VETO_OVERRIDE") {
           effectiveBreakdown.pursue++;
           activePursuits++;
-          totalShortlisted++;
         } else if (eff === "PREFERENCE_OVERRIDE" || eff === "ENGINE_CONSIDER") {
           effectiveBreakdown.consider++;
-          totalShortlisted++;
         } else if (eff === "NOT_EVALUABLE") {
           effectiveBreakdown.sparse++;
         } else {
           effectiveBreakdown.pass++;
         }

-        const isShortlisted = eff === "ENGINE_PURSUIT" || eff === "USER_CONFIRMED" || eff === "PREFERENCE_OVERRIDE" || eff === "ENGINE_CONSIDER" || eff === "VETO_OVERRIDE";
+        // Shortlisted by RADAR recommendation engine:
+        // Opportunities where RADAR recommends PURSUE or CONSIDER.
+        // User decisions (including VETO_OVERRIDE where Engine=PASS) belong to Decided surfaces, NOT Shortlist.
+        const isShortlisted = engineVerb === "PURSUE" || engineVerb === "CONSIDER";
...
+    totalShortlisted = engineBreakdown.pursue + engineBreakdown.consider;
```

#### `src/lib/intelligence/metric-integrity.ts`
Deprecating cross-stage `activePursuits` and decoupling `totalShortlisted` from user decisions:
```ts
  /**
   * @deprecated Cross-stage metric summing unreviewed engine pursuits and user decisions.
   * For user decisions, inspect `decisionMetrics.userPursueTotal` (472).
   * For active review queue, inspect `discoveryMetrics.actionableReviewQueue` (82).
   */
  readonly activePursuits: number;

  /**
   * Total opportunities shortlisted/qualified by RADAR's recommendation engine (389 Pursue + 256 Consider = 645).
   * Strictly decoupled from user decision overrides (does NOT include VETO_OVERRIDE).
   */
  readonly totalShortlisted: number;

  // Canonical Stage Breakdown (Disambiguating Discovery/Shortlist vs Decisions)
  readonly discoveryMetrics?: {
    readonly engineQualified: number;       // 645 (389 Pursue + 256 Consider)
    readonly actionableReviewQueue: number; // 82 (22 Pursue + 60 Consider unreviewed)
    readonly unreviewedSparse: number;      // 639
  };
  readonly decisionMetrics?: {
    readonly totalDecided: number;          // 1,498
    readonly userConfirmed: number;         // 308 (Engine Pursue + User Pursue)
    readonly preferenceOverride: number;    // 46 (Engine Consider + User Pursue/Consider overrides)
    readonly vetoOverride: number;          // 122 (Engine Pass + User Pursue)
    readonly userPassed: number;            // 889 (Explicit user pass)
    readonly userPursueTotal: number;       // 472 (Total explicit user Pursue decisions)
    readonly userConsiderTotal: number;     // 137 (Total explicit user Consider decisions)
    readonly userPassTotal: number;         // 889 (Total explicit user Pass decisions)
  };
```

---

## 3. Metrics Comparison: Before vs Intermediate vs Authoritative Final

| Metric | Original Baseline | Intermediate (FOR-4I) | Authoritative Final (FOR-4J) | Semantic Meaning |
| :--- | :--- | :--- | :--- | :--- |
| **`totalShortlisted`** | 569 | 691 (conflated) | **645** | **Total opportunities shortlisted by RADAR engine (389 Pursue + 256 Consider)** |
| **`discoveryMetrics.actionableReviewQueue`** | N/A | 82 | **82** | **Awaiting user review in Shortlist feed (22 Pursue + 60 Consider)** |
| **`decisionMetrics.totalDecided`** | N/A | 1,498 | **1,498** | **Opportunities with explicit user action** |
| **`decisionMetrics.userPursueTotal`** | N/A | 472 | **472** | **Explicit User PURSUE decisions (308 Confirmed + 42 Consideration + 122 Veto Override)** |
| **`decisionMetrics.vetoOverride`** | N/A | 122 | **122** | **Explicit User VETO Overrides (Engine PASS -> User PURSUE)** |
| **`effectiveBreakdown.pursue`** | 330 | 452 | **452** | Effective decision state: Pursue |
| **`effectiveBreakdown.pass`** | 2,066 | 1,944 | **1,944** | 122 false PASS records eliminated |
| **`activePursuits`** | 330 | 452 | **452** | *Deprecated cross-stage aggregate* |

---

## 4. BUG-02: Persistence Invariant Repair Summary

- **Determination**: `evaluation_state` is an authoritative persisted column (added in migration 026, indexed via `idx_mat_eval_state`, written by production worker `EvaluationWorker.ts:292`). The 1,498 `UNKNOWN` rows were caused by a column omission in historical script `for3_phase1d_controlled_mutation.ts:442`.
- **Repair Query**: Exact update of the 1,498 active candidate rows to `EVALUATED`.
- **Rollback Script**: Persisted in `forensics/FOR-4I-rollback.sql`.
- **Result**: Active candidates now have **2,363 EVALUATED** + **639 SPARSE_SPEC** (0 UNKNOWN).

---

## 5. Verification Proofs

1. **User Decisions 100% Untouched**:
   - `canonical_decisions` contains exactly 474 PURSUE, 138 CONSIDER, 897 PASS = 1,509 (1,508 active candidates + 1 orphan). Zero records mutated.
2. **82 Review Queue 100% Intact**:
   - Unreviewed Engine Pursue: 22
   - Unreviewed Engine Consider: 60
   - Shortlist review queue length: exactly 82 cards.
3. **Regression Tests**:
   - **102 test files passed, 920 tests passed** in Vitest.
   - **`npx tsc --noEmit` exited with code 0** (clean compilation).
4. **Remaining Issues Explicitly NOT TOUCHED**:
   - BUG-03 (Orphan opportunity): NOT TOUCHED.
   - BUG-04 (10 sparse decisions): NOT TOUCHED.
   - BUG-06 (Historical 255 mutations): NOT TOUCHED.

---

## 6. Final Status

| Issue ID | Subject | Final Status |
| :--- | :--- | :--- |
| **BUG-01** | Metrics, VETO_OVERRIDE Classification & Shortlist Decoupling | **FULLY CLOSED** |
| **BUG-02** | evaluation_state Persistence Invariant Repair | **FULLY CLOSED** |

**OVERALL REMEDIATION STATUS**: **FULLY SIGNED OFF & VERIFIED**