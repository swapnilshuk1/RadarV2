# FOR-4E Baseline & Live State Certification

**Audit Timestamp**: 2026-08-29T21:08:11.040Z  
**Scope**: Tenant `tenant_default` | Person `ms6i7e3y-4x0chy5fy`  
**Active Context**: `fbcfc83c5f8e7257aa2b92e1fbd91acfebf47c5f4ca3fcd167def146839b0ba9`

## 1. Database Table Counts (Live Turso Cloud)
- `canonical_opportunities`: 3,002
- `opportunity_versions`: 3,002
- `search_plan_candidates`: 3,002 (Active: 3,002)
- `materialized_evaluations`: 5,604 (Across all fingerprints)
- `canonical_decisions`: 1,498
- `evaluation_jobs`: 3,204
- `evaluation_contexts`: 11

## 2. Active Candidate Breakdown (3,002 Total)
- **Evaluated**: 2,363 (78.7%)
- **SPARSE_SPEC**: 639 (21.3%)
- **Unmaterialized**: 0 (0.0%)

## 3. Decisions & Engine Verdicts
- **User Decisions**: 1,498 (330 Pursue, 1,146 Pass, 22 Consider)
- **Engine Verdicts**: 22 Pursue, 80 Consider, 2,261 Pass, 639 Sparse Spec
- **Actionable Unreviewed Queue**: 82 (18 Engine Pursue + 64 Engine Consider)
