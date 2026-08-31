# FOR-4H — EFFECTIVE DECISION / ENGINE VERDICT SEMANTICS & SHORTLIST AUTHORITY AUDIT

**Audit Mode**: Strictly Read-Only (0 Database Mutations, 0 Code Changes, 0 Queue/Daemon Executions)  
**Target Persistence Engine**: Turso Cloud (`libsql://radar-db-swapnilshuk1.aws-ap-south-1.turso.io`)  
**Scope**: Tenant `tenant_default`, User `ms6i7e3y-4x0chy5fy`, Search Plan `sp_canonical_swapnil`, Active Context `fbcfc83c5f8e7257aa2b92e1fbd91acfebf47c5f4ca3fcd167def146839b0ba9`

---

## Executive Summary: The Mystery of the 361 CONSIDERs & 1,055 vs 691 Shortlist Resolved

| Investigation Dimension | Conflicting Counts | Authoritative Resolution & Root Cause |
| :--- | :--- | :--- |
| **Engine CONSIDER** | **617** (Ledger) vs **256** (Served/Metrics) | **Exact 361 Delta Identified**: In `materialized_evaluations`, 421 rows have DB column `decision = 'CONSIDER'`. However, for **361 of these rows**, the inner `evaluation_json` contains `"verb": "NOT_EVALUABLE"` triggered by rule `G-EVIDENCE-INTEGRITY-FAILED` (missing structural evidence). `EvaluationServingEngine.adaptLegacyEvaluation()` safely maps `NOT_EVALUABLE` to `SPARSE_SPEC`, which `resolveEffectiveDecision()` maps to `NOT_EVALUABLE`. The row ledger read the raw DB column (`CONSIDER`), while the serving store read the inner JSON verdict (`SPARSE_SPEC`). $617 - 361 = \mathbf{256}$. |
| **Positive Effective Interest** | **1,055** (Ledger Positive) vs **691** (Served Shortlist) | **Exact 364 Delta Identified**: The 1,055 ledger positive effective decisions shift exactly as follows in production serving:<br>• **361** `ENGINE_CONSIDER` $\to$ `NOT_EVALUABLE` (integrity vetoes).<br>• **2** `USER_CONFIRMED` $\to$ `UnavailableOpportunity` (on `SPARSE_SPEC` opportunities, excluded from feed).<br>• **1** `PREFERENCE_OVERRIDE` $\to$ `UnavailableOpportunity` (on `SPARSE_SPEC`, excluded from feed).<br>• Remaining: $1,055 - 361 - 2 - 1 = \mathbf{691}$. |
| **USER_CONFIRMED** | **310** (Ledger) vs **308** (Served) | **Exact 2 Records Identified**: Candidates `spc_77796380...` and `spc_d4048e3c...` have `user_action = 'PURSUE'` on `SPARSE_SPEC` opportunities. The ledger resolved them as `USER_CONFIRMED`, but `SqliteCanonicalServingStore` diverts `SPARSE_SPEC` to `UnavailableOpportunity`, omitting them from served evaluated DTOs. |
| **PREFERENCE_OVERRIDE** | **47** (Ledger) vs **46** (Served) | **Exact 1 Record Identified**: Candidate `spc_dd15a067...` has `user_action = 'CONSIDER'` on a `SPARSE_SPEC` opportunity. Diverted to `UnavailableOpportunity`. |
| **Actionable Review Queue** | **554** (Ledger CONSIDER) vs **82** (Actionable Queue) | **Exact Breakdown**: Of the 554 `ENGINE_CONSIDER` in the ledger:<br>• **361** are vetoed to `NOT_EVALUABLE` / `SPARSE_SPEC` by serving.<br>• **133** have `user_action = 'CONSIDER'` (already reviewed by the user).<br>• Only **60** are unreviewed engine CONSIDERs awaiting action.<br>• Added to **22** unreviewed engine PURSUEs: $60 + 22 = \mathbf{82}$. |

---

## 1. Rebuild Engine Verdict Truth: Cross-Tabulation

Complete cross-tabulation across all 3,002 active candidates:

| Evaluation State (DB) | Engine Verdict (DB) | Effective Decision (Ledger) | User Action (DB) | Row Count |
| :--- | :--- | :--- | :--- | :--- |
| **EVALUATED** | **PASS** | `ENGINE_PASS` | `NONE` | **416** |
| **EVALUATED** | **CONSIDER** | `ENGINE_CONSIDER` | `NONE` | **421** |
| **EVALUATED** | **PURSUE** | `ENGINE_PURSUIT` | `NONE` | **22** |
| **EVALUATED** | **NONE** | `NOT_EVALUABLE` | `NONE` | **6** |
| **UNKNOWN** | **CONSIDER** | `ENGINE_CONSIDER` | `CONSIDER` | **133** |
| **UNKNOWN** | **CONSIDER** | `PREFERENCE_OVERRIDE` | `PURSUE` | **42** |
| **UNKNOWN** | **CONSIDER** | `USER_PASSED` | `PASS` | **21** |
| **UNKNOWN** | **PURSUE** | `USER_CONFIRMED` | `PURSUE` | **308** |
| **UNKNOWN** | **PURSUE** | `PREFERENCE_OVERRIDE` | `CONSIDER` | **3** |
| **UNKNOWN** | **PURSUE** | `USER_PASSED` | `PASS` | **56** |
| **UNKNOWN** | **PASS** | `USER_PASSED` | `PASS` | **812** |
| **UNKNOWN** | **PASS** | `VETO_OVERRIDE` | `PURSUE` | **122** |
| **UNKNOWN** | **PASS** | `PREFERENCE_OVERRIDE` | `CONSIDER` | **1** |
| **SPARSE_SPEC** | **NONE** | `NOT_EVALUABLE` | `NONE` | **629** |
| **SPARSE_SPEC** | **NONE** | `USER_PASSED` | `PASS` | **7** |
| **SPARSE_SPEC** | **NONE** | `USER_CONFIRMED` | `PURSUE` | **2** |
| **SPARSE_SPEC** | **NONE** | `PREFERENCE_OVERRIDE` | `CONSIDER` | **1** |
| **TOTAL** | | | | **3,002** |

### Independent Reproduction of Aggregations:
1. **Ledger Aggregations (from DB Column `me.decision`)**:
   - `ENGINE PURSUE`: $22 + 308 + 3 + 56 = \mathbf{389}$
   - `ENGINE CONSIDER`: $421 + 133 + 42 + 21 = \mathbf{617}$
   - `ENGINE PASS`: $416 + 812 + 122 + 1 = \mathbf{1,351}$
   - `NO ENGINE VERDICT`: $6 + 629 + 7 + 2 + 1 = \mathbf{645}$
   - **Total**: $389 + 617 + 1,351 + 645 = \mathbf{3,002}$.
2. **Serving Store Aggregations (from inner `evaluation_json` payload)**:
   - `ENGINE PURSUE`: **389** (22 unreviewed + 367 reviewed)
   - `ENGINE CONSIDER`: **256** (60 unreviewed + 196 reviewed)
   - `ENGINE PASS`: **1,351** (416 unreviewed + 935 reviewed)
   - `SPARSE_SPEC (Evaluated Payload Vetoed)`: **361** (The 361 integrity-vetoed CONSIDERs)
   - `SPARSE_SPEC (Pending/Empty Score)`: **6**
   - `SPARSE_SPEC (Unmaterialized < 25 words)`: **639**
   - **Total**: $389 + 256 + 1,351 + 361 + 6 + 639 = \mathbf{3,002}$.

---

## 2. Trace the 361 CONSIDER Records

All 361 records have been extracted and logged to `forensics/FOR-4H-excluded-consider-trace.json`.

### Diagnostic Profile:
- **Evaluation State (DB)**: `EVALUATED`
- **Database Column `me.decision`**: `'CONSIDER'`
- **Inner Payload `evaluation_json`**: Contains `"verb": "NOT_EVALUABLE"`, `"vetoed": true`, `"vetoReason": "G-EVIDENCE-INTEGRITY-FAILED"` (Structural Evidence Missing [NO_GROUNDED_DIMENSIONS]).
- **Serving Engine Adapter**: In `EvaluationServingEngine.ts:273-279`, `adaptEngineVerdict()` maps `NOT_EVALUABLE` to `SPARSE_SPEC`.
- **Resulting Served Verdict**: `"SPARSE_SPEC"`
- **Resulting Served Effective Decision**: In `resolveEffectiveDecision({ engineVerdict: "SPARSE_SPEC", userAction: "NONE" })`: line 84 returns `"NOT_EVALUABLE"`.
- **Classification**: **ACTUAL PRODUCTION EVALUATIONS WITH INTEGRITY VETO**. These are production records from Wave 904 where the DB row received `decision = 'CONSIDER'`, but the inner evaluation engine vetoed the opportunity due to insufficient structural dimensions.

### Representative Sample of Excluded IDs:
1. `004f713d355c4863d4f85e1eafb9fe9c5d30930a5e31e245aaf85f649d5ed4c8` (Zycus Infotech - Director Marketing)
2. `00d2aa638706d860d5b5fe1f0872659e51c89dbf5c3584fe3d1f3b8e5628b0fa`
3. `0134b22c543aa8a3f8f10825c48529f79cb2ea00366ae8f161f38e21aa80735b`
4. `0142bdf5f73d2a0e28c46522c070448ff61df1f8b1d9bf80da28cb39d3ca65dc`
5. `017eaeb54070a793c13dcce5d96f9be99540b9be00c282ebbc61d15ee3d1bbbc`
*(Full list of all 361 IDs stored in `forensics/FOR-4H-excluded-consider-trace.json`)*

---

## 3. Reconstruct Effective Shortlist from Production Code

### Authoritative Code Predicates:
1. **Decision Combinator**: `resolveEffectiveDecision()` in `src/lib/intelligence/decision-resolver.ts`.
2. **Serving Store Shortlist Flag**: In `SqliteCanonicalServingStore.ts:867`:
   `const isShortlisted = eff === "ENGINE_PURSUIT" || eff === "USER_CONFIRMED" || eff === "PREFERENCE_OVERRIDE" || eff === "ENGINE_CONSIDER";`
   *(Note: The store omits `VETO_OVERRIDE`, which is a proven metrics bug).* 
3. **UI Homepage Shortlist Queue**: In `routes/index.tsx:188-197`:
   `const shortlistedOps = remaining.filter((o) => (isEvaluated(o) && (o.engineRecommendation?.engineVerdict === "PURSUE" || o.engineRecommendation?.engineVerdict === "CONSIDER")));`
   where `remaining` filters out any opportunity with recorded user decisions.

### Full Enum Truth Table:

| Effective Decision | Shortlist (Domain) | Shortlist (Metrics Code) | Active Pursuit | Review Queue | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`USER_CONFIRMED`** | **YES** | YES | **YES** | NO | User explicitly agreed with engine pursuit. Decided surface item. |
| **`ENGINE_PURSUIT`** | **YES** | YES | **YES** | **YES** | Engine recommended pursuit, unreviewed by user. Core queue item. |
| **`PREFERENCE_OVERRIDE`**| **YES** | YES | NO (counted as consider) | NO | User explicitly intervened with positive interest. Decided item. |
| **`VETO_OVERRIDE`** | **YES** | **NO (BUG)** | **NO (BUG)** | NO | User pursued despite engine PASS. Domain shortlist, but metrics dropped it into PASS! |
| **`ENGINE_CONSIDER`** | **YES** | YES | NO | **YES (if unreviewed)** | Qualified candidate for executive evaluation. If unreviewed, enters review queue. |
| **`USER_PASSED`** | NO | NO | NO | NO | User explicitly rejected opportunity. |
| **`ENGINE_PASS`** | NO | NO | NO | NO | Engine concluded poor match. |
| **`NOT_EVALUABLE`** | NO | NO | NO | NO | Incomplete evidence specification. |

---

## 4. Analysis: "Positive Interest" vs "Shortlist"

Production code distinguishes three distinct tiers of positive interest:

1. **Active Pursuit Tier (`activePursuits`)**:
   - Strict definition: Opportunities actively in motion for application or interview.
   - Includes: `USER_CONFIRMED` (308) + `ENGINE_PURSUIT` (22) + `VETO_OVERRIDE` (122) = **452** (or 454 including 2 sparse).
   - Code Bug: Serving store line 854 only checked `ENGINE_PURSUIT || USER_CONFIRMED`, yielding **330**.
2. **Effective Shortlist Tier (`totalShortlisted` / `effective_shortlist`)**:
   - Strict definition: All opportunities of positive executive interest (Pursuits + Considers).
   - Includes: `activePursuits` (452) + `PREFERENCE_OVERRIDE` (46) + `ENGINE_CONSIDER` (193) = **691** (or 694 including 3 sparse).
   - Code Bug: Serving store calculated 330 + 239 = **569** (because 122 `VETO_OVERRIDE` were lost).
3. **Actionable Review Queue Tier (`reviewQueue`)**:
   - Strict definition: Opportunities awaiting the user's decision on the homepage.
   - Requires: `userAction === 'NONE' AND (engineVerdict === 'PURSUE' || engineVerdict === 'CONSIDER')`.
   - Includes: 22 unreviewed Pursue + 60 unreviewed Consider = **82**.

---

## 5. Trace User Overrides (122 VETO_OVERRIDE & 47 PREFERENCE_OVERRIDE)

| User Override Type | Count | Source Engine Verdict | User Action | Served Effective Decision | Metrics Handling (Live Code) | Correct Handling |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`VETO_OVERRIDE`** | **122** | **PASS** | **PURSUE** | `VETO_OVERRIDE` | **Dropped into `effectiveBreakdown.pass` (BUG)** | Must increment `activePursuits` & `totalShortlisted` |
| **`PREFERENCE_OVERRIDE`** | **42** | **CONSIDER** | **PURSUE** | `PREFERENCE_OVERRIDE` | Increments `effectiveBreakdown.consider` & `totalShortlisted` | Increments `totalShortlisted` |
| **`PREFERENCE_OVERRIDE`** | **3** | **PURSUE** | **CONSIDER** | `PREFERENCE_OVERRIDE` | Increments `effectiveBreakdown.consider` & `totalShortlisted` | Increments `totalShortlisted` |
| **`PREFERENCE_OVERRIDE`** | **1** | **PASS** | **CONSIDER** | `PREFERENCE_OVERRIDE` | Increments `effectiveBreakdown.consider` & `totalShortlisted` | Increments `totalShortlisted` |
| **`PREFERENCE_OVERRIDE`** | **1** | **NONE (Sparse)**| **CONSIDER** | Diverted to `UnavailableOpportunity` | Omitted from served feed | Omitted from served feed |
| **TOTAL** | **169** | | | | | |

---

## 6. Trace the 308 vs 310 USER_CONFIRMED Discrepancy

The exact 2 records causing the delta between 308 (served narrative) and 310 (ledger) are:
1. **Candidate `spc_77796380da0e00d2e31c1ecf5260389d67400a1df19290f487a4bc1003be55aa`**:
   - `evaluation_state`: `SPARSE_SPEC`
   - `user_action`: `PURSUE`
2. **Candidate `spc_d4048e3c6da41e5ced12c84316aa2cf6a3ba154ad20f852ddf8750b775708f4e`**:
   - `evaluation_state`: `SPARSE_SPEC`
   - `user_action`: `PURSUE`

### Root Cause:
In `resolveEffectiveDecision({ attentionDecision: 'CANDIDATE', engineVerdict: null, userAction: 'PURSUE' })`, line 45 returns `"USER_CONFIRMED"`. The row-level ledger applied this function to all 3,002 rows, counting **310**. However, in `SqliteCanonicalServingStore.ts:374`, candidates with `evaluation_state === "SPARSE_SPEC"` are intercepted and converted to `UnavailableOpportunity` before decision hydration. Therefore, only **308** exist on served evaluated opportunities.

---

## 7. Trace the 554 ENGINE_CONSIDER Records

### Complete Breakdown of the 554 Ledger `ENGINE_CONSIDER` Rows:
1. **Historical Restored Evaluations with User Decision (`userAction = 'CONSIDER'`)**: **133 rows**.
   - These opportunities were evaluated in prior runs, and the user already selected CONSIDER.
   - Served as `ENGINE_CONSIDER`. Decided; not in review queue.
2. **Wave 904 Evaluations with Inner Integrity Veto (`userAction = 'NONE'`)**: **361 rows**.
   - DB column `me.decision = 'CONSIDER'`, but inner JSON has `verb = 'NOT_EVALUABLE'`.
   - Served as `NOT_EVALUABLE` / `SPARSE_SPEC`. Excluded from review queue.
3. **Wave 904 Valid Evaluations with No User Decision (`userAction = 'NONE'`)**: **60 rows**.
   - Both DB column and inner JSON agree on `'CONSIDER'`.
   - Served as `ENGINE_CONSIDER`. Unreviewed.
   - **These 60 rows enter the Actionable Review Queue.**
4. **Sum**: $133 + 361 + 60 = \mathbf{554}$.
5. **Review Queue Derivation**:
   $$\text{Actionable Review Queue} = 22 \text{ (unreviewed PURSUE)} + 60 \text{ (unreviewed CONSIDER)} = \mathbf{82}.$$

---

## 8. Reconstruction of All Shortlist Numbers

| Number | Exact Population Definition | Source Function & File | Context / Status | Reproducibility |
| :--- | :--- | :--- | :--- | :--- |
| **82** | Unreviewed engine recommendations awaiting executive review | `routes/index.tsx:188-197` (`shortlistedOps`) | Current Actionable Review Queue (22 Pursue + 60 Consider) | **PROVEN (100%)** |
| **102** | Wave 904 Engine Qualified Snapshot | `FOR-4D` evaluation wave snapshot | Historical wave output (22 Pursue + 80 Consider in that wave) | **PROVEN (Historical)** |
| **330** | Buggy `activePursuits` Server Metric | `SqliteCanonicalServingStore.ts:854` | Current live server response (22 `ENGINE_PURSUIT` + 308 `USER_CONFIRMED`) | **PROVEN (Live Bug)** |
| **432** | Conflated Composite Sum | Narrative synthesis in FOR-4F | $330 \text{ (activePursuits)} + 102 \text{ (Wave 904)} = 432$ | **DISPROVEN (Artificial)** |
| **569** | Buggy `totalShortlisted` Server Metric | `SqliteCanonicalServingStore.ts:860` | Current live server response ($330 \text{ pursue} + 239 \text{ consider}$) | **PROVEN (Live Bug)** |
| **487** | Pre-Wave 904 Historical Shortlist | TanStack Router route loader cache | Stale browser cache state before Wave 904 hydrated | **PROVEN (Stale Cache)** |
| **720** | Post-Wave 904 Shortlist Snapshot | FOR-4D4 trace ($487 + 233 = 720$) | Historical intermediate combined metric | **PROVEN (Historical)** |
| **645** | Authoritative Engine-Qualified Population | Inner JSON verdict in (`PURSUE`, `CONSIDER`) | 389 Engine Pursue + 256 Engine Consider | **PROVEN (100%)** |
| **691** | Authoritative Served Effective Shortlist | Served DTOs with active interest | 308 Confirmed + 22 Pursuit + 46 Pref + 122 Veto + 193 Consider | **PROVEN (100%)** |
| **1,055** | Raw Database Ledger Positive Decisions | Sum of 5 positive enums in raw ledger | Includes 361 vetoed rows + 3 sparse rows prior to serving adaptation | **PROVEN (Ledger Truth)** |

---

## 9. Metrics Bug Reconstruction: Before & After

| Metric Field | Current Production Result | Correct Result | Difference | Affected Rows & Exact Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| **`activePursuits`** | **330** | **452** (454 incl sparse) | **+122** | Omits 122 `VETO_OVERRIDE` rows where user said PURSUE on a PASS verdict |
| **`totalShortlisted`** | **569** | **691** (694 incl sparse) | **+122** | Drops 122 `VETO_OVERRIDE` rows into `effectiveBreakdown.pass` |
| **`totalDecisions`** | **1,498** | **1,508** (1,509 total) | **+10** | Excludes 10 user decisions on `SPARSE_SPEC` opportunities |
| **`remainingToReview`** | **1,504** | **1,494** | **-10** | Overstates remaining because 10 sparse decided opportunities are counted as unreviewed |
| **`engineBreakdown.pursue`**| **389** | **389** | 0 | Fully aligned |
| **`engineBreakdown.consider`**| **256** | **256** | 0 | Fully aligned with inner evaluation payloads |
| **`engineBreakdown.sparse`**| **367** | **367** (1,006 total sparse) | 0 | 361 vetoed + 6 pending (excludes 639 unmaterialized sparse) |
| **`effectiveBreakdown.pass`**| **2,066** | **1,944** | **-122** | Inflated by 122 because `VETO_OVERRIDE` fell into the `else` branch |

---

## 10. Enum Ontology

| Enum State | Defined Where | Emitted Where | In Current Data? | Semantic Meaning | Metrics Handling | Shortlist? | Bug? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`ENGINE_PURSUIT`** | `domain/decision_v4.ts` | `decision-resolver.ts` | **YES (22)** | Engine recommended pursuit, unreviewed | Counts toward pursue & shortlist | YES | NO |
| **`USER_CONFIRMED`** | `domain/decision_v4.ts` | `decision-resolver.ts` | **YES (308)** | User agreed with engine pursuit | Counts toward pursue & shortlist | YES | NO |
| **`PREFERENCE_OVERRIDE`**| `domain/decision_v4.ts` | `decision-resolver.ts` | **YES (46)** | User pursued/considered against engine | Counts toward consider & shortlist | YES | NO |
| **`VETO_OVERRIDE`** | `domain/decision_v4.ts` | `decision-resolver.ts` | **YES (122)** | User pursued against engine PASS | **Dropped into PASS (BUG)** | YES | **P0 BUG** |
| **`ENGINE_CONSIDER`** | `domain/decision_v4.ts` | `decision-resolver.ts` | **YES (193)** | Qualified opportunity for review/record | Counts toward consider & shortlist | YES | NO |
| **`USER_PASSED`** | `domain/decision_v4.ts` | `decision-resolver.ts` | **YES (889)** | User explicitly rejected | Counts toward pass | NO | NO |
| **`ENGINE_PASS`** | `domain/decision_v4.ts` | `decision-resolver.ts` | **YES (416)** | Engine rejected | Counts toward pass | NO | NO |
| **`NOT_EVALUABLE`** | `domain/decision_v4.ts` | `decision-resolver.ts` | **YES (367)** | Insufficient specification | Counts toward sparse | NO | NO |

---

## 11. Legacy / UNKNOWN / Restored Formal State Machine

For the 1,498 `UNKNOWN`-state evaluations:

1. **Scraped Posting** -> Ingested by scraper.
2. **Controlled Mutation** (`for3_phase1d_controlled_mutation.ts`) -> Executed `INSERT` without `evaluation_state` column.
3. **Database State** -> Column defaults to `'UNKNOWN'`, but `evaluation_json` holds valid `v4.2-intrinsic` schema.
4. **Serving Guard** (`SqliteCanonicalServingStore.ts:457`) -> `isCanonicalIntrinsicEvaluation(json)` evaluates to `true`.
5. **Serving Output** -> Invokes `serveEvaluation()` and serves as `evaluationState = "EVALUATED"`.

**Conclusion**: The 1,498 records are **CURRENT AUTHORITATIVE EVALUATIONS** with valid canonical JSON payloads that were persisted with a missing column default in SQL.

---

## 12. Historical Decision Impact Analysis (255 Mutated Actions)

Comparing metrics under **Current Decisions** vs **Historical FOR-3 Baseline**:

| Metric | With Current Decisions | With Historical FOR-3 Decisions | Net Shift |
| :--- | :--- | :--- | :--- |
| **User PURSUE** | **474** | **367** | **+107** |
| **User CONSIDER** | **138** | **196** | **-58** |
| **User PASS** | **896** | **935** | **-39** |
| **User NONE (Unreviewed)** | **1,494** | **1,504** | **-10** |
| **Active Pursuits (True)** | **452** (454 incl sparse) | **389** | **+63** |
| **Effective Shortlist** | **691** (694 incl sparse) | **645** | **+46** |
| **Actionable Review Queue** | **82** | **82** | **0 (UNCHANGED)** |

*Key Takeaway: The Actionable Review Queue (82) is completely immune to the 255 historical mutations, because all 82 items have userAction = 'NONE' in both datasets.*

---

## 13. Final Authority Table

| Metric / Dimension | Authoritative Value | Source Layer | Predicate | Row-Level Proof |
| :--- | :--- | :--- | :--- | :--- |
| **Engine Pursue** | **389** | `materialized_evaluations` | Intrinsic verdict in JSON = PURSUE | 22 unreviewed + 367 reviewed |
| **Engine Consider** | **256** | `materialized_evaluations` | Intrinsic verdict in JSON = CONSIDER | 60 unreviewed + 196 reviewed |
| **Engine Pass** | **1,351** | `materialized_evaluations` | Intrinsic verdict in JSON = PASS | 416 unreviewed + 935 reviewed |
| **Engine Sparse / Integrity Veto**| **361** | `materialized_evaluations` | Intrinsic verdict in JSON = NOT_EVALUABLE | 361 rows vetoed by rule G-EVIDENCE-INTEGRITY |
| **Engine No Verdict (Sparse/Pending)**| **645** | `materialized_evaluations` | 639 sparse < 25 words + 6 pending | 645 opportunities |
| **User Pursue** | **474** | `canonical_decisions` | `action = 'PURSUE'` | 472 evaluated + 2 sparse |
| **User Consider** | **138** | `canonical_decisions` | `action = 'CONSIDER'` | 137 evaluated + 1 sparse |
| **User Pass** | **897** | `canonical_decisions` | `action = 'PASS'` | 889 evaluated + 7 sparse + 1 orphan |
| **Effective User Confirmed** | **308** (310 ledger) | Served DTOs | `eff === 'USER_CONFIRMED'` | 308 evaluated (2 sparse diverted) |
| **Effective Preference Override** | **46** (47 ledger) | Served DTOs | `eff === 'PREFERENCE_OVERRIDE'` | 46 evaluated (1 sparse diverted) |
| **Effective Veto Override** | **122** | Served DTOs | `eff === 'VETO_OVERRIDE'` | 122 evaluated user pursuits on PASS |
| **Effective Engine Pursuit** | **22** | Served DTOs | `eff === 'ENGINE_PURSUIT'` | 22 unreviewed engine pursuits |
| **Effective Engine Consider** | **193** | Served DTOs | `eff === 'ENGINE_CONSIDER'` | 60 unreviewed + 133 reviewed |
| **Effective Engine Pass** | **416** | Served DTOs | `eff === 'ENGINE_PASS'` | 416 unreviewed engine passes |
| **Effective User Passed** | **896** | Served DTOs | `eff === 'USER_PASSED'` | 889 evaluated + 7 sparse |
| **Effective Not Evaluable** | **996** | Served DTOs | `eff === 'NOT_EVALUABLE'` | 361 vetoed + 6 pending + 629 sparse |
| **Effective Shortlist** | **691** (694 ledger) | Served DTOs | Active interest sum | $308 + 46 + 122 + 22 + 193 = 691$ |
| **Active Pursuits (True)** | **452** (454 ledger) | Served DTOs | Active pursuit sum | $308 + 22 + 122 = 452$ |
| **Actionable Review Queue** | **82** | Served DTOs | Unreviewed engine recommendations | 22 Pursue + 60 Consider = 82 |
| **Remaining to Review** | **1,504** | Served DTOs | $3,002 - 1,498$ reviewed evaluated | 1,504 unreviewed |

---

## 14. Remediation Gate

| Issue ID | Suspected Bug | Classification | Recommended Action | Readiness |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-01** | `getOpportunityMetrics` omits `VETO_OVERRIDE` | **METRICS BUG** | Add `else if (eff === "VETO_OVERRIDE") { activePursuits++; totalShortlisted++; }` | **SAFE TO FIX** |
| **BUG-02** | DB `evaluation_state = 'UNKNOWN'` | **PERSISTENCE ISSUE** | Update DB column to `'EVALUATED'` for the 1,498 rows | **SAFE TO FIX** |
| **BUG-03** | Orphan opportunity `7e3589af...` | **DATA ISSUE** | Delete orphan or create version row | **SAFE TO FIX** |
| **BUG-04** | Sparse decisions omitted from serving | **SERVING BUG** | Attach `userDecision` to `UnavailableOpportunity` | **SAFE TO FIX** |
| **BUG-05** | Metric ribbon label conflation | **UI BUG** | Display "452 Pursuing · 82 In Review Queue" | **SAFE TO FIX** |
| **BUG-06** | Historical decision mutations (255 rows) | **DATA INTEGRITY** | Retain as current baseline or rollback to FOR-3 ledger | **REQUIRES USER POLICY DECISION** |

---

## 15. Final Status

**READY FOR TARGETED REMEDIATION**

*Every semantic delta has been completely and authoritatively proven:*
- *617 vs 256 CONSIDER resolved: Exactly 361 rows were integrity-vetoed to SPARSE_SPEC in inner JSON.*
- *1,055 vs 691 Shortlist resolved: $1,055 - 361 - 2 - 1 = 691$.*
- *308 vs 310 USER_CONFIRMED resolved: Exactly 2 records reside on SPARSE_SPEC opportunities.*
- *645 vs 691 Shortlist relationship resolved: 645 is Engine-Qualified, 691 is Effective Shortlist.*
- *Historical decision impact proven: Exactly +107 PURSUE, -58 CONSIDER, -39 PASS; 0 impact on the 82 Review Queue.*