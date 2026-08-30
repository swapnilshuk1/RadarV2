# FOR-4F Production Serving Lineage & Architecture Trace

## 1. Serving Data Flow
```
Home Route (src/routes/index.tsx)
  │
  ▼
createServerFn (getOpportunitiesFn & getOpportunityMetrics)
  │
  ▼
SqliteCanonicalServingStore.listOpportunities(scope)
  │
  ├── 1. getActiveContext(scope) -> searchPlanId: 'sp_canonical_swapnil', contextFingerprint: 'fbcfc83c5f...'
  ├── 2. Query candidates from search_plan_candidates JOIN canonical_opportunities JOIN opportunity_versions
  ├── 3. LEFT JOIN materialized_evaluations (on contextFingerprint)
  ├── 4. LEFT JOIN canonical_decisions (on canonical_job_id)
  ├── 5. mapRowToDto -> resolveEffectiveDecision -> classifyOpportunityCategories
  └── 6. Return 3,002 ServedOpportunity DTOs
```

## 2. The Serving Store Flaw
In `SqliteCanonicalServingStore.getExecutiveMetrics` (lines 853–865):
```typescript
// FLAWED V3 ENUM COMPARISONS:
const eff = opp.effectiveDecision;
if (eff === "ENGINE_PURSUIT" || eff === "USER_CONFIRMED") {
  effectiveBreakdown.pursue++;
  activePursuits++;
  totalShortlisted++;
} else if (eff === "PREFERENCE_OVERRIDE" || eff === "ENGINE_CONSIDER") {
  effectiveBreakdown.consider++;
  totalShortlisted++;
}
```
Because `resolveEffectiveDecision` produces V4 enums (`EXPLICIT_PURSUE`, `ENGINE_PURSUE`), `getExecutiveMetrics` fails to count the 330 user pursuits and 18 engine pursuits, resulting in `activePursuits = 0` in the server function output.
