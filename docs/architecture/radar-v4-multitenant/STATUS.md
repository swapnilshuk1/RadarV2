# Operational Control Plane

**CURRENT PHASE**: M3  
**STATUS**: COMPLETED  
**NEXT PHASE**: M4 (Canonical Acquisition + Search Plan Gating)  

## Phase History
* **M0 - Contracts, Governance, and Baselines**: COMPLETED. Control documents generated. Golden V4 regression suite frozen as safety net.
* **M1 - Tenant Isolation Foundation**: COMPLETED & CERTIFIED.
  - Schema migration 018 verified with users, tenants, memberships, and people.tenant_id.
  - AuthContext, AuthorizedPersonScope, authenticateTenantMembership, and authorizePersonScope implemented.
  - TenantScopedPersonStore isolation repository implemented.
  - Negative isolation tests (16/16) and EQE golden certification (100%) passing.
  - TypeScript build and compilation passing.
* **M2 - Ontology v3 Tenantization**: COMPLETED & FULLY CERTIFIED.
  - **Pure Semantic Fingerprint**: `compiledOntologyHash` = SHA-256(version + compiledOntology), independent of `tenantId`. Identical semantic configurations produce identical hashes.
  - **Additive Specialization**: Renamed `CustomKeywordOverride` -> `CustomKeywordExtension` reflecting additive keyword semantics.
  - **Extraction Sensitivity Semantics**: Documented that `excludedTerms` narrows extraction sensitivity without mutating canonical baseline.
  - **Deterministic OntologyCompiler**: Deep-cloned immutability baseline and canonical normalization across all entities.
  - **Structural ID Validation**: Uniqueness verification across domains, disciplines, and capabilities (`validateOntologyGraphUniqueness`).
  - **Exhaustive Legacy Parity**: Verified 100% deep equality between compiled default config and normalized canonical v3 ontology.
  - **Extraction & Context Isolation Integration Test**: Tested Tenant A vs Tenant B compiled ontologies through `CapabilityAssessmentEngine` proving isolated extraction behavior.
  - **V4 Policy Boundary Protected**: 0 modifications to `DecisionPolicyEngine`, eligibility gates, scoring formulas, or ranking.
  - **Traceability Documented**: Explicitly documented `context.ts` and `CapabilityAssessmentEngine.ts` wiring.
  - 100% pass on all 48 test files (563 tests), EQE certification harness, and SSR/Nitro production build.
* **M3 - Evaluation Context & Read Model**: COMPLETED & FULLY CERTIFIED.
  - **Schema & Immutability**: Established `search_plans`, `search_plan_snapshots`, and `evaluation_contexts` strictly without update APIs.
  - **Relational Integrity**: Enforced materialized evaluations to match payload tenant scope and snapshot identities.
  - **Fingerprint Contracts**: Implemented SHA-256 serialization bounds exactly as approved.
  - **Freshness Evaluation Matrix**: Successfully implemented and verified strict invalidation combinations.
  - **Cross-Tenant Isolation Tests**: Created security tests strictly guarding deputy leaks across `AuthContext`.
  - 100% pass across all tests, type checks, and staging deployment via Oracle SSH.
* **M4 - Canonical Acquisition + Search Plan Gating**: IN PROGRESS.
  - **M4.1 - Canonical Schema**: ✅ COMPLETED WITH REMEDIATION. (Composite lineage constraints and canonical-job-version uniqueness enforced).
  - **M4.2 - Identity & Versioning**: 🟡 PENDING.
  - **M4.3 - Attention Gate**: 🟡 PENDING.
  - **M4.4 - Dual-Write Integration**: 🟡 PENDING.
  - **M4.5 - Operational Reconciliation**: 🟡 PENDING.
* **M5 - Distributed Worker Runtime**: PENDING.
* **M6 - Credential Broker / Source Authentication**: PENDING.
* **M7 - Production Tenant Migration**: PENDING.
* **M8 - Rollout Sequence**: PENDING.
