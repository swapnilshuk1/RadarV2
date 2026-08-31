/**
 * tests/certification/test-inventory-audit.test.ts
 *
 * RADAR v2 — Self-Auditing Test Inventory & Anti-Regression Integrity Contract
 *
 * Mechanically asserts that:
 * 1. Every test file on disk is explicitly listed and classified in tests/TEST_INVENTORY.md.
 * 2. Every non-archived test file has an explicit valid disposition (KEEP or REVIEW).
 * 3. No zero-active-test file is classified as KEEP.
 * 4. Every test file referenced in scripts/certify.ts exists on disk.
 * 5. All 7 mandatory certification stages are present and executable.
 * 6. Every production-critical invariant in the inventory has an authoritative test suite on disk.
 * 7. Zero bypasses (e.g. '|| true', '; exit 0') exist in certification commands.
 * 8. All tests under tests/archive/ are classified as ARCHIVE.
 * 9. Key operational, deployment, and certification scripts exist on disk.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { STAGES } from "../../scripts/certify";
import { certificationTestFiles } from "../../scripts/certification/manifest";

describe("Test Inventory Self-Auditing & Governance Contract", () => {
  const inventoryPath = path.resolve(process.cwd(), "tests/TEST_INVENTORY.md");
  const inventoryContent = fs.readFileSync(inventoryPath, "utf-8");

  function getTestFilesOnDisk(): string[] {
    const testsDir = path.resolve(process.cwd(), "tests");
    const testFiles: string[] = [];

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
          testFiles.push(path.relative(process.cwd(), full).replace(/\\/g, "/"));
        }
      }
    }

    walk(testsDir);
    return testFiles.sort();
  }

  const testFilesOnDisk = getTestFilesOnDisk();

  it("1. asserts every test file on disk is explicitly classified in TEST_INVENTORY.md", () => {
    for (const file of testFilesOnDisk) {
      expect(
        inventoryContent.includes(`\`${file}\``),
        `Test file "${file}" is missing from tests/TEST_INVENTORY.md registry!`
      ).toBe(true);
    }
  });

  it("2. asserts every non-archived test has an explicit disposition (KEEP or REVIEW)", () => {
    const registrySection = inventoryContent.split("## 3. Complete Test File Registry")[1];
    expect(registrySection, "Section 3 not found in TEST_INVENTORY.md").toBeDefined();
    const lines = registrySection.split("\n");

    for (const file of testFilesOnDisk) {
      if (!file.startsWith("tests/archive/")) {
        const tableLine = lines.find((l) => l.includes(`\`${file}\``));
        expect(tableLine, `Line for "${file}" not found in Section 3 of TEST_INVENTORY.md`).toBeDefined();
        const hasValidDisposition =
          tableLine!.includes("**KEEP**") || tableLine!.includes("**REVIEW**");
        expect(
          hasValidDisposition,
          `File "${file}" has invalid disposition in TEST_INVENTORY.md: "${tableLine}"`
        ).toBe(true);
      }
    }
  });

  it("3. asserts no zero-active-test file is classified as KEEP", () => {
    const registrySection = inventoryContent.split("## 3. Complete Test File Registry")[1];
    const lines = registrySection.split("\n");

    for (const file of testFilesOnDisk) {
      if (!file.startsWith("tests/archive/")) {
        const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
        const itMatches = content.match(/\b(it|test)\s*\(/g) || [];
        const expectMatches = content.match(/\bexpect\s*\(/g) || [];

        const tableLine = lines.find((l) => l.includes(`\`${file}\``));

        if (tableLine && tableLine.includes("**KEEP**")) {
          expect(
            itMatches.length > 0,
            `File "${file}" is marked KEEP but contains 0 test() or it() blocks!`
          ).toBe(true);
          expect(
            expectMatches.length > 0,
            `File "${file}" is marked KEEP but contains 0 expect() assertions!`
          ).toBe(true);
        }
      }
    }
  });

  it("4. asserts every manifest certification test exists on disk", () => {
    for (const suite of certificationTestFiles) {
      expect(
        fs.existsSync(path.resolve(process.cwd(), suite)),
        `Certification suite "${suite}" in the manifest does not exist on disk!`
      ).toBe(true);
    }
  });

  it("5. asserts all 7 mandatory certification stages exist and have executable commands", () => {
    expect(STAGES).toHaveLength(7);
    for (const stage of STAGES) {
      expect(stage.name).toBeDefined();
      expect(stage.command).toBeDefined();
      expect(stage.command.length).toBeGreaterThan(0);
      if (stage.execution === "reported-by-manifest") {
        expect(stage.command).toContain("Unified Vitest certification manifest");
      }
      expect(stage.description).toBeDefined();
    }
  });

  it("6. asserts every production-critical invariant in the inventory has an authoritative test on disk", () => {
    const criticalAuthoritativeSuites = [
      "tests/intelligence/canonical-ingestion-fk-regression.test.ts",
      "tests/intelligence/canonical-acquisition-integrity.test.ts",
      "tests/intelligence/semantic-evidence-integrity-regression.test.ts",
      "tests/intelligence/metrics-portal-breakdown.test.ts",
      "tests/serving/sql_metrics_aggregation.test.ts",
      "tests/serving/keyset_pagination.test.ts",
      "tests/serving/cursor.test.ts",
      "tests/security/scope-resolver-equivalence.test.ts",
      "tests/editorial/explanation-contract.test.ts",
      "tests/certification/journey_a_acquisition_to_evaluation.test.ts",
      "tests/certification/journey_b_semantic_grounding_to_policy.test.ts",
      "tests/certification/journey_c_decision_persistence_to_dto.test.ts",
      "tests/certification/journey_d_loader_to_ui_rendering.test.ts",
      "tests/certification/certification-gate-integrity.test.ts",
    ];

    for (const suite of criticalAuthoritativeSuites) {
      expect(
        fs.existsSync(path.resolve(process.cwd(), suite)),
        `Authoritative critical suite "${suite}" missing from repository!`
      ).toBe(true);
    }
  });

  it("7. asserts zero bypasses exist in certification stage commands", () => {
    for (const stage of STAGES) {
      expect(stage.command).not.toMatch(/\|\|\s*true/i);
      expect(stage.command).not.toMatch(/\|\|\s*exit\s+0/i);
      expect(stage.command).not.toMatch(/;\s*exit\s+0/i);
      expect(stage.command).not.toMatch(/\|\|\s*:/);
    }
  });

  it("8. asserts all tests in tests/archive/ are classified as ARCHIVE in the inventory", () => {
    const registrySection = inventoryContent.split("## 3. Complete Test File Registry")[1];
    const lines = registrySection.split("\n");
    for (const file of testFilesOnDisk) {
      if (file.startsWith("tests/archive/")) {
        const tableLine = lines.find((l) => l.includes(`\`${file}\``));
        expect(tableLine, `Archived file "${file}" missing from Section 3 of inventory!`).toBeDefined();
        expect(
          tableLine!.includes("**ARCHIVE**"),
          `Archived file "${file}" must have disposition **ARCHIVE**, got: "${tableLine}"`
        ).toBe(true);
      }
    }
  });

  it("9. asserts essential operational, certification, and deployment scripts exist on disk", () => {
    const requiredScripts = [
      "scripts/scrape.ts",
      "scripts/enrich.ts",
      "scripts/certify.ts",
      "scripts/smoke_production.ts",
      "scripts/diagnose.ts",
      "scripts/deploy.ts",
    ];

    for (const script of requiredScripts) {
      expect(
        fs.existsSync(path.resolve(process.cwd(), script)),
        `Critical script "${script}" does not exist on disk!`
      ).toBe(true);
    }
  });
});
