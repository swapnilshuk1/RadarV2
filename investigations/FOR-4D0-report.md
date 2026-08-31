# FOR-4D0 — LIVE UI RUNTIME + SERVING CONTRACT DIAGNOSTIC REPORT

## Executive Summary
This diagnostic report accounts for the rendering behavior observed in the RADAR UI where cards displayed as:
```
Executive Opportunity — EVALUATION PENDING
UNKNOWN COMPANY · UNKNOWN · NAUKRI / LINKEDIN / INDEED
```
despite FOR-4C certifying 600 Category-E hydrated records and 2,098 total evaluated served records.

---

## Key Diagnostic Findings

### 1. Root Cause of "EVALUATION PENDING" Cards
- **Unmaterialized Backlog Leakage**: The database contains 3,002 candidate opportunities:
  - **2,098 Evaluated Opportunities** (1,498 restored historical decisions + 600 Category-E hydrated records).
  - **904 True Unevaluated Legacy Backlog Opportunities** (`evaluationState = 'UNMATERIALIZED'`).
- **Category Filter Bypass**: In `SqliteCanonicalServingStore.listOpportunities()`, when `options.categoryId` was specified (e.g. `transformation`), the unmaterialized records bypassed the category filter check (`if (!r.evaluation_json) continue;`). Thus, requesting `transformation` returned 27 evaluated records **plus all 904 unmaterialized records**.
- **Shortlist Feed Ingestion**: In `src/routes/index.tsx`, `shortlistedOps` explicitly returned `true` for unmaterialized records (`return true; // Show UNMATERIALIZED...`), causing unmaterialized backlog items to render directly in the shortlist feed as `<MinimalStateCard>` (`EVALUATION PENDING / UNKNOWN COMPANY`).

### 2. Root Cause of "UNKNOWN COMPANY"
- For the **1,498 restored historical records** from FOR-3, `canonical_opportunities.company_name` was populated as `'Unknown'` during historical migration.
- For the **600 Category-E hydrated records**, valid company names (`Puffy`, `Accenture`, `Swiggy`, `Microsoft`, etc.) are fully intact.
- For the **904 unmaterialized backlog records**, `company_name` is `'Unknown'`.
- When unmaterialized records were rendered via `<MinimalStateCard>`, they displayed `UNKNOWN COMPANY`.

### 3. Context Alignment Verification
- Active Context Fingerprint: `fbcfc83c5f8e7257aa2b92e1fbd91acfebf47c5f4ca3fcd167def146839b0ba9`
- Database, ServingStore, ServingEngine, and UI view-model share **100% context alignment**.

---

## Verification Results
- Vitest Test Suite: **100 passed / 100 passed (905 total tests passed)**.
- Brief Composition Engine: **2,098 / 2,098 evaluated briefs composed with 0 failures**.
- Zero Turso Database Mutations performed.
