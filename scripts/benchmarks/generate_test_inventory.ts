import * as fs from "fs";
import * as path from "path";

function generateTestInventory() {
  const testsDir = path.resolve(process.cwd(), "tests");
  const testFiles: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        testFiles.push(full);
      }
    }
  }

  walk(testsDir);
  testFiles.sort();

  const certifyScript = fs.readFileSync(path.resolve(process.cwd(), "scripts/certify.ts"), "utf-8");

  interface Entry {
    rel: string;
    tests: number;
    assertions: number;
    disposition: "KEEP" | "REVIEW" | "ARCHIVE";
    domain: string;
    stage: string;
  }

  const entries: Entry[] = [];

  for (const file of testFiles) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    const content = fs.readFileSync(file, "utf-8");
    const itMatches = content.match(/\b(it|test)\s*\(/g) || [];
    const expectMatches = content.match(/\bexpect\s*\(/g) || [];

    let disposition: "KEEP" | "REVIEW" | "ARCHIVE" = "KEEP";
    let stage = "Full Suite";

    if (rel.startsWith("tests/archive/")) {
      disposition = "ARCHIVE";
      stage = "Archived";
    } else if (rel.includes("/regression/p") || rel.includes("for4")) {
      disposition = "REVIEW";
      stage = "Full Suite";
    }

    if (certifyScript.includes(path.basename(file))) {
      disposition = "KEEP";
      if (rel.startsWith("tests/certification/")) stage = "Stage 2";
      else if (rel.includes("canonical-ingestion") || rel.includes("canonical-acquisition") || rel.includes("canonical-identity") || rel.includes("semantic-evidence") || rel.includes("metrics-portal")) stage = "Stage 3";
      else if (rel.includes("scope-resolver") || rel.includes("tenant-ontology")) stage = "Stage 4";
    } else if (rel.startsWith("tests/serving/") && certifyScript.includes("tests/serving/")) {
      disposition = "KEEP";
      stage = "Stage 5";
    } else if (rel.startsWith("tests/editorial/") && certifyScript.includes("tests/editorial/")) {
      disposition = "KEEP";
      stage = "Stage 6";
    }

    let domain = "Evaluation & Policy";
    if (rel.includes("certification/")) domain = "Certification Integrity";
    else if (rel.includes("editorial/")) domain = "Editorial / Verdict Governance";
    else if (rel.includes("security/") || rel.includes("tenant") || rel.includes("scope-resolver")) domain = "Security & Tenant Isolation";
    else if (rel.includes("serving/") || rel.includes("cursor") || rel.includes("keyset")) domain = "Serving & Pagination";
    else if (rel.includes("metrics") || rel.includes("portal-breakdown")) domain = "Metrics & Aggregation";
    else if (rel.includes("decision") || rel.includes("decisions")) domain = "Decision Persistence";
    else if (rel.includes("identity") || rel.includes("candidate-profile")) domain = "Identity & Candidate Projection";
    else if (rel.includes("semantic") || rel.includes("ontology") || rel.includes("normalization")) domain = "Semantic Grounding";
    else if (rel.includes("ingestion") || rel.includes("acquisition") || rel.includes("scraper") || rel.includes("portal")) domain = "Ingestion & Lineage";

    entries.push({
      rel,
      tests: itMatches.length,
      assertions: expectMatches.length,
      disposition,
      domain,
      stage,
    });
  }

  let md = `# RADAR v2 — Permanent Test Architecture Map & Inventory

This document defines the authoritative test domains, invariant contracts, certification stage mappings, and full mechanical test registry for the RADAR v2 Executive Intelligence Engine.

---

## 1. Governance Policy: The Invariant-First Protocol

All future coding agents and engineers modifying or adding tests MUST adhere to this strict six-step protocol:

1. **Identify the Invariant**: State what system behavior, data relationship, security boundary, or UI contract is being verified.
2. **Check for Authoritative Home**: Inspect this document to determine whether the invariant is already covered in one of the canonical domain suites below.
3. **If Unique and Valid**: Keep and modernize the test in its proper canonical domain.
4. **If Duplicate**: Consolidate into the authoritative suite rather than proliferating milestone-numbered files (\`mXX\`, \`pXX\`, \`phaseXX\`).
5. **If Obsolete**: Archive to \`tests/archive/\` with explicit written justification of why the behavior is no longer part of the architecture.
6. **Continuous Certification Gate**: Always ensure \`npm run certify\` and \`npm run smoke\` pass cleanly.

---

## 2. Canonical Test Domains & Authoritative Suites

RADAR v2 test architecture is organized into **11 Canonical Domains**:

\`\`\`
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
\`\`\`

---

### Domain 1: Ingestion & Lineage

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/intelligence/canonical-ingestion-fk-regression.test.ts\` | Resolves existing \`opportunity_versions.id\` on conflict; zero orphan foreign keys. | **Stage 3** |
| \`tests/intelligence/canonical-acquisition-integrity.test.ts\` | Multi-portal acquisition payload validation, SHA-256 content hashing, and version lineage. | **Stage 3** |
| \`tests/intelligence/canonical-identity.test.ts\` | Idempotent candidate projection creation and search plan link stability. | **Stage 3** |

---

### Domain 2: Identity & Candidate Projection

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/intelligence/identity.test.ts\` | Executive seniority categorization (\`C_SUITE\`, \`VP\`), role matching, and theme extraction. | Full Suite |
| \`tests/intelligence/worker-profile-resolution.test.ts\` | EvaluationWorker resolves candidate profile strictly from tenant/person scope without static fallbacks. | Full Suite |

---

### Domain 3: Semantic Grounding

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/intelligence/semantic-evidence-integrity-regression.test.ts\` | Dimension grounding prevents false evidence vetoes on rich executive postings. | **Stage 3** |
| \`tests/semantic/ontology.test.ts\` | Comprehensive executive ontology validation (roles, capabilities, industries, seniority). | Full Suite |
| \`tests/semantic/normalization.test.ts\` | Currency, date, location, and seniority string normalization. | Full Suite |

---

### Domain 4: Evaluation & Policy

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/policy/eligibility-gates.test.ts\` | Strict evaluation of core eligibility criteria (location, seniority, operating model). | Full Suite |
| \`tests/policy/headspace-serving-contract.test.ts\` | Executive headspace capacity capping and active pursuit thresholding. | Full Suite |
| \`tests/intelligence/recommendation-golden.test.ts\` | Deterministic end-to-end evaluation against golden candidate and job fixtures. | Full Suite |

---

### Domain 5: Decision Persistence

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/certification/journey_c_decision_persistence_to_dto.test.ts\` | Rapid user decision updates idempotently upsert \`canonical_decisions\` and reflect immediately in Feed DTO. | **Stage 2** |
| \`tests/intelligence/m9_3-decisions-store-client.test.ts\` | Optimistic UI store synchronization with server functions and rollback on error. | Full Suite |

---

### Domain 6: Serving & Pagination

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/serving/keyset_pagination.test.ts\` | Keyset pagination returns deterministic, contiguous pages without duplicate rows. | **Stage 5** |
| \`tests/serving/cursor.test.ts\` | Opaque cursor encoding, decoding, validation, and tamper-resistance. | **Stage 5** |
| \`tests/serving/singleflight_and_observability.test.ts\` | Singleflight request coalescing prevents duplicate concurrent database queries. | **Stage 5** |
| \`tests/serving/dossier_and_navigation.test.ts\` | Dossier detail fetching and next/previous candidate navigation indices. | **Stage 5** |
| \`tests/serving/sql_feed_parity.test.ts\` | Serving feed SQL queries match materialized evaluation and user decision states. | **Stage 5** |

---

### Domain 7: Metrics & Aggregation

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/intelligence/metrics-portal-breakdown.test.ts\` | Portal metrics represent full database search plan population, not local page samples. | **Stage 3** |
| \`tests/serving/sql_metrics_aggregation.test.ts\` | Canonical population, engine/user/effective metric partitions reconcile independently; \`allRecordedDecisions = userBreakdown.total\`. | **Stage 5** |

---

### Domain 8: Security & Tenant Isolation

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/security/scope-resolver-equivalence.test.ts\` | Strict multi-tenant scope isolation: zero data leaks across distinct tenant boundaries. | **Stage 4** |
| \`tests/ontology/tenant-ontology-compiler.test.ts\` | Tenant-customized ontology definitions compile and validate within tenant sandboxes. | **Stage 4** |
| \`tests/security/m62-credential-vault.test.ts\` | AES-256 envelope encryption and key rotation for portal scraper credentials. | Full Suite |

---

### Domain 9: Editorial / Verdict Governance

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/editorial/explanation-contract.test.ts\` | Rule 13 compliance: evidence-grounded executive prose without unsupported claims. | **Stage 6** |
| \`tests/editorial/ui-score-resolution.test.ts\` | Executive score resolution (e.g. \`83\` vs \`—\`) strictly decoupled from visual decoration. | **Stage 6** |
| \`tests/editorial/shortlist-badge-resolution.test.ts\` | Shortlist badge state resolution (\`pursue\`, \`consider\`, \`needs more signal\`). | **Stage 6** |

---

### Domain 10: UI / User Journeys

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/certification/journey_a_acquisition_to_evaluation.test.ts\` | Ingestion $\\rightarrow$ Version $\\rightarrow$ Candidate Attention $\\rightarrow$ Materialized Evaluation. | **Stage 2** |
| \`tests/certification/journey_b_semantic_grounding_to_policy.test.ts\` | Semantic Dimension Grounding $\\rightarrow$ DecisionPolicyEngine qualification. | **Stage 2** |
| \`tests/certification/journey_c_decision_persistence_to_dto.test.ts\` | Decision Persistence $\\rightarrow$ Feed DTO Synchronization. | **Stage 2** |
| \`tests/certification/journey_d_loader_to_ui_rendering.test.ts\` | Loader Metrics $\\rightarrow$ Component State & UI Score Resolution. | **Stage 2** |

---

### Domain 11: Certification Integrity

| Authoritative Suite | Primary Invariant Protected | Certification Stage |
| :--- | :--- | :---: |
| \`tests/certification/certification-gate-integrity.test.ts\` | Asserts that \`npm run certify\` runs all mandatory stages, propagates exit codes, and has zero bypasses. | **Stage 2** |
| \`tests/certification/test-inventory-audit.test.ts\` | Mechanically verifies that all test files and script categories in this inventory exist and are classified. | **Stage 2** |

---

## 3. Complete Test File Registry (${entries.length} Total Files)

Every test file in the repository is mechanically tracked below:

| File Path | Domain | Disposition | Stage | Tests | Assertions |
| :--- | :--- | :---: | :---: | :---: | :---: |
`;

  for (const e of entries) {
    md += `| \`${e.rel}\` | ${e.domain} | **${e.disposition}** | ${e.stage} | ${e.tests} | ${e.assertions} |\n`;
  }

  md += `
---

## 4. Script Category Registry

Scripts in \`scripts/\` are classified into the following authoritative categories:

| Category | Description / Canonical Files | Action |
| :--- | :--- | :---: |
| **OPERATIONAL** | \`scripts/scrape.ts\`, \`scripts/scraper/*\`, \`scripts/enrich.ts\`, \`scripts/corpus/*\` | **KEEP** |
| **CERTIFICATION** | \`scripts/certify.ts\`, \`scripts/certification/*\` | **KEEP** |
| **DEPLOYMENT** | \`scripts/deploy.ts\`, \`scripts/deploy.ps1\` | **KEEP** |
| **MIGRATION** | \`scripts/db/*\`, \`scripts/golden/*\` | **KEEP** |
| **BENCHMARK** | \`scripts/qa-eval.ts\`, \`scripts/eval/*\`, \`scripts/benchmarks/*\` | **KEEP** |
| **DIAGNOSTIC** | \`scripts/diagnose.ts\` | **KEEP** |
| **ARCHIVE / HISTORICAL** | Ad-hoc one-time forensic probes | **ARCHIVE** |
`;

  fs.writeFileSync(path.resolve(process.cwd(), "tests/TEST_INVENTORY.md"), md);
  console.log(`Generated TEST_INVENTORY.md with ${entries.length} test files!`);
}

generateTestInventory();
