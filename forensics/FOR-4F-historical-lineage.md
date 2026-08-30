# FOR-4F Historical Decisions Lineage Reconciliation

## 1. Investigation of the 1,498 Historical Decisions
The 1,498 decisions in `canonical_decisions` belong to the active executive user (`ms6i7e3y-4x0chy5fy`).

### Breakdown of Historical Decisions:
- **PURSUE**: 330 decisions
- **PASS**: 1,146 decisions
- **CONSIDER**: 22 decisions
- **Total**: **1,498**

### Status under Current Evaluation Context (`fbcfc83c5f...`):
- **1,416 candidates** (94.5%) have full active-context evaluations (`EVALUATED`).
- **82 candidates** (5.5%) are classified as `SPARSE_SPEC` (raw text < 25 words).
- **0 candidates** are missing materialization in the active context.

## 2. Historical Integrity Verdict
**FACT**: All 1,498 historical user decisions are 100% preserved and mapped to active candidates. Historical choices take absolute precedence over engine recommendations via `resolveEffectiveDecision`.
