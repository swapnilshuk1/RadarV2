# 3-Layer Rollback Strategy

Every phase (M1-M8) requires strict adherence to this 3-layer rollback strategy to prevent catastrophic regressions.

## Layer 1: Git
* **Strategy**: Tagged, known-good commits before any phase starts.
* **Action**: If a phase fails verification, `git reset --hard` to the pre-phase tag. No partial commits leak into the baseline.

## Layer 2: Database
* **Strategy**: Additive migrations with data preservation. 
* **Action**: Never use destructive `DROP` or `ALTER` during transition. Use expand → dual-write / read-compatible → verify → switch → contract. Backfills must be non-destructive.

## Layer 3: Runtime
* **Strategy**: Feature flags for safe production deployment (e.g., in M7/M8).
* **Action**: Use flags like `RADAR_EVALUATION_PATH=legacy|shadow|tenantized`. If the tenantized path throws anomalies or breaks idempotency, flip the flag back to `legacy` instantly to restore production V4.
