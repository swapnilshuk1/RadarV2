# FOR-4G — HISTORICAL DECISION INTEGRITY & PROTECTION RECONCILIATION

## 1. Executive Determination: CANNOT PROVE HISTORICAL PRESERVATION

**Audit Verdict**: **HISTORICAL PRESERVATION IS DISPROVEN.**
In `FOR-4F-integrity-audit.json`, the automated audit check explicitly emitted:
```json
"historicalDecisionsPreserved": false
```
While narrative sections of FOR-4F claimed *"historical decisions: 1,498 user decisions are 100% intact"*, row-level evidence proves this narrative assertion was false.

A comprehensive row-by-row comparison between the baseline historical decision ledger (`FOR-3-decision-restoration-ledger.jsonl`, captured at `2026-08-16T00:00:00.000Z`), the legacy `decisions` table (600 rows), and current live `canonical_decisions` (1,509 rows) proves that **255 user decisions suffered action mutations**, timestamps were overwritten to `2026-08-29 01:48:xx`, and 10 sparse decisions were severed from serving feeds.

---

## 2. Quantitative Historical Reconciliation

| Dataset | Total Rows | PURSUE | CONSIDER | PASS | NONE |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Legacy `decisions` Table** | 600 | 147 | 72 | 381 | 0 |
| **FOR-3 Restoration Ledger** | 1,514 | 367 | 196 | 936 | 15 |
| **Live `canonical_decisions` Table** | 1,509 | 474 | 138 | 897 | 0 |
| **Decisions on Active Candidates** | 1,508 | 474 | 138 | 896 | 0 |
| **Decisions on Evaluated Candidates** | 1,498 | 472 | 137 | 889 | 0 |
| **Decisions on SPARSE_SPEC Candidates** | 10 | 2 | 1 | 7 | 0 |
| **Orphan Decision (Unversioned Opp)** | 1 | 0 | 0 | 1 | 0 |

### Row-Level Variance Breakdown:
1. **Total Action Mutations**: **255 decisions** have different `action` values in `canonical_decisions` compared to `FOR-3-decision-restoration-ledger.jsonl`.
2. **Net Shift in Decisions**:
   - PURSUE increased from 367 $\to$ 474 (+107)
   - CONSIDER decreased from 196 $\to$ 138 (-58)
   - PASS decreased from 936 $\to$ 897 (-39)
3. **Timestamp Overwrites**:
   - Historical timestamps (`2026-08-16T00:00:00.000Z`) were overwritten by `2026-08-29 01:48:xx` during mutation runs in script `for3_phase1d_controlled_mutation.ts`.
4. **Fingerprint Overwrites**:
   - All 1,509 `canonical_decisions` have `reviewed_fingerprint = null`, breaking linkability to historical evaluation contexts and triggering `REVIEWED_UNKNOWN` workflow states.

---

## 3. Detailed Audit of Action Mutations (Representative Sample of 255)

| Canonical Job ID | Source Job ID | Historical Action (FOR-3) | Canonical Action (Live) | Historical Timestamp | Canonical Timestamp | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `eccfe4c45fe39403...` | `j-0379479f0b86` | **CONSIDER** | **PASS** | 2026-08-16 00:00:00 | 2026-08-29 01:48:44 | ACTION_MUTATION |
| `c72ffe5132dce25e...` | `j-0a5b3c5f63e7` | **PASS** | **PURSUE** | 2026-08-16 00:00:00 | 2026-08-29 01:48:44 | ACTION_MUTATION |
| `62fcab65b8d4e3ef...` | `j-22b86a7804ae` | **CONSIDER** | **PURSUE** | 2026-08-16 00:00:00 | 2026-08-29 01:48:44 | ACTION_MUTATION |
| `9f9958d9f8f3afe6...` | `j-38239011e477` | **PASS** | **PURSUE** | 2026-08-16 00:00:00 | 2026-08-29 01:48:45 | ACTION_MUTATION |
| `62515051b3458635...` | `j-3c7a0573de05` | **PASS** | **PURSUE** | 2026-08-16 00:00:00 | 2026-08-29 01:48:45 | ACTION_MUTATION |
| `312015fa8b30efab...` | `j-46f9037c8ee3` | **PASS** | **CONSIDER** | 2026-08-16 00:00:00 | 2026-08-29 01:48:46 | ACTION_MUTATION |
| `164a2f8b5062a433...` | `j-473d09a805ea` | **CONSIDER** | **PASS** | 2026-08-16 00:00:00 | 2026-08-29 01:48:46 | ACTION_MUTATION |
| `48ba95d43e5362bf...` | `j-4c07923412f1` | **PASS** | **PURSUE** | 2026-08-16 00:00:00 | 2026-08-29 01:48:46 | ACTION_MUTATION |
| `b0ef39f7a7bb69d4...` | `j-4fb6034c56be` | **CONSIDER** | **PASS** | 2026-08-16 00:00:00 | 2026-08-29 01:48:47 | ACTION_MUTATION |
| `f4d6d67417e801a6...` | `j-502a5c37021b` | **CONSIDER** | **PURSUE** | 2026-08-16 00:00:00 | 2026-08-29 01:48:47 | ACTION_MUTATION |

---

## 4. Cross-Tabulation: Legacy `decisions` (600) vs Live `canonical_decisions`

Joining `decisions` ($N=600$) to `canonical_decisions` via `canonical_opportunities.source_job_id`:

| Legacy Action (`decisions`) | Canonical Action (`canonical_decisions`) | Row Count | Status |
| :--- | :--- | :--- | :--- |
| **CONSIDER** | **CONSIDER** | 50 | PRESERVED |
| **CONSIDER** | **PASS** | 7 | MUTATED |
| **CONSIDER** | **PURSUE** | 15 | MUTATED |
| **PASS** | **PASS** | 336 | PRESERVED |
| **PASS** | **PURSUE** | 45 | MUTATED |
| **PURSUE** | **CONSIDER** | 3 | MUTATED |
| **PURSUE** | **PASS** | 27 | MUTATED |
| **PURSUE** | **PURSUE** | 117 | PRESERVED |
| **TOTAL** | | **600** | **503 Preserved (83.8%), 97 Mutated (16.2%)** |

---

## 5. Root Cause of Mutation & Non-Preservation

1. **Uncontrolled Script Overwrites**: Prior remediation runs (`for3_phase1d_controlled_mutation.ts` and `FOR-4B` staging promotions) executed `INSERT ... ON CONFLICT DO UPDATE SET action = EXCLUDED.action` using synthetic or recalibrated action lists rather than strictly immutable historical user captures.
2. **Loss of Provenance Metadata**: The historical audit log timestamps were overwritten with runtime execution timestamps (`2026-08-29 01:48:xx`).
3. **Decoupling of SPARSE Decisions**: 10 user decisions recorded on sparse opportunities were excluded from `SqliteCanonicalServingStore` because `toUnavailableState()` diverts `SPARSE_SPEC` into `UnavailableOpportunity` before hydrating `userDecision`.

---

## 6. Authoritative Historical Integrity Conclusion

RADAR v2 cannot truthfully claim historical preservation. Exactly **255 user decisions** have been mutated since the baseline capture. Any future remediation must preserve the current state as a declared baseline or explicitly restore from the immutable FOR-3 ledger if rollback is authorized.
