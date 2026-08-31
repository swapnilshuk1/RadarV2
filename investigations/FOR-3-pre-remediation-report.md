# FOR-3 — PRE-REMEDIATION BASELINE & SERVING INTEGRITY REPORT

**Date**: August 29, 2026  
**Status**: PHASE 0 COMPLETE — READ-ONLY BASELINE & DIAGNOSIS VERIFIED  
**Production Database**: Turso Cloud (`libsql://radar-db-swapnilshuk1.aws-ap-south-1.turso.io`)  
**Pre-Remediation Baseline Snapshot**: `forensics/radar-turso-pre-remediation-2026-08-29.sqlite`  
**Baseline Snapshot SHA-256**: `d95b6eb1438e3e80c9f1c0d923cc40a5bfeb66e3df6dd302ddd8a0e2167dbbd1`  
**Snapshot Table Count**: 72 tables  
**Snapshot Row Count**: 16,664 rows  

---

## 1. Executive Summary & Phase 0 Completion

Phase 0 of FOR-3 has been executed in strict read-only mode against Turso Cloud. ZERO production mutations have occurred during Phase 0.

### Key Milestones Achieved:
1. **Certified Pre-Remediation Snapshot**: Captured full byte-for-byte SQLite snapshot of live Turso Cloud before any mutation.
2. **Schema & Contract Inspection**: Validated canonical identity contracts (`computeCanonicalJobId`, `computeContentHash`, `computeOpportunityVersionId`), `CanonicalIngestionService`, and `SqliteCanonicalServingStore`.
3. **Remediation Database & Ledgers Generated**: Created `forensics/FOR-3-remediation-ledger.sqlite` and 4 machine-readable JSONL ledgers.
4. **50 / CONSIDER Bug Diagnosed & Fixed**: Traced root cause of 50 silent `CONSIDER` verdicts to `adaptEngineVerdict()` in `EvaluationServingEngine.ts`. Created `tests/intelligence/serving_verdict_integrity.test.ts` (11 unit tests) and verified that all 905 suite tests pass.

---

## 2. Remediation Ledgers Summary

| Ledger Name | Source Artifact | Total Records | Action Classification | Count |
| :--- | :--- | :--- | :--- | :--- |
| **Opportunity Restoration Ledger** | Historical Oracle (2,231) | 2,231 | `ALREADY_RESTORED` | 99 |
| | | | `RESTORE_TO_CANONICAL` | 1,566 |
| | | | `RESTORE_AS_SPARSE_CANONICAL` | 566 |
| **Staging Promotion Ledger** | Staging `opportunities` (`o_...`) | 269 | `PROMOTE_VIA_CANONICAL_INGESTION_SERVICE` | 269 |
| **Decision Restoration Ledger** | Historical Audit Records | 1,514 | `RESTORE_TO_CANONICAL_DECISIONS` | 1,514 |
| **Verdict Repair Ledger** | `EvaluationServingEngine.ts` | 1 | `REFACTOR_ADAPT_ENGINE_VERDICT` | 1 |

---

## 3. Exact Expected Production Row Changes (Phase 1 Execution)

| Target Table | Current Count | Expected Insert Count | Expected Final Count | Idempotency Key / Constraint |
| :--- | :--- | :--- | :--- | :--- |
| `canonical_opportunities` | 632 | +2,132 | 2,764 | `PRIMARY KEY (id)`, `UNIQUE (source, source_job_id)` |
| `opportunity_versions` | 632 | +2,132 | 2,764 | `PRIMARY KEY (id)`, `UNIQUE (canonical_job_id, content_hash)` |
| `search_plan_candidates` | 4,424 | +14,924 | 19,348 | `UNIQUE(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)` |
| `canonical_decisions` | 0 | +1,514 | 1,514 | `PRIMARY KEY (id)`, `UNIQUE(person_id, canonical_job_id)` |
| `decisions` | 0 | +1,514 | 1,514 | `PRIMARY KEY (id)`, `UNIQUE(person_id, opportunity_id)` |
| `evaluation_jobs` | 3,204 | +1,566 | 4,770 | `UNIQUE(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)` |

---

## 4. Exact Unresolved & Excluded Populations

- **0 Unresolved Opportunities**: All 2,231 historical oracle records + 269 raw staging records are 100% mapped to deterministic 64-character SHA-256 canonical IDs.
- **566 Sparse Historical Records**: Included in restoration as `SPARSE_SPEC` canonical opportunities and version records, but enqueued to `recovery_queue` for secondary background detail enrichment.
- **1 Audit Record Identity Alias**: `jobHash: j-bcb795115916d7ba` in historical audit records maps to source ID `bcb795115916d7ba` (already canonicalized in Turso as `LinkedIn:bcb795115916d7ba`). Handled cleanly via canonical identity lookup.

---

## 5. Diagnosis & Fix: 50 / CONSIDER Serving Bug

### Root Cause Analysis:
In `src/lib/intelligence/serving/EvaluationServingEngine.ts`:
```ts
function adaptEngineVerdict(verb: unknown): EngineVerdict {
  if (verb === "PURSUE") return "PURSUE";
  if (verb === "CONSIDER") return "CONSIDER";
  if (verb === "PASS") return "PASS";
  if (verb === "NOT_EVALUABLE" || verb === "SPARSE_SPEC") return "SPARSE_SPEC";
  return "CONSIDER"; // <--- DEFECT LOCATION: Missing / null / legacy verb defaulted to CONSIDER!
}
```
When legacy evaluation objects or records lacking `engineVerdict`/`decision` fields were served, `adaptEngineVerdict(undefined)` evaluated to `"CONSIDER"`.

### Code Remediation Applied:
1. `adaptEngineVerdict()` now returns `"SPARSE_SPEC"` when the verdict is missing, null, undefined, or invalid.
2. `adaptLegacyEvaluation()` inspects `legacyOpp.verb` and `legacyOpp.verdict` in addition to `legacyOpp.decision` and `legacyOpp.engineRecommendation?.engineVerdict`.
3. Vitest suite `tests/intelligence/serving_verdict_integrity.test.ts` created with 11 tests verifying all edge cases.

---

## 6. Verification & Automated Test Status

```bash
npx vitest run tests/intelligence/serving_verdict_integrity.test.ts
# Result: 11 passed (100%)

npm test
# Result: 100 test files passed (905 tests total, 0 failures)
```

---

## 7. Mutation Plan for Phase 1 Execution

Upon user authorization, Phase 1 will execute controlled, transactionally isolated batch writes to Turso Cloud using the `DatabaseAdapter` interface:

1. **Step 1 — Historical Opportunity Ingestion**:
   - Ingest 2,132 historical opportunities via `CanonicalIngestionService` into `canonical_opportunities`, `opportunity_versions`, and `search_plan_candidates`.
2. **Step 2 — Staging Opportunity Promotion**:
   - Promote 269 raw staging opportunities with documents into `canonical_opportunities`, `opportunity_versions`, and `search_plan_candidates`.
3. **Step 3 — Historical Decision Restoration**:
   - Restore 1,514 historical audit decisions into `canonical_decisions` and `decisions` using `UPSERT` on `(person_id, canonical_job_id)`.
4. **Step 4 — Materialized Evaluation Alignment**:
   - Materialize intrinsic evaluation results for all 1,514 historical decisions into `materialized_evaluations`.
5. **Step 5 — Post-Remediation Verification**:
   - Run post-remediation audit script to verify row counts, zero foreign key errors, and 100% test suite passing.

---

## Authorization Request

Phase 0 baseline certification and diagnosis are complete. Please confirm approval to proceed with Phase 1 controlled database mutations against Turso Cloud.
