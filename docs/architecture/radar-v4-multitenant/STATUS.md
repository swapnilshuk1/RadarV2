# Operational Control Plane

**CURRENT PHASE**: M7 (Production Tenant Migration)  
**STATUS**: READY TO START (M6 Fully Certified)  
**NEXT PHASE**: M7 (Production Tenant Migration)  

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
* **M4 - Canonical Acquisition + Search Plan Gating**: ✅ COMPLETED (`m4-final-certified`).
  - **M4.1 - Canonical Schema**: ✅ COMPLETED WITH REMEDIATION. (Composite lineage constraints and canonical-job-version uniqueness enforced).
  - **M4.2 - Identity & Versioning**: ✅ COMPLETED. (Deterministic `canonical_job_id` and `opportunity_version` implemented via `computeDeterministicHash`).
  - **M4.3 - Attention Gate**: ✅ COMPLETED. (Deterministic metadata matching, zero LLM, synchronous, tenant-isolated candidate projection).
  - **M4.4 - Dual-Write Integration**: ✅ COMPLETED WITH ATOMICITY & FAULT ISOLATION TESTS. (Shadow-injected M4 projection alongside legacy scraper with strict fault isolation & atomic rollback).
  - **M4.5 - Operational Reconciliation**: ✅ COMPLETED WITH M4.5-R1 REMEDIATION. (Hardened composite candidate-version join, null employment type preservation, and legacy-canonical acquisition coverage audit).
* **M5 - Distributed Worker Runtime**: ✅ **COMPLETED AND CERTIFIED (`m5.6-certified`)**.
  - **Sub-Phase M5.1 — Queue Schema & Lineage**: ✅ **COMPLETED AND CERTIFIED (`m5.1-certified`)**. Migration `021_evaluation_work_queue.sql` applied with additive `evaluation_jobs` table and 4 composite FK lineage invariants.
  - **Sub-Phase M5.2 — Work Enqueuer & Idempotent Projection Sync**: ✅ **COMPLETED AND CERTIFIED (`m5.2-certified`)**. Implemented `enqueueEvaluationJobs.ts` with consumer-only context lineage and `INSERT OR IGNORE` deduplication.
  - **Sub-Phase M5.3 — Distributed Worker Runtime**: ✅ **COMPLETED AND CERTIFIED (`m5.3-certified`)**. Implemented `EvaluationWorker.ts` with atomic single-worker job claims (`locked_by`, `lease_token`), `AuthContext` tenant boundary verification, stale-lease guards, durable SQLite exponential retry backoff, and dead-letter queue routing.
  - **Sub-Phase M5.4 — Durable Evaluation Daemon**: ✅ **COMPLETED AND CERTIFIED (`m5.4-certified`)**. Implemented `EvaluationDaemon.ts` long-running polling daemon with graceful shutdown and exception survival.
  - **Sub-Phase M5.5 — Complete Eradication of Synchronous Corpus Evaluation**: ✅ **COMPLETED AND CERTIFIED (`m5.5-certified`)**. Removed legacy `OpportunityProvider` and synchronous fallback paths; serving strictly queries materialized records.
  - **Sub-Phase M5.6 — Post-M5 Runtime Consolidation**: ✅ **COMPLETED AND CERTIFIED (`m5.6-certified`)**. Hardened 7 operational domains from post-M5 scraper run with zero queue/lease regressions.
* **M6 - Credential Broker / Source Authentication**: ✅ **COMPLETED AND CERTIFIED (`m6-certified`)**.
  - **Sub-Phase M6.1 — Credential Schema & Store Integration**: ✅ **COMPLETED AND CERTIFIED (`m6.1-certified`)**. Implemented migration `022_source_credentials.sql`, domain entities, and `SqliteCredentialStore` with strict tenant-isolation, composite uniqueness `(tenant_id, source, version)`, and zero-plaintext persistence.
  - **Sub-Phase M6.2 — Cryptographic Vault & Envelope Encryption**: ✅ **COMPLETED AND CERTIFIED (`m6.2-certified`)**. Implemented authenticated AES-256-GCM envelope encryption (`CredentialVault.ts`), random 12-byte IVs, 16-byte auth tags, key provider abstraction (`InMemoryKeyProvider`, `DevDeterministicKeyProvider`), tamper detection, and zero secret leakage.
  - **Sub-Phase M6.3 — Credential Broker & JIT Leasing Engine**: ✅ **COMPLETED AND CERTIFIED (`m6.3-certified`)**. Implemented `CredentialBroker.ts` with tenant isolation, decoupled RBAC (`manage:credentials` vs `read:credentials`), transient memory-only JIT leasing, hardened state machine preventing resurrection of superseded credentials (`rotation_required -> active` prohibited), sanitized health reporting, atomic version rotation, and complete audit lineage.
  - **Sub-Phase M6.4 — Scraper Authentication & JIT Credential Injection**: ✅ **COMPLETED AND CERTIFIED (`m6.4-certified`)**. Implemented `PlaywrightCredentialInjector.ts` and `PortalAuthSession.ts` with fail-closed atomic parsing, canonical registrable domain boundary (`PORTAL_POLICY`), HTTP header CR/LF injection defense, RFC 6265 cookie token validation, diagnostic sanitization in `failure-dump.ts`, and exact auth-health attribution.
* **M7 - Production Tenant Migration**: READY TO START.
* **M8 - Rollout Sequence**: PENDING.
