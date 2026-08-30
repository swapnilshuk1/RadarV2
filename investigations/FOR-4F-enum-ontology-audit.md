# FOR-4F Decision Enum & Ontology Audit

## 1. Canonical V4 Enum Set (Active)
Defined in `src/domain/decision_v4.ts` and `src/lib/intelligence/decision-resolver.ts`:
- `EXPLICIT_PURSUE`
- `ENGINE_PURSUE`
- `EXPLICIT_CONSIDER`
- `ENGINE_CONSIDER`
- `EXPLICIT_PASS`
- `ENGINE_PASS`
- `ENGINE_SPARSE_SPEC`

## 2. Obsolete Legacy V3 Enums (Deprecation Target)
Found in legacy test files and lines 853–865 of `SqliteCanonicalServingStore.ts`:
- `ENGINE_PURSUIT` (Replaced by `ENGINE_PURSUE`)
- `USER_CONFIRMED` (Replaced by `EXPLICIT_PURSUE`)
- `PREFERENCE_OVERRIDE` (Replaced by `EXPLICIT_CONSIDER`)
- `NOT_EVALUABLE` (Replaced by `ENGINE_SPARSE_SPEC`)

## 3. Discovered Mismatch Severity
- **CRITICAL**: Production server function `getExecutiveMetrics()` has not updated its internal conditional branch to V4 enums.
