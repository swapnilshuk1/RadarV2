# RADAR v2 — Permanent Test Architecture Map & Inventory

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

## 3. Complete Test File Registry (180 Total Files)

Every test file in the repository is mechanically tracked below:

| File Path | Domain | Disposition | Stage | Tests | Assertions |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `tests/acquisition/gate1-pipeline-invariants.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 9 | 39 |
| `tests/acquisition/gate2-target-depth.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 17 | 125 |
| `tests/acquisition/golden-recovery-lineage-cohort.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 2 | 16 |
| `tests/acquisition/indeed-listing-identity.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 7 | 21 |
| `tests/acquisition/ingestion-lineage.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 4 | 10 |
| `tests/acquisition/portal-acquisition-reality.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 9 | 33 |
| `tests/acquisition/post-gate3-acquisition-integrity.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 72 | 220 |
| `tests/acquisition/reset-corpus-fail-closed.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 5 | 14 |
| `tests/acquisition/scoped-ingestion.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 6 | 30 |
| `tests/acquisition/source-payload-provenance.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 9 | 42 |
| `tests/certification/certification-gate-integrity.test.ts` | Certification Integrity | **KEEP** | Full Suite | 7 | 26 |
| `tests/certification/journey_c_decision_persistence_to_dto.test.ts` | Certification Integrity | **KEEP** | Full Suite | 1 | 9 |
| `tests/certification/journey_d_loader_to_ui_rendering.test.ts` | Certification Integrity | **KEEP** | Full Suite | 4 | 16 |
| `tests/certification/test-inventory-audit.test.ts` | Certification Integrity | **KEEP** | Full Suite | 12 | 27 |
| `tests/editorial/memo-cockpit-skins.test.ts` | Editorial | **KEEP** | Stage 3 | 5 | 10 |
| `tests/editorial/shortlist-badge-resolution.test.ts` | Editorial / Verdict Governance | **KEEP** | Stage 6 | 7 | 25 |
| `tests/intelligence/active-context-resolution.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 3 | 12 |
| `tests/intelligence/attention-gate.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 1 | 1 |
| `tests/intelligence/bedrock-converse-model.test.ts` | Bedrock transport / structured output | **KEEP** | Stage 3 | 20 | 86 |
| `tests/intelligence/bedrock-schema.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 1 | 9 |
| `tests/intelligence/candidate-profile-scope.test.ts` | Identity & Candidate Projection | **KEEP** | Gate 0 Safety | 3 | 5 |
| `tests/intelligence/candidate-projection.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 13 | 54 |
| `tests/intelligence/candidate-truth-boundary.test.ts` | Candidate Truth | **KEEP** | Full Suite | 3 | 6 |
| `tests/intelligence/canonical-acquisition-integrity.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 13 | 46 |
| `tests/intelligence/canonical-identity.test.ts` | Identity & Candidate Projection | **KEEP** | Operator only (`RADAR_RUN_LIVE_IDENTITY_TESTS=true`) | 7 | 27 |
| `tests/intelligence/canonical-ingestion-fk-regression.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 6 | 28 |
| `tests/intelligence/capability-precedence.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 2 | 11 |
| `tests/intelligence/capability.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 7 | 28 |
| `tests/intelligence/career.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 3 | 7 |
| `tests/intelligence/context-materialization.test.ts` | Dossier V2 Materialization | **KEEP** | Dossier V2 Merge Gate | 3 | 6 |
| `tests/intelligence/corpus-regeneration-worker.test.ts` | Runtime Workers | **KEEP** | Full Suite | 3 | 7 |
| `tests/intelligence/dossier-grounding.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 30 | 72 |
| `tests/intelligence/dossier-review-queue.test.ts` | Durable review / cooldown / leases / withholding | **KEEP** | Stage 3 | 6 | 21 |
| `tests/intelligence/dossier-source-authority.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 1 | 2 |
| `tests/intelligence/editorial-boundary.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 2 | 3 |
| `tests/intelligence/evaluation-work-scheduler.test.ts` | Evaluation & Policy | **KEEP** | Stage 3 | 3 | 11 |
| `tests/intelligence/evaluator-control-worker-liveness.test.ts` | Runtime Workers | **KEEP** | Stage 3 | 2 | 8 |
| `tests/intelligence/evidence-extraction-bedrock.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 3 | 5 |
| `tests/intelligence/gate4-write-refresh-edge-contract.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 10 | 26 |
| `tests/intelligence/gemini-context-cache.test.ts` | Immutable candidate cache / expiry / provider failures | **KEEP** | Stage 3 | 7 | 24 |
| `tests/intelligence/identity.test.ts` | Identity & Candidate Projection | **KEEP** | Full Suite | 14 | 70 |
| `tests/intelligence/job-projection-cache.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 6 | 29 |
| `tests/intelligence/job-projection-role-work.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 18 | 41 |
| `tests/intelligence/m42-identity-versioning.test.ts` | Identity & Candidate Projection | **KEEP** | Full Suite | 8 | 16 |
| `tests/intelligence/m9_2c-posting-date.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 8 | 15 |
| `tests/intelligence/m9_3-decision-write-path.test.ts` | Decision Persistence | **KEEP** | Full Suite | 6 | 12 |
| `tests/intelligence/m9_3-decisions-store-client.test.ts` | Decision Persistence | **KEEP** | Full Suite | 3 | 9 |
| `tests/intelligence/m9_3-server-boundary.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 2 | 10 |
| `tests/intelligence/m9_3-sync-decisions-reconciliation.test.ts` | Decision Persistence | **KEEP** | Full Suite | 2 | 4 |
| `tests/intelligence/m9_4_1-multi-tenant-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 4 | 8 |
| `tests/intelligence/memo-contract.test.ts` | **KEEP** | Memo evidence coverage, decision conditions and review provenance |
| `tests/intelligence/metrics-portal-breakdown.test.ts` | Metrics & Aggregation | **KEEP** | Stage 3 | 2 | 9 |
| `tests/intelligence/model-c-quality.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 18 | 35 |
| `tests/intelligence/phase-c-runtime-separation.test.ts` | Runtime Workers | **KEEP** | Full Suite | 4 | 28 |
| `tests/intelligence/profile-journey-controls.test.ts` | Identity & Candidate Projection | **KEEP** | Full Suite | 3 | 12 |
| `tests/intelligence/profile-projection-version-compat.test.ts` | Identity & Candidate Projection | **KEEP** | Gate 0 Safety | 6 | 13 |
| `tests/intelligence/recommendation-freshness.test.ts` | Identity & Candidate Projection | **KEEP** | Full Suite | 3 | 9 |
| `tests/intelligence/seniority-integrity.test.ts` | Evaluation & Policy | **KEEP** | Stage 3 | 12 | 14 |
| `tests/intelligence/schema-contract.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 1 | 1 |
| `tests/intelligence/serving-contract.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 2 | 13 |
| `tests/intelligence/staged-composition.test.ts` | Editorial / Verdict | **KEEP** | Stage 3 | 45 | 145 |
| `tests/intelligence/staged-context-input.test.ts` | Context / Source Provenance | **KEEP** | Stage 3 | 10 | 37 |
| `tests/intelligence/staged-decision.test.ts` | Semantic Grounding | **KEEP** | Stage 3 | 27 | 66 |
| `tests/intelligence/staged-production-integration.test.ts` | Semantic Grounding | **KEEP** | Stage 3 | 7 | 25 |
| `tests/intelligence/staged-queue-lifecycle.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 9 | 43 |
| `tests/intelligence/staged-screening-authority.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 2 | 4 |
| `tests/intelligence/write-refresh-runtime-correctness.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 4 | 8 |
| `tests/ontology/tenant-ontology-compiler.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 10 | 55 |
| `tests/persistence/active_pointer_precedence.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 1 | 3 |
| `tests/persistence/adapter-contracts.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 4 | 10 |
| `tests/persistence/blob-store-connectivity.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 7 | 32 |
| `tests/persistence/cross-instance-payload-retrieval.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 2 | 15 |
| `tests/persistence/database-safety.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 9 | 15 |
| `tests/persistence/deployment-determinism.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 9 | 35 |
| `tests/persistence/distributed-lease-contention.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 2 | 18 |
| `tests/persistence/evaluation_context_pointer_trigger.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 3 | 3 |
| `tests/persistence/evaluation_context_pointers.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 9 | 15 |
| `tests/persistence/evaluation_pointer_flow.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 6 | 19 |
| `tests/persistence/m41-canonical-schema.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 3 | 6 |
| `tests/persistence/m51-queue-schema.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 7 | 26 |
| `tests/persistence/m61-credential-schema.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 8 | 54 |
| `tests/persistence/migration-runner.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 10 | 45 |
| `tests/persistence/populated-migration.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 1 | 33 |
| `tests/persistence/queue-crash-restart.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 10 | 51 |
| `tests/persistence/scrape-run-state-machine.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 6 | 41 |
| `tests/persistence/sqlite-retirement.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 7 | 9 |
| `tests/policy/atomic-plan-activation.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 5 | 30 |
| `tests/policy/attention-management.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 12 | 37 |
| `tests/policy/eligibility-gates.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 4 | 14 |
| `tests/policy/indeed-filter.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 4 | 7 |
| `tests/policy/opportunity-control-plane.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 13 | 50 |
| `tests/policy/policy-invariants.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 12 | 25 |
| `tests/policy/pursue-queue-isolation.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 3 | 5 |
| `tests/policy/read-economics.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 5 | 14 |
| `tests/pursuit/approval-ledger.test.ts` | Pursuit evidence approval | **KEEP** | Full Suite | 8 | 11 |
| `tests/pursuit/core-host-integration.test.ts` | Pursuit host integration | **KEEP** | Full Suite | 18 | 77 |
| `tests/pursuit/integration-boundaries.test.ts` | Pursuit integration boundaries | **KEEP** | Full Suite | 12 | 25 |
| `tests/pursuit/memo-model-benchmark.test.ts` | Pursuit live memo model quality/cost benchmark | **KEEP** | Operator only (`RADAR_RUN_LIVE_PURSUIT_MEMO_BENCHMARK=true`) | 2 | 6 |
| `tests/pursuit/resume-copy.test.ts` | Pursuit Execution | **KEEP** | Full Suite | 7 | 11 |
| `tests/pursuit/resume-export-presentation.test.ts` | Pursuit Execution | **KEEP** | Full Suite | 4 | 18 |
| `tests/pursuit/semantic-acceptance.test.ts` | Pursuit semantic acceptance | **KEEP** | Full Suite | 19 | 41 |
| `tests/regression/p0-enrichment-extraction-pipeline.test.ts` | Evaluation & Policy | **REVIEW** | Full Suite | 7 | 21 |
| `tests/regression/p0-invariant-candidate-level.test.ts` | Evaluation & Policy | **REVIEW** | Full Suite | 6 | 20 |
| `tests/regression/p0-invariant-capability-unknown.test.ts` | Evaluation & Policy | **REVIEW** | Full Suite | 5 | 11 |
| `tests/regression/stage-3f-comparisons.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 4 | 4 |
| `tests/regression/stage-3f-hashing.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 5 | 6 |
| `tests/regression/stage-4b-singleflight.test.ts` | Evaluation & Policy | **KEEP** | Full Suite | 1 | 5 |
| `tests/release/artifact-integrity.test.ts` | Release Engineering | **KEEP** | Full Suite | 2 | 3 |
| `tests/release/deployment.test.ts` | Release Engineering | **KEEP** | Full Suite | 11 | 58 |
| `tests/release/readiness.test.ts` | Release Engineering | **KEEP** | Full Suite | 4 | 10 |
| `tests/release/runtime-topology.test.ts` | Release Engineering | **KEEP** | Full Suite | 3 | 9 |
| `tests/scraper/acquisition-variant-contract.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 9 | 42 |
| `tests/scraper/ats-content-quality.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 4 | 12 |
| `tests/scraper/ats-content-sanitization.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 3 | 22 |
| `tests/scraper/ats-jsonld-extraction.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 3 | 15 |
| `tests/scraper/auth-security.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 12 | 39 |
| `tests/scraper/enrichment-payload-resolution.test.ts` | Ingestion & Lineage | **KEEP** | Stage 3 | 9 | 54 |
| `tests/scraper/hard-filter-semantics.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 9 | 37 |
| `tests/scraper/indeed-acquisition-resilience.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 4 | 9 |
| `tests/scraper/indeed-jk-provenance.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 3 | 9 |
| `tests/scraper/journal-lifecycle.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 5 | 22 |
| `tests/scraper/linkedin-rich-discovery-fallback.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 4 | 15 |
| `tests/scraper/live-test-policy.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 1 | 1 |
| `tests/scraper/m56-operational-consolidation.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 5 | 18 |
| `tests/scraper/naukri-cancellation-no-legacy-fetch.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 7 | 22 |
| `tests/scraper/naukri-hydration-quota.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 4 | 9 |
| `tests/scraper/naukri-pagination-browser-context.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 4 | 13 |
| `tests/scraper/naukri-pagination-telemetry.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 3 | 34 |
| `tests/scraper/naukri-provenance.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 3 | 7 |
| `tests/scraper/naukri-state.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 5 | 10 |
| `tests/scraper/scheduler-exhaustion-contract.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 4 | 8 |
| `tests/scraper/scheduler-transport-safety.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 2 | 4 |
| `tests/scraper/scheduler-yield-separation.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 5 | 25 |
| `tests/scraper/scrape-progress.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 2 | 20 |
| `tests/scraper/scraper-acquisition-contract.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 19 | 58 |
| `tests/scraper/scraper-control.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 5 | 12 |
| `tests/scraper/scraper-correctness-contract.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 14 | 53 |
| `tests/scraper/scraper-operability.test.ts` | Ingestion & Lineage | **KEEP** | **Stage 3** | 42 | 170 |
| `tests/scraper/scraper-smoke.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 4 | 11 |
| `tests/scraper/validator.test.ts` | Ingestion & Lineage | **KEEP** | Full Suite | 4 | 9 |
| `tests/security/active-tenant-pollution-repair.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 4 | 13 |
| `tests/security/candidate-profile-tenant-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 7 | 16 |
| `tests/security/decisions-account-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 6 | 16 |
| `tests/security/deploy-attack-surface-removed.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 5 | 10 |
| `tests/security/evaluation-context-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 3 | 13 |
| `tests/security/evidence-dedup-repository-scope.test.ts` | Security & Tenant Isolation | **KEEP** | Gate 0 Safety | 1 | 2 |
| `tests/security/evidence-ownership-deduplication.test.ts` | Security & Tenant Isolation | **KEEP** | Gate 0 Safety | 2 | 3 |
| `tests/security/m62-credential-vault.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 15 | 53 |
| `tests/security/m63-credential-broker.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 14 | 92 |
| `tests/security/m64-scraper-credential-injection.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 31 | 93 |
| `tests/security/m8-tenant-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 5 | 15 |
| `tests/security/oauth-callback-url.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 3 | 11 |
| `tests/security/oauth-http-routes.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 6 | 21 |
| `tests/security/oauth-scope-provisioning.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 15 | 58 |
| `tests/security/phase13_cross_tenant_pentest.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 13 | 21 |
| `tests/security/scope-resolver-equivalence.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 13 | 38 |
| `tests/security/scrape-run-ownership.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 4 | 18 |
| `tests/security/scrape-tenant-identity.test.ts` | Security & Tenant Isolation | **KEEP** | Stage 4 | 7 | 20 |
| `tests/security/scraper-auth-permission-non-escalation.test.ts` | Security & Tenant Isolation | **KEEP** | Gate 0 Safety | 1 | 5 |
| `tests/security/tenant-isolation.test.ts` | Security & Tenant Isolation | **KEEP** | Full Suite | 16 | 43 |
| `tests/semantic/controlled_integration.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 12 | 35 |
| `tests/semantic/extraction-sanitation.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 6 | 14 |
| `tests/semantic/normalization.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 1 | 2 |
| `tests/semantic/ontology.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 77 | 240 |
| `tests/semantic/phase6a1_threshold_boundaries.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 12 | 14 |
| `tests/semantic/phase6c_production_observability.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 13 | 18 |
| `tests/semantic/phase6d_production_monitoring.test.ts` | Semantic Grounding | **KEEP** | Full Suite | 16 | 23 |
| `tests/serving/current-serving-boundary.test.ts` | Serving & Pagination | **KEEP** | Stage 3 | 2 | 5 |
| `tests/serving/cursor.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 25 | 32 |
| `tests/serving/decided-population-completeness.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 1 | 3 |
| `tests/serving/keyset_pagination.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 8 | 36 |
| `tests/serving/navigation-and-shortlist-contract.test.ts` | Serving & Pagination | **KEEP** | Stage 3 | 6 | 16 |
| `tests/serving/opportunity-queries-contract.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 4 | 17 |
| `tests/serving/route_server_functions_parity.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 6 | 28 |
| `tests/serving/singleflight-scope-isolation.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 7 | 30 |
| `tests/serving/singleflight_and_observability.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 4 | 21 |
| `tests/serving/sql_feed_parity.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 7 | 21 |
| `tests/serving/sql_metrics_aggregation.test.ts` | Serving & Pagination | **KEEP** | Stage 5 | 8 | 58 |
| `tests/serving/staged-rich-serving.test.ts` | Serving & Pagination | **KEEP** | Stage 3 | 17 | 89 |

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
