# Phase 3: Versioned Context + Safe Rematerialisation

This document outlines the architectural blueprint and implementation plan for Phase 3, ensuring historical context safety while establishing the path for rematerialisation without historical overwrite.

## Goal

Bring the historical-context safety mechanism to reality. Establish immutable scope-bindings, dynamic context-pointer resolution (control-plane), coverage validation, and explicit pointer activation, ensuring `v4.3` payload persistence happens cleanly on a new footprint without overwriting existing history.

## Open Questions
- None. This plan strictly aligns with the Phase 3 parameters provided.

## Proposed Changes

### 1. Database Migration Engine (Fixing `runner.ts`)
The `runner.ts` script uses a flawed `splitSqlStatements` regex which prematurely splits multi-line SQLite triggers containing `BEGIN ... END;`.
- **Action**: Rewrite the `beginDepth` tracker inside `splitSqlStatements` to accurately match `BEGIN` and `END` tokens bounded by whitespace, allowing `028_active_evaluation_context_pointers.sql` to apply its lineage triggers correctly.

### 2. Control-Plane Repository Integration (`SqliteCanonicalServingStore.ts`)
Extend the canonical serving store to support the operations expected by the pointer integrity tests:
- **`bindEvaluationContextScope`**: Inserts into `evaluation_context_scopes` to declare an immutable context intent. Triggers verify actual lineage exists in `evaluation_contexts`.
- **`activateContextPointer`**: Modifies the `active_evaluation_contexts` control-plane pointer to actively serve the target fingerprint for read-routing.
- **`getRematerialisationManifest`**: Determines safe rematerialisation coverage by counting `opportunity_versions` (where `lifecycle_state = 'ACTIVE'`) against `materialized_evaluations` for a specific target `context_fingerprint`.

### 3. Read Routing Cutover (`SqliteCanonicalServingStore.ts`)
- Modify `getActiveContext()` to respect the pointer in `active_evaluation_contexts`. 
- Only if no pointer is active, fall back to the highest/latest historical fingerprint to ensure legacy systems don't break during migration.

## Verification Plan

### Automated Tests
Run the existing pointer and trigger verification tests:
- `npx vitest run tests/persistence/evaluation_context_pointers.test.ts`
- `npx vitest run tests/persistence/evaluation_context_pointer_trigger.test.ts`

These tests mathematically prove that:
- Forged scope bindings fail.
- Cross-scope activation violates foreign keys.
- Historical overwrite is impossible as pointer tables strictly limit evaluation serving identity.
