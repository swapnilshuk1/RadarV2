/**
 * Canonical certification-test inventory.
 *
 * This is the single source of truth for the full certification gate. Vitest
 * inclusion, logical group reporting, and integrity tests must derive from
 * this manifest rather than maintaining independent lists.
 */

export const certificationManifest = [
  {
    id: "boundary-journeys",
    name: "Four Boundary Journeys (A, B, C, D)",
    description:
      "End-to-end integration across acquisition, semantic policy, decision persistence, and UI rendering",
    files: [
      "tests/certification/certification-gate-integrity.test.ts",
      "tests/intelligence/staged-production-integration.test.ts",
      "tests/intelligence/staged-context-input.test.ts",
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
      "tests/intelligence/canonical-acquisition-integrity.test.ts",
      "tests/acquisition/ingestion-lineage.test.ts",
      "tests/persistence/queue-crash-restart.test.ts",
      "tests/persistence/scrape-run-state-machine.test.ts",
      "tests/persistence/cross-instance-payload-retrieval.test.ts",
      "tests/persistence/distributed-lease-contention.test.ts",
      "tests/persistence/blob-store-connectivity.test.ts",
      "tests/persistence/oci-blob-store.test.ts",
      "tests/acquisition/oci-handoff.test.ts",
      "tests/acquisition/retention-and-execution.test.ts",
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
      "tests/security/candidate-profile-tenant-isolation.test.ts",
      "tests/security/tenant-isolation.test.ts",
      "tests/security/oauth-scope-provisioning.test.ts",
      "tests/security/m62-credential-vault.test.ts",
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
      "tests/serving/navigation-and-shortlist-contract.test.ts",
      "tests/serving/opportunity-queries-contract.test.ts",
      "tests/serving/route_server_functions_parity.test.ts",
      "tests/serving/singleflight_and_observability.test.ts",
      "tests/serving/singleflight-scope-isolation.test.ts",
      "tests/editorial/shortlist-badge-resolution.test.ts",
      "tests/editorial/memo-cockpit-skins.test.ts",
      "tests/serving/current-serving-boundary.test.ts",
      "tests/serving/sql_metrics_aggregation.test.ts",
      "tests/persistence/deployment-determinism.test.ts",
    ],
  },
  {
    id: "staged-dossier-merge-gate",
    name: "Staged Dossier Merge-Gate Integrity",
    description:
      "Exact evaluated identity/scalar attachment, source trust, presentation provenance, and account isolation",
    files: [
      "tests/intelligence/context-materialization.test.ts",
      "tests/intelligence/attention-gate.test.ts",
      "tests/intelligence/seniority-integrity.test.ts",
      "tests/security/decisions-account-isolation.test.ts",
      "tests/intelligence/staged-decision.test.ts",
      "tests/intelligence/staged-queue-lifecycle.test.ts",
      "tests/scraper/enrichment-payload-resolution.test.ts",
      "tests/intelligence/staged-composition.test.ts",
      "tests/intelligence/dossier-review-queue.test.ts",
      "tests/intelligence/gemini-context-cache.test.ts",
      "tests/intelligence/editorial-boundary.test.ts",
      "tests/intelligence/memo-contract.test.ts",
      "tests/serving/staged-rich-serving.test.ts",
      "tests/intelligence/bedrock-converse-model.test.ts",
    ],
  },
  {
    id: "gate-0-safety",
    name: "Gate 0 Safety Invariants",
    description:
      "Fail-closed profile resolution, non-escalating permissions, canonical verdicts, reproducibility, and durable worker recovery",
    files: [
      "tests/intelligence/profile-projection-version-compat.test.ts",
      "tests/security/scraper-auth-permission-non-escalation.test.ts",
      "tests/security/evaluation-context-isolation.test.ts",
    ],
  },
  {
    id: "pursuit",
    name: "Pursuit Profile and Evidence Lineage",
    description: "Pursuit host integration, semantic acceptance, approval ledger, and boundaries",
    files: [
      "tests/pursuit/core-host-integration.test.ts",
      "tests/pursuit/integration-boundaries.test.ts",
      "tests/pursuit/memo-model-benchmark.test.ts",
      "tests/pursuit/thesis-enrichment-integrity.test.ts",
      "tests/pursuit/semantic-acceptance.test.ts",
      "tests/pursuit/approval-ledger.test.ts",
    ],
  },
  {
    id: "runtime-release-safety",
    name: "Runtime & Release Safety Regressions",
    description:
      "Canonical candidate truth, worker separation, corpus durability, migration integrity, and release safety",
    files: [
      "tests/intelligence/candidate-truth-boundary.test.ts",
      "tests/intelligence/phase-c-runtime-separation.test.ts",
      "tests/intelligence/corpus-regeneration-worker.test.ts",
      "tests/intelligence/evaluator-control-worker-liveness.test.ts",
      "tests/persistence/migration-runner.test.ts",
      "tests/persistence/populated-migration.test.ts",
      "tests/release/readiness.test.ts",
      "tests/release/artifact-integrity.test.ts",
      "tests/release/runtime-topology.test.ts",
      "tests/release/deployment.test.ts",
    ],
  },
] as const;

export const certificationTestFiles = certificationManifest.flatMap((group) => group.files);

export const uniqueCertificationTestFiles = [...new Set(certificationTestFiles)];

export const requiredCertificationRegressionFiles = [
  "tests/security/candidate-profile-tenant-isolation.test.ts",
  "tests/security/tenant-isolation.test.ts",
  "tests/security/oauth-scope-provisioning.test.ts",
  "tests/security/m62-credential-vault.test.ts",
  "tests/intelligence/candidate-truth-boundary.test.ts",
  "tests/intelligence/phase-c-runtime-separation.test.ts",
  "tests/intelligence/corpus-regeneration-worker.test.ts",
] as const;

if (uniqueCertificationTestFiles.length !== certificationTestFiles.length) {
  throw new Error("CERTIFICATION_MANIFEST_DUPLICATE_FILE");
}
