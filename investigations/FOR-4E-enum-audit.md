# FOR-4E Enum Ontology & Decision State Audit

## 1. Critical Discovered Mismatch
In `src/data/sqlite/repositories/SqliteCanonicalServingStore.ts` (lines 853–865), `getExecutiveMetrics` aggregates counts using obsolete V3 enums:
```typescript
// BUG in getExecutiveMetrics:
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

## 2. Actual V4 Enums Emitted by `resolveEffectiveDecision`
- `EXPLICIT_PURSUE` (330 items)
- `ENGINE_PURSUE` (18 items)
- `EXPLICIT_CONSIDER` (19 items)
- `ENGINE_CONSIDER` (66 items)
- `EXPLICIT_PASS` (1,146 items)
- `ENGINE_PASS` (784 items)
- `ENGINE_SPARSE_SPEC` (639 items)

## 3. Consequence
Because `EXPLICIT_PURSUE` and `ENGINE_PURSUE` do not match `"ENGINE_PURSUIT"` or `"USER_CONFIRMED"`, the server function metrics silently miss them, causing the header metric ribbon to desynchronize from the client queue.
