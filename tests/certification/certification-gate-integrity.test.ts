/**
 * tests/certification/certification-gate-integrity.test.ts
 *
 * RADAR v2 — Meta-Certification Integrity Contract
 *
 * Verifies that the Continuous Certification Gate itself is durable, hard to fool,
 * and cannot silently regress:
 * 1. All mandatory certification stages and critical test suites are present.
 * 2. Stage commands contain zero bypasses (no '|| true', '; exit 0', or swallowed failures).
 * 3. Subprocess failures propagate non-zero exit codes.
 * 4. Deliberate failure triggers CERTIFICATION FAIL and process termination.
 * 5. Certification relies on invariant/contract assertions rather than hardcoded remote dataset counts.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";
import { STAGES } from "../../scripts/certify";
import {
  certificationManifest,
  certificationTestFiles,
  EXPECTED_CERTIFICATION_FILE_COUNT,
  uniqueCertificationTestFiles,
} from "../../scripts/certification/manifest";
import { filesForAffectedGroups, selectAffectedGroupIds } from "../../scripts/certification/affected";

describe("Certification Gate Integrity & Anti-Regression Contract", () => {
  const certifyScriptPath = path.resolve(process.cwd(), "scripts/certify.ts");
  const certifyScriptContent = fs.readFileSync(certifyScriptPath, "utf-8");

  it("1. asserts all 7 mandatory certification stages are registered in strict deterministic order", () => {
    expect(STAGES).toHaveLength(7);

    const expectedStageKeywords = [
      { name: "TypeScript", cmd: "tsconfig.verify.json" },
      { name: "Four Boundary Journeys", cmd: "vitest.certification.config.ts" },
      { name: "Ingestion & Lineage", cmd: "Unified Vitest certification manifest" },
      { name: "Multi-Tenant & Scope Security", cmd: "Unified Vitest certification manifest" },
      { name: "Serving Store & Keyset", cmd: "Unified Vitest certification manifest" },
      { name: "Editorial Governance", cmd: "Unified Vitest certification manifest" },
      { name: "Production SSR Bundle Build", cmd: "npm run build" },
    ];

    expectedStageKeywords.forEach((expected, index) => {
      expect(STAGES[index].name).toContain(expected.name);
      expect(STAGES[index].command).toContain(expected.cmd);
    });
  });

  it("2. asserts the reviewed certification manifest contains exactly the required files once", () => {
    const expectedFiles = [
      "tests/certification/certification-gate-integrity.test.ts",
      "tests/certification/journey_a_acquisition_to_evaluation.test.ts",
      "tests/certification/journey_b_semantic_grounding_to_policy.test.ts",
      "tests/certification/journey_c_decision_persistence_to_dto.test.ts",
      "tests/certification/journey_d_loader_to_ui_rendering.test.ts",
      "tests/certification/test-inventory-audit.test.ts",
      "tests/intelligence/canonical-ingestion-fk-regression.test.ts",
      "tests/intelligence/canonical-acquisition-integrity.test.ts",
      "tests/intelligence/canonical-identity.test.ts",
      "tests/intelligence/semantic-evidence-integrity-regression.test.ts",
      "tests/intelligence/metrics-portal-breakdown.test.ts",
      "tests/persistence/queue-crash-restart.test.ts",
      "tests/persistence/scrape-run-state-machine.test.ts",
      "tests/persistence/cross-instance-payload-retrieval.test.ts",
      "tests/security/scope-resolver-equivalence.test.ts",
      "tests/security/deploy-attack-surface-removed.test.ts",
      "tests/security/scrape-tenant-identity.test.ts",
      "tests/security/scrape-run-ownership.test.ts",
      "tests/ontology/tenant-ontology-compiler.test.ts",
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
      "tests/editorial/career-value-integrity.test.ts",
      "tests/editorial/explanation-composition.test.ts",
      "tests/editorial/explanation-contract.test.ts",
      "tests/editorial/shortlist-badge-resolution.test.ts",
      "tests/editorial/ui-score-resolution.test.ts",
      "tests/editorial/verdict-coverage.test.ts",
    ];

    expect(certificationManifest).toHaveLength(5);
    expect(EXPECTED_CERTIFICATION_FILE_COUNT).toBe(35);
    expect(certificationTestFiles).toHaveLength(EXPECTED_CERTIFICATION_FILE_COUNT);
    expect(uniqueCertificationTestFiles).toHaveLength(EXPECTED_CERTIFICATION_FILE_COUNT);
    expect([...certificationTestFiles].sort()).toEqual([...expectedFiles].sort());

    for (const file of certificationTestFiles) {
      expect(fs.existsSync(path.resolve(process.cwd(), file)), `Certification file "${file}" is missing`).toBe(true);
    }
  });

  it("3. asserts zero shell bypasses or swallowed exit codes exist in certify.ts", () => {
    // Prohibit '|| true', '|| exit 0', '|| :'
    expect(certifyScriptContent).not.toMatch(/\|\|\s*true/i);
    expect(certifyScriptContent).not.toMatch(/\|\|\s*exit\s+0/i);
    expect(certifyScriptContent).not.toMatch(/\|\|\s*:/);

    // Verify error catch block explicitly calls process.exit(1)
    expect(certifyScriptContent).toContain("process.exit(1)");
    expect(certifyScriptContent).toContain("CERTIFICATION FAIL");
    expect(certifyScriptContent).toContain("CERTIFICATION PASS");
  });

  it("3a. keeps affected-test feedback conservative and manifest-derived", () => {
    expect(selectAffectedGroupIds(["package.json"])).toEqual(certificationManifest.map((group) => group.id));
    expect(selectAffectedGroupIds(["src/lib/intelligence/editorial/BriefCompositionEngine.ts"])).toEqual([
      "boundary-journeys",
      "editorial-governance",
    ]);
    expect(selectAffectedGroupIds(["unmapped/future-system.ts"])).toEqual(certificationManifest.map((group) => group.id));
    expect(filesForAffectedGroups(["tenant-security"])).toEqual(
      certificationManifest.find((group) => group.id === "tenant-security")!.files
    );
  });

  it("4. asserts failing subprocess terminates certification gate with non-zero exit code", { timeout: 60000 }, () => {
    let threw = false;
    let errorOutput = "";

    try {
      execSync(
        `npx tsx -e "import { runCertification } from './scripts/certify'; runCertification([{ name: 'Failing Subprocess Stage', command: 'node -e \\"process.exit(2)\\"', description: 'Intentional failure test' }]);"`,
        {
          cwd: process.cwd(),
          stdio: "pipe",
          encoding: "utf-8",
        }
      );
    } catch (err: any) {
      threw = true;
      errorOutput = (err.stdout || "") + (err.stderr || "");
    }

    expect(threw).toBe(true);
    expect(errorOutput).toContain("CERTIFICATION FAIL");
    expect(errorOutput).toContain("Failing Subprocess Stage FAILED");
  });

  it("5. asserts all four boundary journey test files exist on disk", () => {
    const certDir = path.resolve(process.cwd(), "tests/certification");
    const files = fs.readdirSync(certDir);

    expect(files).toContain("journey_a_acquisition_to_evaluation.test.ts");
    expect(files).toContain("journey_b_semantic_grounding_to_policy.test.ts");
    expect(files).toContain("journey_c_decision_persistence_to_dto.test.ts");
    expect(files).toContain("journey_d_loader_to_ui_rendering.test.ts");
  });

  it("6. asserts certification criteria does not hardcode volatile live dataset row counts", () => {
    const journeyA = fs.readFileSync(path.resolve(process.cwd(), "tests/certification/journey_a_acquisition_to_evaluation.test.ts"), "utf-8");
    const journeyB = fs.readFileSync(path.resolve(process.cwd(), "tests/certification/journey_b_semantic_grounding_to_policy.test.ts"), "utf-8");
    const journeyC = fs.readFileSync(path.resolve(process.cwd(), "tests/certification/journey_c_decision_persistence_to_dto.test.ts"), "utf-8");
    const journeyD = fs.readFileSync(path.resolve(process.cwd(), "tests/certification/journey_d_loader_to_ui_rendering.test.ts"), "utf-8");

    // Invariant assertions over dynamic sums rather than hardcoded magic constants
    expect(journeyD).toContain("portalSum");
    expect(journeyA).not.toContain("expect(rows.length).toBe(2231)");
    expect(journeyB).not.toContain("expect(rows.length).toBe(3007)");
    expect(journeyC).not.toContain("expect(rows.length).toBe(2231)");
  });
});
