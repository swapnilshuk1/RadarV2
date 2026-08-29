# FOR-4A — Legacy Serving Hydration Root-Cause Forensic Diagnostic Report
## Read-Only Inspection of Live Turso Cloud Database & Serving Adapter Code Paths

### 1. Executive Summary
This read-only diagnostic report establishes, with record-level proof across all **3,002 served opportunities**, the exact root cause of why **1,504 records** are classified by the serving layer as `LEGACY / UNMATERIALIZED` and rendered by the UI as:
```
EVALUATION PENDING
UNKNOWN COMPANY · UNKNOWN · PORTAL
```

---

### 2. Category Classification Breakdown (Mutually Exclusive)

| Category | Description | Record Count | Percentage |
| :--- | :--- | :--- | :--- |
| **A. TRUE_UNEVALUATED** | Canonical opportunity exists in candidate projection, but **zero** `evaluation_job` and **zero** `materialized_evaluation` records exist under V4 fingerprint | **1,504** | **100%** |
| **B. EVALUATED_BUT_LOOKUP_FAIL** | Evaluation exists in Turso but serving lookup cannot locate it | **0** | **0%** |
| **C. WRONG_EVALUATION_CONTEXT** | Evaluation exists under a different context fingerprint | **0** | **0%** |
| **D. MISSING_LINEAGE** | Canonical record exists but version/candidate lineage is broken | **0** | **0%** |
| **E. METADATA_HYDRATION_FAIL** | Evaluation data exists, but UI adapter drops metadata | **0** | **0%** |
| **F. OTHER** | Unclassified / anomalous states | **0** | **0%** |
| **TOTAL** | **Invariant Check: A + B + C + D + E + F = 1,504** | **1,504** | **100%** |

---

### 3. Key Forensic Findings & Root Causes

#### Finding 1: The 1,504 Records are 100% `TRUE_UNEVALUATED` V4 Backlog
* **Database Evidence**: All **1,504** legacy records exist as valid active opportunities in `canonical_opportunities`, `opportunity_versions` (with real job titles and company names like *"Crisil"*, *"Cvent"*, *"NLB Services"*), and `search_plan_candidates`.
* **Evaluation Evidence**: There are **zero** rows in `evaluation_jobs` and **zero** rows in `materialized_evaluations` for these 1,504 pre-remediation records under active context fingerprint `fbcfc83c5f8e7257aa2b92e1fbd91acfebf47c5f4ca3fcd167def146839b0ba9`.
* **Root Cause**: These 1,504 records were ingested into the legacy V1 database prior to the V4 Evaluation Engine architecture. They have **never been submitted to or processed by the V4 Evaluation Engine**. Thus, the serving adapter correctly reports their state as `UNMATERIALIZED` / `LEGACY`, and the UI correctly renders them as `EVALUATION PENDING`.

#### Finding 2: Reconciling 1,498 Served Decisions vs 1,499 DB Decisions
* **Database Evidence**: `canonical_decisions` contains **1,499** rows.
* **Excluded Item**: Canonical Job ID `7e3589afb485195b6e3eb31f13e3048c48aea4356740e72c68f8ad4354fda89e` (`LinkedIn:j-2570118dab32`) is a legacy opportunity created in Migration 001 that has no corresponding row in `opportunity_versions`.
* **Serving Lineage**: `SqliteCanonicalServingStore.listOpportunities` joins `search_plan_candidates` via `INNER JOIN opportunity_versions`. Because this 1 job is not in `opportunity_versions`, it is excluded from the candidate serving stream, resulting in exactly **1,498** served decisions.

#### Finding 3: Reconciling 3,002 Screened in UI vs 3,035 Canonical in DB (33 Unprojected)
* **Database Evidence**: `canonical_opportunities` contains **3,035** rows.
* **Unprojected Items**: Exactly **33 canonical records** are sparse recovery stubs or legacy stubs without entries in `search_plan_candidates` (`attention_decision = 'CANDIDATE'`).
* **Result**: $3,035 	ext{ canonical} - 33 	ext{ un-projected} = mathbf{3,002} 	ext{ served opportunities}$.

#### Finding 4: Company Metadata Availability
* **Authoritative Company Present in DB**: **1,504 / 1,504** (100%) of the legacy records have real, non-null company names in `opportunity_versions` (e.g. *"Crisil"*, *"Cvent"*, *"Pepper"*, *"Thrive Management Services"*).
* **UI "UNKNOWN COMPANY" Render**: When viewing the `ALL (1504)` tab, the UI component defaults unmaterialized cards to `UNKNOWN COMPANY` because `evaluationState` is `LEGACY`, not because the company name is missing in the database.

---

### 4. Required Final Printout

```
FOR-4A READ-ONLY DIAGNOSTIC COMPLETE
PRODUCTION MUTATIONS: 0
APPLICATION MUTATIONS: 0
LOCALSTORAGE MUTATIONS: 0
REMEDIATION EXECUTED: NONE
1,504 RECORDS CLASSIFIED: YES
ROOT CAUSE PROVEN: YES
HARD STOP — AWAITING REMEDIATION AUTHORIZATION
```
