/**
 * Canonical certification-test inventory.
 *
 * This is the single source of truth for the full certification gate. Vitest
 * inclusion, logical group reporting, and integrity tests must derive from
 * this manifest rather than maintaining independent lists.
 */

export const EXPECTED_CERTIFICATION_FILE_COUNT = 40;

export const certificationManifest = [
  {
    id: "boundary-journeys",
    name: "Four Boundary Journeys (A, B, C, D)",
    description:
      "End-to-end integration across acquisition, semantic policy, decision persistence, and UI rendering",
    files: [
      "tests/certification/certification-gate-integrity.test.ts",
      "tests/certification/journey_a_acquisition_to_evaluation.test.ts",
      "tests/certification/journey_b_semantic_grounding_to_policy.test.ts",
      "tests/certification/journey_c_decision_persistence_to_dto.test.ts",
      "tests/certification/journey_d_loader_to_ui_rendering.test.ts",
      "tests/certification/test-inventory-audit.test.ts",
    ],
  },
  {
    id: "ingestion-lineage",
    name: "Canonical Ingestion & Lineage Contracts",
    description:
      "FK integrity, content hashing, version lineage, operational queue crash recovery, and global metric aggregations",
    files: [
      "tests/intelligence/canonical-ingestion-fk-regression.test.ts",
      "tests/intelligence/canonical-acquisition-integrity.test.ts",
      "tests/acquisition/ingestion-lineage.test.ts",
      "tests/intelligence/semantic-evidence-integrity-regression.test.ts",
      "tests/intelligence/metrics-portal-breakdown.test.ts",
      "tests/persistence/queue-crash-restart.test.ts",
      "tests/persistence/scrape-run-state-machine.test.ts",
      "tests/persistence/cross-instance-payload-retrieval.test.ts",
      "tests/persistence/distributed-lease-contention.test.ts",
      "tests/persistence/blob-store-connectivity.test.ts",
      "tests/scraper/acquisition-variant-contract.test.ts",
    ],
  },
  {
    id: "tenant-security",
    name: "Multi-Tenant & Scope Security Isolation",
    description:
      "Strict tenant isolation, deployment attack-surface checks, and ontology scope resolution",
    files: [
      "tests/security/scope-resolver-equivalence.test.ts",
      "tests/security/deploy-attack-surface-removed.test.ts",
      "tests/security/scrape-tenant-identity.test.ts",
      "tests/security/scrape-run-ownership.test.ts",
      "tests/ontology/tenant-ontology-compiler.test.ts",
    ],
  },
  {
    id: "serving-pagination",
    name: "Serving Store & Keyset Pagination Invariants",
    description:
      "Feed ordering parity, opaque cursor stability, dossier navigation, and singleflight coalescing",
    files: [
      "tests/serving/cursor.test.ts",
      "tests/serving/dossier_and_navigation.test.ts",
      "tests/serving/keyset_pagination.test.ts",
      "tests/serving/opportunity-queries-contract.test.ts",
      "tests/serving/route_server_functions_parity.test.ts",
      "tests/serving/singleflight_and_observability.test.ts",
      "tests/serving/singleflight-scope-isolation.test.ts",
      "tests/serving/sql_feed_parity.test.ts",
      "tests/serving/sql_metrics_aggregation.test.ts",
      "tests/persistence/deployment-determinism.test.ts",
    ],
  },
  {
    id: "editorial-governance",
    name: "Editorial Governance & Verdict Contracts",
    description:
      "Rule 13 executive prose compliance, score resolution, and badge mappings",
    files: [
      "tests/editorial/career-value-integrity.test.ts",
      "tests/editorial/explanation-composition.test.ts",
      "tests/editorial/explanation-contract.test.ts",
      "tests/editorial/shortlist-badge-resolution.test.ts",
      "tests/editorial/ui-score-resolution.test.ts",
      "tests/editorial/verdict-coverage.test.ts",
      "tests/editorial/evidence-sufficiency-contract.test.ts",
      "tests/intelligence/invariant-assertions.test.ts",
    ],
  },
] as const;

export const certificationTestFiles = certificationManifest.flatMap((group) => group.files);

export const uniqueCertificationTestFiles = [...new Set(certificationTestFiles)];
