# RADAR v2 — Permanent Test Architecture Map & Inventory

Operations & Recovery: `tests/security/admin-operations.test.ts`,
`tests/security/tavily-hardening.test.ts`,
`tests/security/host-provider-recovery.test.ts`, and
`tests/security/notification-lifecycle.test.ts` belong to `tenant-security`.
Together they verify role boundaries, encrypted connection activation, durable
maintenance health, provider recovery and cooldown fencing, exact recovery
cohorts, pause/expiry precedence, terminal cohort visibility, and signed alert
delivery through resolution, rotation, retries, and batching.

This document defines the authoritative test domains, invariant contracts, certification stage mappings, and full mechanical test registry for the RADAR v2 Executive Intelligence Engine.

---

## 1. Governance Policy: The Invariant-First Protocol

All future coding agents and engineers modifying or adding tests MUST adhere to this strict six-step protocol:

1. **Identify the Invariant**: State what system behavior, data relationship, security boundary, or UI contract is being verified.
2. **Check for Authoritative Home**: Inspect this document to determine whether the invariant is already covered in one of the canonical domain suites below.
3. **If Unique and Valid**: Keep and modernize the test in its proper canonical domain.
4. **If Duplicate**: Consolidate into the authoritative suite rather than proliferating milestone-numbered files (`mXX`, `pXX`, `phaseXX`).
5. **If Obsolete**: Delete obsolete tests after verifying invariant coverage is preserved in the canonical domain suites; Git history is the archive. Zero archive test directories or files are retained on disk.
6. **Incremental Verification**: Run the smallest authoritative suite that covers the
   change. Use `npm run certify:affected` for mapped regression feedback and run the
   full `npm run certify` once on the final release candidate. Do not rerun unrelated
   suites after a narrow fix merely because the SHA changed.

A registry label such as **Full Suite** describes where a test belongs; it does not
mean the full suite must run after every edit. Successful evidence remains valid
until a later change can reasonably affect that invariant. Test-only, inventory-only,
formatting-only and documentation-only changes invalidate only their directly
dependent checks. See `docs/VERIFICATION_AND_RELEASE.md`.

---

## 2. Canonical Test Domains & Authoritative Suites

RADAR v2 test architecture is organized into **11 Canonical Domains** with a mandatory Gate 0 safety overlay:

```
RADAR v2 Test Architecture
 ├── 1. Ingestion & Lineage (FK integrity, content hash, version resolution)
 ├── 2. Identity & Candidate Projection (Executive seniority, domains, preferences)
 ├── 3. Semantic Grounding (Ontology mapping, capability clusters, dimension proof)
 ├── 4. Evaluation & Policy (DeterministicScorer, DecisionPolicyEngine, reach gates)
 ├── 5. Decision Persistence (canonical_decisions UPSERT, idempotent sync, feed parity)
 ├── 6. Serving & Pagination (Keyset pagination, cursor decoding, singleflight cache)
 ├── 7. Metrics & Aggregation (Global search plan sums, portal counts, review queue)
 ├── 8. Security & Tenant Isolation (Multi-tenant partition, credential encryption, scope resolution)
 ├── 9. Editorial / Verdict Governance (Rule 13 prose, score resolution, badge states)
 ├── 10. UI / User Journeys (Boundary Journeys A, B, C, D)
 └── 11. Certification Integrity (Meta-testing of the certification gate itself)
```

---

### Domain 1: Ingestion & Lineage

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/intelligence/canonical-ingestion-fk-regression.test.ts` | Resolves existing `opportunity_versions.id` on conflict; zero orphan foreign keys. | **Stage 3** |
| `tests/intelligence/canonical-acquisition-integrity.test.ts` | Multi-portal acquisition payload validation, SHA-256 content hashing, and version lineage. | **Stage 3** |
| `tests/acquisition/ingestion-lineage.test.ts` | Durable source-card/run to exact canonical job/version lineage, retry idempotency, and tenant/run scope isolation. | **Stage 3** |
| `tests/acquisition/indeed-listing-identity.test.ts` | Indeed sponsored/direct URL normalization, bounded redirect safety, and stable `jk` canonical identity. | Full Suite |
| `tests/acquisition/scoped-ingestion.test.ts` | A shared canonical opportunity is projected only into the authenticated tenant/person's active plan. | Full Suite |
| `tests/intelligence/canonical-identity.test.ts` | Opt-in live canonical-account audit; never part of deterministic certification. | Operator only |
| `tests/persistence/queue-crash-restart.test.ts` | Turso operational queue crash recovery, idempotency, concurrent lease exclusion, and zero filesystem state. | **Stage 3** |
| `tests/persistence/scrape-run-state-machine.test.ts` | Atomic active run race, cross-tenant/person concurrency, terminal immutability, restart durability. | **Stage 3** |
| `tests/persistence/cross-instance-payload-retrieval.test.ts` | Distributed BlobStore payload retrieval across isolated process/disk instances, missing blob graceful failure. | **Stage 3** |
| `tests/persistence/distributed-lease-contention.test.ts` | Multi-instance concurrent lease mutual exclusion, non-claiming loser invariant, and crash failover. | **Stage 3** |
| `tests/persistence/blob-store-connectivity.test.ts` | Multi-backend BlobStore connectivity, S3 REST protocol, 404/error handling, and synthetic probe healthCheck. | **Stage 3** |
| `tests/scraper/scraper-correctness-contract.test.ts` | Authoritative active-plan resolution, zero fallback/zero units for authenticated runs, and Indeed sparse detail preservation. | Full Suite |
| `tests/scraper/scraper-acquisition-contract.test.ts` | LinkedIn fast hydration & exit, universal sparse preservation (LinkedIn/Naukri), and failure transparency without fake empty results. | Full Suite |
| `tests/acquisition/golden-recovery-lineage-cohort.test.ts` | Authoritative golden production lineage cohort from run-1788527028264; verifies canonicalJobId !== cardHash hand-off across 17 recovered records, admission lineage precedence, zero o_... forks, and alias resolution. | Full Suite |
| `tests/acquisition/reset-corpus-fail-closed.test.ts` | Fail-closed corpus deletion, query error handling, and exact-row invariance on preserved tables. | Full Suite |
| `tests/scraper/indeed-jk-provenance.test.ts` | Strict 16-hex character JK validation, non-JK employer requisition isolation, and fast-fetch ATS direct resolution. | Full Suite |
| `tests/acquisition/gate1-pipeline-invariants.test.ts` | Dynamic work drain, HealthManager FastPath delegation, contentOrigin enforcement, pre-admission dedupe. | Full Suite |
| `tests/scraper/naukri-pagination-telemetry.test.ts` | Non-overlapping work-unit pagination mapping, out-of-bounds rejection, scroll quota accumulation, and telemetry. | Full Suite |
| `tests/scraper/naukri-provenance.test.ts` | Explicit full-JD provenance flag validation, prevention of length-based inference, and native detail fetch routing. | Full Suite |
| `tests/acquisition/gate2-target-depth.test.ts` | Canonical geography semantics, fail-narrow portal geo mapping, multi-location variant compilation, source-identity novelty evaluation, and structured SPA extraction. | Full Suite |
| `tests/persistence/populated-migration.test.ts` | Populated database migration across 001-043, proving zero foreign key check violations and row identity preservation. | **Stage 3** |
| `tests/acquisition/post-gate3-acquisition-integrity.test.ts` | Atomic pre-transaction BlobStore write, unconditional enrichment job creation & run binding, complete enrichment fast-path to READY, version identity payload assertion, and authenticated resume validation. | Full Suite |
| `tests/scraper/scraper-operability.test.ts` | Scraper Operability Patch: planless scoped runs truthful returns, migration 046 nullable search plan rebuild, active run partial unique index, machine profile mode/tenant retirement, cross-scope profile isolation & fail-closed rename, atomic legacy migration, fresh vs stale corrupt lock handling, native Chromium UA, single-authority confirmation without TDZ, and DB-free GLOBAL local-only acquisition. | **Stage 3** |

---

### Domain 2: Identity & Candidate Projection

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/intelligence/identity.test.ts` | Executive seniority categorization (`C_SUITE`, `VP`), role matching, and theme extraction. | Full Suite |
| `tests/intelligence/candidate-profile-scope.test.ts` | Candidate profile persistence and resolution remain strictly tenant/person scoped. | Full Suite |
| `tests/intelligence/profile-projection-version-compat.test.ts` | Legacy profile projections deterministically reproduce the exact context-pinned content version without a latest-row fallback. | Full Suite |
| `tests/intelligence/profile-journey-controls.test.ts` | Profile processing, recommendation refresh, and polling controls. | Full Suite |
| `tests/intelligence/recommendation-freshness.test.ts` | Recommendation freshness follows immutable profile and evaluation context versions. | Full Suite |
| `tests/security/evidence-dedup-repository-scope.test.ts` | Content-hash evidence reuse is scoped to the owning candidate at the repository boundary. | **Gate 0 Safety** |
| `tests/security/scraper-auth-permission-non-escalation.test.ts` | Scraper authorization preserves membership grants and never manufactures scraper or credential capabilities. | **Gate 0 Safety** |

---

### Domain 3: Semantic Grounding

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/intelligence/staged-decision.test.ts` | Typed entry-selection adjudication, candidate mapping, gap classification, and decision-boundary invariants for staged intelligence. | **Stage 3** |
| `tests/intelligence/staged-production-integration.test.ts` | Staged source identity, policy-context isolation, and persistence boundaries. | **Stage 3** |
| `tests/intelligence/bedrock-converse-model.test.ts` | Bedrock Mantle and Converse requests, schema, credential parsing/redaction, and provider failure handling. | **Stage 3** |
| `tests/intelligence/bedrock-schema.test.ts` | Standards-compliant Bedrock JSON Schema projection for dossier contracts. | Full Suite |
| `tests/intelligence/dossier-grounding.test.ts` | Evidence-plane, provenance, and grounded dossier validation invariants. | Full Suite |
| `tests/intelligence/dossier-source-authority.test.ts` | Immutable source snapshot and source-authority boundary. | Full Suite |
| `tests/intelligence/evidence-extraction-bedrock.test.ts` | Bedrock source-extraction schema and exact-evidence contract. | Full Suite |
| `tests/intelligence/staged-screening-authority.test.ts` | Staged screening authority and exact-JD evidence boundary. | Full Suite |
| `tests/semantic/ontology.test.ts` | Comprehensive executive ontology validation (roles, capabilities, industries, seniority). | Full Suite |
| `tests/semantic/normalization.test.ts` | Currency, date, location, and seniority string normalization. | Full Suite |

---

### Domain 4: Evaluation & Policy

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/policy/eligibility-gates.test.ts` | Strict evaluation of core eligibility criteria (location, seniority, operating model). | Full Suite |
| `tests/policy/atomic-plan-activation.test.ts` | Replacing career intent produces a complete, immediately routeable evaluation context or rolls back without stale-plan exposure. | Full Suite |
| `tests/intelligence/job-projection-role-work.test.ts` | JobProjectionBuilder retains bounded responsibilities and outcomes while excluding qualifications and corporate copy. | Full Suite |

---

### Domain 5: Decision Persistence

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/certification/journey_c_decision_persistence_to_dto.test.ts` | Rapid user decision updates idempotently upsert `canonical_decisions` and reflect immediately in Feed DTO. | **Stage 2** |
| `tests/intelligence/m9_3-decisions-store-client.test.ts` | Optimistic UI store synchronization with server functions and rollback on error. | Full Suite |

---

### Domain 6: Serving & Pagination

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/serving/keyset_pagination.test.ts` | Keyset pagination returns deterministic, contiguous pages without duplicate rows. | **Stage 5** |
| `tests/serving/cursor.test.ts` | Opaque cursor encoding, decoding, validation, and tamper-resistance. | **Stage 5** |
| `tests/serving/singleflight_and_observability.test.ts` | Singleflight request coalescing prevents duplicate concurrent database queries. | **Stage 5** |
| `tests/serving/singleflight-scope-isolation.test.ts` | 10 concurrent requests coalesce to 1 underlying query; complete tenant, person, and search-plan scope isolation. | **Stage 5** |
| `tests/serving/decided-population-completeness.test.ts` | Decided-opportunity retrieval exhausts keyset pages and never hides records after the first 50. | **Stage 5** |
| `tests/serving/sql_feed_parity.test.ts` | Serving feed SQL queries match materialized evaluation and user decision states. | **Stage 5** |
| `tests/persistence/deployment-determinism.test.ts` | OpportunityService delegates serving queries exclusively to repos.canonicalServing and DatabaseAdapter with zero filesystem fallbacks. | **Stage 5** |

---

### Domain 7: Metrics & Aggregation

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/intelligence/metrics-portal-breakdown.test.ts` | Portal metrics represent full database search plan population, not local page samples. | **Stage 3** |
| `tests/serving/sql_metrics_aggregation.test.ts` | Canonical population, engine/user/effective metric partitions reconcile independently; `allRecordedDecisions = userBreakdown.total`. | **Stage 5** |

---

### Domain 8: Security & Tenant Isolation

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/security/scope-resolver-equivalence.test.ts` | Strict multi-tenant scope isolation: zero data leaks across distinct tenant boundaries. | **Stage 4** |
| `tests/security/deploy-attack-surface-removed.test.ts` | Zero app-layer deployment endpoints, firewall flushing, or SSH mutations. | **Stage 4** |
| `tests/security/scrape-tenant-identity.test.ts` | Authenticated scraper identity, DB membership RBAC, zero default_tenant fallback. | **Stage 4** |
| `tests/security/scrape-run-ownership.test.ts` | Multi-tenant scrape run ownership, negative matrix isolation, cross-tenant abort/progress protection. | **Stage 4** |
| `tests/security/oauth-scope-provisioning.test.ts` | Verified Google identity provisions one resolvable person, tenant, membership, and OAuth scope atomically. | **Stage 4** |
| `tests/security/oauth-callback-url.test.ts` | Non-local Google OAuth callback configuration requires an explicit HTTPS redirect URI. | **Stage 4** |
| `tests/security/oauth-http-routes.test.ts` | OAuth initiation and callback are raw HTTP GET handlers with signed state, PKCE, verified identity, and session boundaries. | **Stage 4** |
| `tests/security/active-tenant-pollution-repair.test.ts` | Tenant-pollution maintenance repair is exact-ID-only, transactional, read-only by default, and cannot mutate protected identity state. | Full Suite |
| `tests/security/evidence-ownership-deduplication.test.ts` | Defensive evidence graph reuse never transfers ownership across candidates. | **Stage 4** |
| `tests/ontology/tenant-ontology-compiler.test.ts` | Tenant-customized ontology definitions compile and validate within tenant sandboxes. | **Stage 4** |
| `tests/security/m62-credential-vault.test.ts` | AES-256 envelope encryption and key rotation for portal scraper credentials. | Full Suite |
| `tests/security/decisions-account-isolation.test.ts` | Canonical dossier presentation reads and decision updates remain isolated to the authenticated tenant/person identity. | **Stage 4** |

---

### Domain 9: Editorial / Verdict Governance

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/editorial/shortlist-badge-resolution.test.ts` | Shortlist badge state resolution (`pursue`, `consider`, `needs more signal`). | **Stage 6** |

---

### Domain 10: UI / User Journeys

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/certification/journey_c_decision_persistence_to_dto.test.ts` | Decision Persistence $\rightarrow$ Feed DTO Synchronization. | **Stage 2** |
| `tests/certification/journey_d_loader_to_ui_rendering.test.ts` | Loader Metrics $\rightarrow$ Component State & UI Score Resolution. | **Stage 2** |

---

### Domain 11: Certification Integrity

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| `tests/certification/certification-gate-integrity.test.ts` | Asserts that `npm run certify` runs all mandatory stages, propagates exit codes, and has zero bypasses. | **Stage 2** |
| `tests/certification/test-inventory-audit.test.ts` | Mechanically verifies that all test files and script categories in this inventory exist and are classified. | **Stage 2** |

---

## 3. Complete Test File Registry

Generated from `scripts/certification/registry.ts` with `npm run tests:inventory`. Edit the registry, then regenerate this section.

| Test file | Domain | Disposition | Test lanes | Certification domain |
| --- | --- | --- | --- | --- |
| `tests/acquisition/gate1-pipeline-invariants.test.ts` | Dynamic work drain, HealthManager FastPath delegation, contentOrigin enforcement, pre-admission dedupe. | **KEEP** | standard, full | outside certification |
| `tests/acquisition/gate2-target-depth.test.ts` | Canonical geography semantics, fail-narrow portal geo mapping, multi-location variant compilation, source-identity novelty evaluation, and structured SPA extraction. | **KEEP** | standard, full | outside certification |
| `tests/acquisition/golden-recovery-lineage-cohort.test.ts` | Authoritative golden production lineage cohort from run-1788527028264; verifies canonicalJobId !== cardHash hand-off across 17 recovered records, admission lineage precedence, zero o_... forks, and alias resolution. | **KEEP** | standard, full | outside certification |
| `tests/acquisition/indeed-listing-identity.test.ts` | Indeed sponsored/direct URL normalization, bounded redirect safety, and stable `jk` canonical identity. | **KEEP** | standard, full | outside certification |
| `tests/acquisition/ingestion-lineage.test.ts` | Durable source-card/run to exact canonical job/version lineage, retry idempotency, and tenant/run scope isolation. | **KEEP** | standard, full | ingestion-lineage |
| `tests/acquisition/oci-handoff.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | ingestion-lineage |
| `tests/acquisition/portal-acquisition-reality.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/acquisition/post-gate3-acquisition-integrity.test.ts` | Atomic pre-transaction BlobStore write, unconditional enrichment job creation & run binding, complete enrichment fast-path to READY, version identity payload assertion, and authenticated resume validation. | **KEEP** | standard, full | outside certification |
| `tests/acquisition/reset-corpus-fail-closed.test.ts` | Fail-closed corpus deletion, query error handling, and exact-row invariance on preserved tables. | **KEEP** | standard, full | outside certification |
| `tests/acquisition/retention-and-execution.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | ingestion-lineage |
| `tests/acquisition/scoped-ingestion.test.ts` | A shared canonical opportunity is projected only into the authenticated tenant/person's active plan. | **KEEP** | standard, full | outside certification |
| `tests/acquisition/source-payload-provenance.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/acquisition/transfer-session.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | ingestion-lineage |
| `tests/certification/certification-gate-integrity.test.ts` | Asserts that `npm run certify` runs all mandatory stages, propagates exit codes, and has zero bypasses. | **KEEP** | standard, full | boundary-journeys |
| `tests/certification/journey_c_decision_persistence_to_dto.test.ts` | Rapid user decision updates idempotently upsert `canonical_decisions` and reflect immediately in Feed DTO. | **KEEP** | standard, full | outside certification |
| `tests/certification/journey_d_loader_to_ui_rendering.test.ts` | Loader Metrics $\rightarrow$ Component State & UI Score Resolution. | **KEEP** | standard, full | boundary-journeys |
| `tests/certification/test-inventory-audit.test.ts` | Mechanically verifies that all test files and script categories in this inventory exist and are classified. | **KEEP** | standard, full | boundary-journeys |
| `tests/editorial/memo-cockpit-skins.test.ts` | Editorial | **KEEP** | standard, full | serving-pagination |
| `tests/editorial/shortlist-badge-resolution.test.ts` | Shortlist badge state resolution (`pursue`, `consider`, `needs more signal`). | **KEEP** | standard, full | serving-pagination |
| `tests/intelligence/active-context-resolution.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/attention-gate.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/bedrock-converse-model.test.ts` | Bedrock Mantle and Converse requests, schema, credential parsing/redaction, and provider failure handling. | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/bedrock-schema.test.ts` | Standards-compliant Bedrock JSON Schema projection for dossier contracts. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/candidate-profile-scope.test.ts` | Candidate profile persistence and resolution remain strictly tenant/person scoped. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/candidate-projection.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/candidate-truth-boundary.test.ts` | Candidate Truth | **KEEP** | standard, full | runtime-release-safety |
| `tests/intelligence/canonical-acquisition-integrity.test.ts` | Multi-portal acquisition payload validation, SHA-256 content hashing, and version lineage. | **KEEP** | standard, full | ingestion-lineage |
| `tests/intelligence/canonical-identity.test.ts` | Opt-in live canonical-account audit; never part of deterministic certification. | **KEEP** | standard | outside certification |
| `tests/intelligence/canonical-ingestion-fk-regression.test.ts` | Resolves existing `opportunity_versions.id` on conflict; zero orphan foreign keys. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/capability-precedence.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/capability.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/career.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/context-materialization.test.ts` | Dossier V2 Materialization | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/corpus-regeneration-worker.test.ts` | Runtime Workers | **KEEP** | standard, full | runtime-release-safety |
| `tests/intelligence/dossier-grounding.test.ts` | Evidence-plane, provenance, and grounded dossier validation invariants. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/dossier-review-queue.test.ts` | Durable review / cooldown / leases / withholding | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/dossier-source-authority.test.ts` | Immutable source snapshot and source-authority boundary. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/editorial-boundary.test.ts` | Evaluation & Policy | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/evaluation-work-scheduler.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/evaluator-control-worker-liveness.test.ts` | Runtime Workers | **KEEP** | standard, full | runtime-release-safety |
| `tests/intelligence/evidence-extraction-bedrock.test.ts` | Bedrock source-extraction schema and exact-evidence contract. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/gate4-write-refresh-edge-contract.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/gemini-context-cache.test.ts` | Immutable candidate cache / expiry / provider failures | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/identity.test.ts` | Executive seniority categorization (`C_SUITE`, `VP`), role matching, and theme extraction. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/job-projection-cache.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/job-projection-role-work.test.ts` | JobProjectionBuilder retains bounded responsibilities and outcomes while excluding qualifications and corporate copy. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/m42-identity-versioning.test.ts` | Identity & Candidate Projection | **KEEP** | standard, full | outside certification |
| `tests/intelligence/m9_2c-posting-date.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/m9_3-decision-write-path.test.ts` | Decision Persistence | **KEEP** | standard, full | outside certification |
| `tests/intelligence/m9_3-decisions-store-client.test.ts` | Optimistic UI store synchronization with server functions and rollback on error. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/m9_3-server-boundary.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/m9_3-sync-decisions-reconciliation.test.ts` | Decision Persistence | **KEEP** | standard, full | outside certification |
| `tests/intelligence/m9_4_1-multi-tenant-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | outside certification |
| `tests/intelligence/memo-contract.test.ts` | Intelligence | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/metrics-portal-breakdown.test.ts` | Portal metrics represent full database search plan population, not local page samples. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/model-c-quality.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/phase-c-runtime-separation.test.ts` | Runtime Workers | **KEEP** | standard, full | runtime-release-safety |
| `tests/intelligence/profile-journey-controls.test.ts` | Profile processing, recommendation refresh, and polling controls. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/profile-projection-version-compat.test.ts` | Legacy profile projections deterministically reproduce the exact context-pinned content version without a latest-row fallback. | **KEEP** | standard, full | gate-0-safety |
| `tests/intelligence/recommendation-freshness.test.ts` | Recommendation freshness follows immutable profile and evaluation context versions. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/schema-contract.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/seniority-integrity.test.ts` | Evaluation & Policy | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/serving-contract.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/intelligence/staged-composition.test.ts` | Editorial / Verdict | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/staged-context-input.test.ts` | Context / Source Provenance | **KEEP** | standard, full | boundary-journeys |
| `tests/intelligence/staged-decision.test.ts` | Typed entry-selection adjudication, candidate mapping, gap classification, and decision-boundary invariants for staged intelligence. | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/staged-production-integration.test.ts` | Staged source identity, policy-context isolation, and persistence boundaries. | **KEEP** | standard, full | boundary-journeys |
| `tests/intelligence/staged-queue-lifecycle.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/intelligence/staged-screening-authority.test.ts` | Staged screening authority and exact-JD evidence boundary. | **KEEP** | standard, full | outside certification |
| `tests/intelligence/write-refresh-runtime-correctness.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/ontology/tenant-ontology-compiler.test.ts` | Tenant-customized ontology definitions compile and validate within tenant sandboxes. | **KEEP** | standard, full | tenant-security |
| `tests/persistence/active_pointer_precedence.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/adapter-contracts.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/blob-store-connectivity.test.ts` | Multi-backend BlobStore connectivity, S3 REST protocol, 404/error handling, and synthetic probe healthCheck. | **KEEP** | standard, full | ingestion-lineage |
| `tests/persistence/cross-instance-payload-retrieval.test.ts` | Distributed BlobStore payload retrieval across isolated process/disk instances, missing blob graceful failure. | **KEEP** | standard, full | ingestion-lineage |
| `tests/persistence/database-safety.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/deployment-determinism.test.ts` | OpportunityService delegates serving queries exclusively to repos.canonicalServing and DatabaseAdapter with zero filesystem fallbacks. | **KEEP** | standard, full | serving-pagination |
| `tests/persistence/distributed-lease-contention.test.ts` | Multi-instance concurrent lease mutual exclusion, non-claiming loser invariant, and crash failover. | **KEEP** | standard, full | ingestion-lineage |
| `tests/persistence/evaluation_context_pointer_trigger.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/evaluation_context_pointers.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/evaluation_pointer_flow.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/m41-canonical-schema.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/m51-queue-schema.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/m61-credential-schema.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/persistence/migration-runner.test.ts` | Evaluation & Policy | **KEEP** | standard, full | runtime-release-safety |
| `tests/persistence/oci-blob-store.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | ingestion-lineage |
| `tests/persistence/populated-migration.test.ts` | Populated database migration across 001-043, proving zero foreign key check violations and row identity preservation. | **KEEP** | standard, full | runtime-release-safety |
| `tests/persistence/queue-crash-restart.test.ts` | Turso operational queue crash recovery, idempotency, concurrent lease exclusion, and zero filesystem state. | **KEEP** | standard, full | ingestion-lineage |
| `tests/persistence/scrape-run-state-machine.test.ts` | Atomic active run race, cross-tenant/person concurrency, terminal immutability, restart durability. | **KEEP** | standard, full | ingestion-lineage |
| `tests/persistence/sqlite-retirement.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/policy/atomic-plan-activation.test.ts` | Replacing career intent produces a complete, immediately routeable evaluation context or rolls back without stale-plan exposure. | **KEEP** | standard, full | outside certification |
| `tests/policy/attention-management.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/policy/eligibility-gates.test.ts` | Strict evaluation of core eligibility criteria (location, seniority, operating model). | **KEEP** | standard, full | outside certification |
| `tests/policy/indeed-filter.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/policy/opportunity-control-plane.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/policy/policy-invariants.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/policy/pursue-queue-isolation.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/policy/read-economics.test.ts` | Evaluation & Policy | **KEEP** | standard, full | outside certification |
| `tests/pursuit/approval-ledger.test.ts` | Pursuit evidence approval | **KEEP** | full | pursuit |
| `tests/pursuit/core-host-integration.test.ts` | Pursuit host integration | **KEEP** | full | pursuit |
| `tests/pursuit/integration-boundaries.test.ts` | Pursuit integration boundaries | **KEEP** | full | pursuit |
| `tests/pursuit/memo-model-benchmark.test.ts` | Pursuit live memo model quality/cost benchmark | **KEEP** | full | pursuit |
| `tests/pursuit/resume-copy.test.ts` | Pursuit Execution | **KEEP** | full | outside certification |
| `tests/pursuit/resume-export-presentation.test.ts` | Pursuit Execution | **KEEP** | full | outside certification |
| `tests/pursuit/semantic-acceptance.test.ts` | Pursuit semantic acceptance | **KEEP** | full | pursuit |
| `tests/pursuit/thesis-enrichment-integrity.test.ts` | Pursuit thesis enrichment integrity | **KEEP** | full | pursuit |
| `tests/regression/p0-enrichment-extraction-pipeline.test.ts` | Evaluation & Policy | **REVIEW** | full, regression | outside certification |
| `tests/regression/p0-invariant-candidate-level.test.ts` | Evaluation & Policy | **REVIEW** | full, regression | outside certification |
| `tests/regression/p0-invariant-capability-unknown.test.ts` | Evaluation & Policy | **REVIEW** | full, regression | outside certification |
| `tests/regression/stage-3f-comparisons.test.ts` | Evaluation & Policy | **KEEP** | full, regression | outside certification |
| `tests/regression/stage-3f-hashing.test.ts` | Evaluation & Policy | **KEEP** | full, regression | outside certification |
| `tests/regression/stage-4b-singleflight.test.ts` | Evaluation & Policy | **KEEP** | full, regression | outside certification |
| `tests/release/artifact-integrity.test.ts` | Release Engineering | **KEEP** | standard, full | runtime-release-safety |
| `tests/release/deployment.test.ts` | Release Engineering | **KEEP** | standard, full | runtime-release-safety |
| `tests/release/readiness.test.ts` | Release Engineering | **KEEP** | standard, full | runtime-release-safety |
| `tests/release/runtime-topology.test.ts` | Release Engineering | **KEEP** | standard, full | runtime-release-safety |
| `tests/scraper/acquisition-variant-contract.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | ingestion-lineage |
| `tests/scraper/acquisition-wait-budget.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | ingestion-lineage |
| `tests/scraper/atomic-progress-recovery.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | ingestion-lineage |
| `tests/scraper/ats-content-quality.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/ats-content-sanitization.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/ats-jsonld-extraction.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/auth-security.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/enrichment-payload-resolution.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/scraper/hard-filter-semantics.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/indeed-acquisition-resilience.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/indeed-jk-provenance.test.ts` | Strict 16-hex character JK validation, non-JK employer requisition isolation, and fast-fetch ATS direct resolution. | **KEEP** | standard, full | outside certification |
| `tests/scraper/journal-lifecycle.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/linkedin-rich-discovery-fallback.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/live-test-policy.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/m56-operational-consolidation.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/naukri-cancellation-no-legacy-fetch.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/naukri-hydration-quota.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/naukri-pagination-browser-context.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/naukri-pagination-telemetry.test.ts` | Non-overlapping work-unit pagination mapping, out-of-bounds rejection, scroll quota accumulation, and telemetry. | **KEEP** | standard, full | outside certification |
| `tests/scraper/naukri-provenance.test.ts` | Explicit full-JD provenance flag validation, prevention of length-based inference, and native detail fetch routing. | **KEEP** | standard, full | outside certification |
| `tests/scraper/naukri-state.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/scheduler-exhaustion-contract.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/scheduler-transport-safety.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/scheduler-yield-separation.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/scrape-progress.test.ts` | Ingestion & Lineage | **KEEP** | full | outside certification |
| `tests/scraper/scraper-acquisition-contract.test.ts` | LinkedIn fast hydration & exit, universal sparse preservation (LinkedIn/Naukri), and failure transparency without fake empty results. | **KEEP** | standard, full | outside certification |
| `tests/scraper/scraper-control.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/scraper-correctness-contract.test.ts` | Authoritative active-plan resolution, zero fallback/zero units for authenticated runs, and Indeed sparse detail preservation. | **KEEP** | standard, full | outside certification |
| `tests/scraper/scraper-operability.test.ts` | Scraper Operability Patch: planless scoped runs truthful returns, migration 046 nullable search plan rebuild, active run partial unique index, machine profile mode/tenant retirement, cross-scope profile isolation & fail-closed rename, atomic legacy migration, fresh vs stale corrupt lock handling, native Chromium UA, single-authority confirmation without TDZ, and DB-free GLOBAL local-only acquisition. | **KEEP** | standard, full | outside certification |
| `tests/scraper/scraper-smoke.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/scraper/validator.test.ts` | Ingestion & Lineage | **KEEP** | standard, full | outside certification |
| `tests/security/active-tenant-pollution-repair.test.ts` | Tenant-pollution maintenance repair is exact-ID-only, transactional, read-only by default, and cannot mutate protected identity state. | **KEEP** | standard, full | outside certification |
| `tests/security/admin-config.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/admin-foundations.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/admin-operations.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/admin-protection.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/admin-taxonomy.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/candidate-profile-tenant-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/decisions-account-isolation.test.ts` | Canonical dossier presentation reads and decision updates remain isolated to the authenticated tenant/person identity. | **KEEP** | standard, full | staged-dossier-merge-gate |
| `tests/security/deploy-attack-surface-removed.test.ts` | Zero app-layer deployment endpoints, firewall flushing, or SSH mutations. | **KEEP** | standard, full | tenant-security |
| `tests/security/evaluation-context-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | gate-0-safety |
| `tests/security/evidence-dedup-repository-scope.test.ts` | Content-hash evidence reuse is scoped to the owning candidate at the repository boundary. | **KEEP** | standard, full | outside certification |
| `tests/security/evidence-ownership-deduplication.test.ts` | Defensive evidence graph reuse never transfers ownership across candidates. | **KEEP** | standard, full | outside certification |
| `tests/security/host-provider-recovery.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/m62-credential-vault.test.ts` | AES-256 envelope encryption and key rotation for portal scraper credentials. | **KEEP** | standard, full | tenant-security |
| `tests/security/m63-credential-broker.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | outside certification |
| `tests/security/m64-scraper-credential-injection.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | outside certification |
| `tests/security/m8-tenant-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | outside certification |
| `tests/security/notification-lifecycle.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/oauth-callback-url.test.ts` | Non-local Google OAuth callback configuration requires an explicit HTTPS redirect URI. | **KEEP** | standard, full | outside certification |
| `tests/security/oauth-http-routes.test.ts` | OAuth initiation and callback are raw HTTP GET handlers with signed state, PKCE, verified identity, and session boundaries. | **KEEP** | standard, full | outside certification |
| `tests/security/oauth-scope-provisioning.test.ts` | Verified Google identity provisions one resolvable person, tenant, membership, and OAuth scope atomically. | **KEEP** | standard, full | tenant-security |
| `tests/security/phase13_cross_tenant_pentest.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | outside certification |
| `tests/security/scope-resolver-equivalence.test.ts` | Strict multi-tenant scope isolation: zero data leaks across distinct tenant boundaries. | **KEEP** | standard, full | tenant-security |
| `tests/security/scrape-run-ownership.test.ts` | Multi-tenant scrape run ownership, negative matrix isolation, cross-tenant abort/progress protection. | **KEEP** | standard, full | tenant-security |
| `tests/security/scrape-tenant-identity.test.ts` | Authenticated scraper identity, DB membership RBAC, zero default_tenant fallback. | **KEEP** | standard, full | tenant-security |
| `tests/security/scraper-auth-permission-non-escalation.test.ts` | Scraper authorization preserves membership grants and never manufactures scraper or credential capabilities. | **KEEP** | standard, full | gate-0-safety |
| `tests/security/tavily-hardening.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/security/tenant-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | standard, full | tenant-security |
| `tests/semantic/controlled_integration.test.ts` | Semantic Grounding | **KEEP** | standard, full | outside certification |
| `tests/semantic/extraction-sanitation.test.ts` | Semantic Grounding | **KEEP** | standard, full | outside certification |
| `tests/semantic/normalization.test.ts` | Currency, date, location, and seniority string normalization. | **KEEP** | standard, full | outside certification |
| `tests/semantic/ontology.test.ts` | Comprehensive executive ontology validation (roles, capabilities, industries, seniority). | **KEEP** | standard, full | outside certification |
| `tests/semantic/phase6a1_threshold_boundaries.test.ts` | Semantic Grounding | **KEEP** | standard, full | outside certification |
| `tests/semantic/phase6c_production_observability.test.ts` | Semantic Grounding | **KEEP** | standard, full | outside certification |
| `tests/semantic/phase6d_production_monitoring.test.ts` | Semantic Grounding | **KEEP** | standard, full | outside certification |
| `tests/serving/current-serving-boundary.test.ts` | Serving & Pagination | **KEEP** | standard, full | serving-pagination |
| `tests/serving/cursor.test.ts` | Opaque cursor encoding, decoding, validation, and tamper-resistance. | **KEEP** | standard, full | serving-pagination |
| `tests/serving/decided-population-completeness.test.ts` | Decided-opportunity retrieval exhausts keyset pages and never hides records after the first 50. | **KEEP** | standard, full | outside certification |
| `tests/serving/keyset_pagination.test.ts` | Keyset pagination returns deterministic, contiguous pages without duplicate rows. | **KEEP** | standard, full | outside certification |
| `tests/serving/navigation-and-shortlist-contract.test.ts` | Serving & Pagination | **KEEP** | standard, full | serving-pagination |
| `tests/serving/opportunity-queries-contract.test.ts` | Serving & Pagination | **KEEP** | standard, full | serving-pagination |
| `tests/serving/route_server_functions_parity.test.ts` | Serving & Pagination | **KEEP** | standard, full | serving-pagination |
| `tests/serving/scraped-job-detail.test.ts` | Serving & Pagination | **KEEP** | standard, full | serving-pagination |
| `tests/serving/singleflight-scope-isolation.test.ts` | 10 concurrent requests coalesce to 1 underlying query; complete tenant, person, and search-plan scope isolation. | **KEEP** | standard, full | serving-pagination |
| `tests/serving/singleflight_and_observability.test.ts` | Singleflight request coalescing prevents duplicate concurrent database queries. | **KEEP** | standard, full | serving-pagination |
| `tests/serving/sql_feed_parity.test.ts` | Serving feed SQL queries match materialized evaluation and user decision states. | **KEEP** | standard, full | outside certification |
| `tests/serving/sql_metrics_aggregation.test.ts` | Canonical population, engine/user/effective metric partitions reconcile independently; `allRecordedDecisions = userBreakdown.total`. | **KEEP** | standard, full | serving-pagination |
| `tests/serving/staged-rich-serving.test.ts` | Serving & Pagination | **KEEP** | standard, full | staged-dossier-merge-gate |

## 4. Script Category Registry

Scripts in `scripts/` are classified into the following authoritative categories:

| Category | Description / Canonical Files | Action |
| :--- | :--- | :---: |
| **OPERATIONAL** | `scripts/scrape.ts`, `scripts/scraper/*`, `scripts/enrich.ts`, `scripts/corpus/*`, `scripts/dossier/*`, `scripts/run-*-worker.ts`, `scripts/process-document-jobs.ts`, `scripts/rematerialize-dossiers.ts` | **KEEP** |
| **CERTIFICATION** | `scripts/certify.ts`, `scripts/certification/*` | **KEEP** |
| **DEPLOYMENT** | `scripts/deploy.ts`, `scripts/release/*` | **KEEP** |
| **DATABASE** | `scripts/migrate.ts`, `scripts/db-status.ts`, `scripts/db/*` | **KEEP** |
| **EVALUATION** | `scripts/qa-eval.ts`, `scripts/canary/*`, `scripts/smoke_production.ts`, `scripts/validate-graph.ts` | **KEEP** |
| **DIAGNOSTIC** | `scripts/diagnose.ts`, `scripts/dev.ts` | **KEEP** |

# Atomic progress recovery

`tests/scraper/atomic-progress-recovery.test.ts`: 3 acquisition tests, 10 assertions;
transient Windows rename contention, preserved replacement on persistent failure,
and portal settlement before shared-resource cleanup. Included in certification.
