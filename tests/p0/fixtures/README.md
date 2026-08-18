# Phase 0 Test Fixtures

## Purpose

Canonical, version-controlled test data for P0 invariants. No mutation at runtime. All fixtures are deterministic factories that return fresh objects.

## Fixture Categories

| Fixture | Purpose | Validates |
|:---|:---|:---|
| `sparse-commercial.ts` | Minimal JD for commercial role (<25 words) | P0-B: Evidence Gate SPARSE_SPEC identification |
| `sparse-noncommercial.ts` | Minimal JD for engineering/non-commercial role | P0-B: SPARSE_SPEC → PASS path for non-commercial |
| `grounded-commercial.ts` | Fully-specified BMW-like JD with explicit quotes | P0-A: Evidence with trusted provenance passes |
| `ungrounded-evidence.ts` | Structured evidence absent from rawText | P0-A: Evidence without provenance rejected |
| `candidate-levels.ts` | Director / VP / C-Suite candidate projections | P0-E: Candidate level classifier respected |

## Fixture Factory Contract

Each fixture file exports:

```typescript
export const FIXTURE_NAME: {
  source: OpportunitySource;      // Raw opportunity as would be ingested
  expected: {
    evaluationStatus: EvaluationStatus;
    vetoed: boolean;
    priority: number | null;
    // ... other expected values
  };
}

export function createFixture(): OpportunitySource;  // Factory returning fresh copy
```

## Immutability Rule

Fixtures must be JSON-serializable pure objects. No functions, no dates (use ISO strings), no circular references.
