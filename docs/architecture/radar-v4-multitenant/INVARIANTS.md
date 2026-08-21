# Strict V4 Production Invariants

1. **No tenant-specific state may influence another tenant's evaluation.**
2. **No tenant-specific configuration may alter canonical RADAR policy semantics.**
3. **The canonical V4 decision policy, canonical ontology semantics, and evidence/provenance contracts are platform-level artifacts.**
4. **One canonical opportunity version evaluated under one immutable evaluation context produces exactly one materialized evaluation.**
   - Enforced via: `UNIQUE(canonical_job_id, opportunity_version, evaluation_context_fingerprint)`
5. **A `personId` can never enter an execution context unless proven to belong to the authorized tenant via an `AuthContext`.**
6. **Jobs are scraped once globally, evaluated N times locally.**
7. **`canonical_job_id` is deterministically derived from stable source identity—never content.**
