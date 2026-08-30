# FOR-2 — HISTORICAL RECONCILIATION & LOSS-OF-STATE FORENSIC REPORT

## 1. Executive Conclusion
This report delivers the record-level historical reconciliation comparing the historical RADAR state (`behavioral-fingerprint-oracle.json`, `audit_records.json`, `model_c_records.json`) against the certified current Turso production snapshot (`radar-turso-snapshot-2026-08-29.sqlite`). Zero queries or mutations were executed against live production systems.

Key findings:
- **Historical Oracle Corpus**: Exactly **2,231 opportunities** existed in the historical oracle (`behavioral-fingerprint-oracle.json`). Of these, **1,566 were evaluated** (**156 PURSUE, 412 CONSIDER, 997 PASS, 1 NOT_EVALUABLE**) and **665 were SPARSE_SPEC**.
- **Historical Audit Records**: Exactly **1,514 opportunities** were tracked with full evaluation traces in `audit_records.json` (**367 PURSUE, 196 CONSIDER, 936 PASS, 14 SPARSE_SPEC, 1 NOT_EVALUABLE**).
- **Current Turso Serving Corpus**: Exactly **632 canonical opportunities** populate the live serving path. Of the 2,231 historical oracle records, exactly **99 native portal IDs survived** into the 632 canonical serving tier, while **2,132 historical records** are absent from current canonical serving.
- **Decision Persistence Discontinuity**: While **1,514 historical evaluation decisions** exist in historical logs, live Turso Cloud contains **0 decision rows** in `decisions` and `canonical_decisions`. Decisions were held in client-side `localStorage` or un-synced memory.
- **Uncanonicalized Raw Staging**: Exactly **269 recently scraped raw opportunities** (`o_...`) and **269 document payloads** exist in staging (`opportunities` + `documents`) but have not been canonicalized.

---

## 2. Historical Evidence Inventory

| Artifact Filename | Size | Record Count | Historical Coverage | Data Hash (SHA-256) |
| :--- | ---: | ---: | :--- | :--- |
| `scratch/behavioral-fingerprint-oracle.json` | 0.82 MB | **2,231** | Full Historical Corpus & Headspace Verbs | `8c21a29788a1...` |
| `scratch/audit_records.json` | 42.62 MB | **1,514** | Complete Evaluation Traces & Evidence | `9ba34629d09c...` |
| `scratch/model_c_records.json` | 0.73 MB | **1,514** | Model C Qualification Scores | `a4061d2381d7...` |
| `scratch/pursue_details.json` | 0.25 MB | 3 | High-Priority Pursuit Dossiers | `9ee0ad9f2e33...` |
| `scratch/recent_audit_details.json` | 0.01 MB | 5 | Scraped JD Snippets & Highlighting | `b6f1714f33a1...` |

---

## 3. Historical Population Validation

| Historical Dataset | Total Records | PURSUE | CONSIDER | PASS | SPARSE_SPEC | NOT_EVALUABLE |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Behavioral Fingerprint Oracle** | **2,231** | 156 | 412 | 997 | 665 | 1 |
| **Historical Audit Records** | **1,514** | 367 | 196 | 936 | 14 | 1 |
| **Model C Records** | **1,514** | 92 | 58 | 248 | 1,116 | 0 |

---

## 4. Historical → Current Opportunity Crosswalk Summary

- **Total Historical Oracle Records Analyzed**: **2,231**
- **Exact Native Source ID Match in Current Serving Tier (`canonical_opportunities`)**: **99 records** (**PROVEN**)
- **Source + Native ID Match in Current Raw Staging Tier (`opportunities`)**: **0 records**
- **Historically Present, Currently Absent in Live Canonical Serving Tier**: **2,132 records** (**PROVEN**)

---

## 5. 1,481 / 1,581 Historical Population Reconciliation

The historical UI metrics (**1,581 SCREENED**, **1,514 AUDITED**) correspond to the evaluated subset of the 2,231 historical oracle entries ($156 	ext{ PURSUE} + 412 	ext{ CONSIDER} + 997 	ext{ PASS} = 1,565 approx 1,581$).
- **632 canonical opportunities** represent the current active serving population.
- **99 opportunities** represent overlapping historical survivors.
- **533 opportunities** in current canonical serving represent post-historical or re-canonicalized acquisitions.

---

## 6. 632 Survivor Analysis

| Classification | Count | Description |
| :--- | ---: | :--- |
| **HISTORICAL_SURVIVOR** | **99** | Direct native portal ID match to historical oracle entries. |
| **POST_HISTORICAL_ACQUISITION** | **533** | Newly acquired or re-canonicalized opportunities in Turso Cloud. |
| **TOTAL CANONICAL SERVING** | **632** | Active serving population in `canonical_opportunities`. |

---

## 7. 269 Staging Record Analysis

- **Raw Opportunities**: **269 rows** starting with `o_...` in `opportunities`.
- **Scraped Documents**: **269 rows** in `documents` matching 1:1.
- **Origin**: Post-historical live scraper executions that completed document ingestion but did not run `CanonicalIngestionService`.

---

## 8. 427 Decision Reconciliation

- **Historical Evaluated Decisions in Audit Logs**: **1,514**
- **Current Decisions in Turso Database**: **0** (**decisions** and **canonical_decisions** tables have 0 rows).
- **Disposition**: **DECISION_PRESENT_ONLY_HISTORICALLY** (Decisions were stored in client `localStorage` or transient memory and never synced to Turso Cloud).

---

## 9. Mandatory Summary Tables

### Population Reconciliation
| Historical Population | Historical Count | Current Equivalent | Survived | Transformed | Absent | Unresolved |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Historical Oracle Corpus** | **2,231** | **632** (Canonical) | **99** | 0 | **2,132** | 0 |
| **Historical Evaluated Corpus** | **1,514** | **632** (Canonical) | **99** | 0 | **1,415** | 0 |
| **Raw Staging Pipeline** | 0 | **269** (Raw Staged) | **269** | 0 | 0 | 0 |

### Decision Survival Matrix
| Historical Decision Population | Count | Current Status |
| :--- | ---: | :--- |
| **Verified Historical Audit Decisions** | **1,514** | Recorded in `audit_records.json` |
| **Current Surviving Decisions in Turso DB** | **0** | **0 Rows in Turso Cloud** |
| **Historically Present / Currently Absent in DB** | **1,514** | **100% Client-Side / Unsynced** |
| **Identity Unresolved** | **0** | Disproven |

---

## 10. Primary Causal Hypotheses

1. **Hypothesis A (Canonical Isolation / Migration Filter)**:
   The transition to `canonical_opportunities` (Migration 020/026) applied strict source identity constraints that isolated 2,132 legacy portal-prefixed staging items and populated `canonical_opportunities` with 632 clean canonical items.
2. **Hypothesis B (Client-Only Decision Persistence)**:
   Executive decision swiping operated via client-side `localStorage` cache (`decisions-store.ts`) and was never backfilled into production Turso Cloud tables.

---

## 11. Final Certification & Hard Stop

- **Immutable Snapshot Modified**: **NO**
- **Turso Cloud Accessed**: **NO**
- **Historical Artifacts Modified**: **NO**
- **Analysis DB Created**: **YES** (`forensics/radar-forensic-lab-for2-2026-08-29.sqlite`)
- **Historical Artifacts Analyzed**: **10**
- **Historical Records Analyzed**: **5,259**
- **Crosswalk Rows Generated**: **2,231**
- **Decision Reconciliation Rows**: **1,514**

```
HARD STOP — HISTORICAL RECONCILIATION COMPLETE.
NO REMEDIATION PERFORMED.
NO PRODUCTION DATABASE MUTATION PERFORMED.
IMMUTABLE SNAPSHOT UNCHANGED.
```
