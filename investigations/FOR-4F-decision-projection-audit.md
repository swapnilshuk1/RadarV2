# FOR-4F Decision Projection & Truth Table Audit

## 1. Truth Table: Effective Decision Resolution

| Engine Verdict | User Action | Emitted Effective Decision | Shortlist Status | Review Status | Count |
| :--- | :--- | :--- | :--- | :--- | :--- |
| PURSUE (22) | NONE (18) | **ENGINE_PURSUE** | Active Shortlist | Unreviewed | 18 |
| PURSUE (22) | PURSUE (4) | **EXPLICIT_PURSUE** | Active Shortlist | Reviewed | 4 |
| CONSIDER (80) | NONE (64) | **ENGINE_CONSIDER** | Active Shortlist | Unreviewed | 64 |
| CONSIDER (80) | CONSIDER (1) | **EXPLICIT_CONSIDER**| Active Shortlist | Reviewed | 1 |
| CONSIDER (80) | PASS (15) | **EXPLICIT_PASS** | Excluded | Reviewed | 15 |
| PASS (2,261) | NONE (1,422) | **ENGINE_PASS** | Excluded | Unreviewed | 1,422 |
| PASS (2,261) | PURSUE (326)| **EXPLICIT_PURSUE** | Active Shortlist | Reviewed | 326 |
| PASS (2,261) | PASS (513) | **EXPLICIT_PASS** | Excluded | Reviewed | 513 |
| SPARSE_SPEC (639)| NONE (557)| **ENGINE_SPARSE_SPEC**| Excluded | Unreviewed | 557 |
| SPARSE_SPEC (639)| PASS (82) | **EXPLICIT_PASS** | Excluded | Reviewed | 82 |
| **TOTAL** | | | | | **3,002** |

## 2. Key Insights
- **Actionable Queue in UI**: 18 Engine Pursue + 64 Engine Consider = **82 opportunities**.
- **Explicit User Pursuits**: 326 (overriding pass) + 4 (confirming pursue) = **330 opportunities**.
- **Engine Qualified Baseline**: 22 Pursue + 80 Consider = **102 opportunities**.
