/**
 * tests/certification/test-inventory-audit.test.ts
 *
 * RADAR v2 — Self-Auditing Test Inventory & Anti-Regression Integrity Contract
 *
 * Mechanically asserts that:
 * 1. Every test file on disk is explicitly listed and classified in tests/TEST_INVENTORY.md.
 * 2. Every test file registered in TEST_INVENTORY.md exists on disk (bidirectional audit).
 * 3. Every test file has an explicit valid disposition (KEEP or REVIEW).
 * 4. No zero-active-test file is classified as KEEP.
 * 5. Zero archived test files exist on disk, and zero tests/archive/ entries exist in the inventory registry.
 * 6. Every test file referenced in scripts/certify.ts exists on disk.
 * 7. All mandatory certification stages are present and executable.
 * 8. Every production-critical invariant in the inventory has an authoritative test suite on disk.
 * 9. Zero bypasses (e.g. '|| true', '; exit 0') exist in certification commands.
 * 10. Key operational, deployment, and certification scripts exist on disk.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { STAGES } from "../../scripts/certify";
import {
  certificationTestFiles,
  requiredCertificationRegressionFiles,
} from "../../scripts/certification/manifest";
import { testRegistry } from "../../scripts/certification/registry";
import { updateInventory } from "../../scripts/certification/inventory";

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

  it("derives every lane and inventory row from the registry without drift", () => {
    expect(testRegistry.map((entry) => entry.file).sort()).toEqual(testFilesOnDisk);
    expect(new Set(testRegistry.map((entry) => entry.file)).size).toBe(testRegistry.length);
    const normalized = inventoryContent.replaceAll("\r\n", "\n");
    expect(updateInventory(normalized)).toBe(normalized);
    expect(
      testRegistry.filter((entry) => entry.certificationGroup).every((entry) => entry.full),
    ).toBe(true);
  });

  it("1. asserts every test file on disk is explicitly classified in TEST_INVENTORY.md", () => {
    for (const file of testFilesOnDisk) {
      expect(
        inventoryContent.includes(`\`${file}\``),
        `Test file "${file}" is missing from tests/TEST_INVENTORY.md registry!`,
      ).toBe(true);
    }
  });

  it("2. asserts every test file registered in TEST_INVENTORY.md exists on disk (bidirectional audit)", () => {
    const registrySection =
      inventoryContent.split("## 3. Complete Test File Registry")[1]?.split("## 4.")[0] || "";
    expect(registrySection, "Section 3 not found in TEST_INVENTORY.md").toBeDefined();
    const tableMatches = [...registrySection.matchAll(/\|\s*`([^`]+\.test\.ts)`/g)].map(
      (m) => m[1],
    );
    expect(tableMatches.length).toBeGreaterThan(0);

    for (const file of tableMatches) {
      expect(
        fs.existsSync(path.resolve(process.cwd(), file)),
        `Inventory lists test file "${file}", but it does not exist on disk!`,
      ).toBe(true);
    }
    expect(tableMatches.length).toBe(testFilesOnDisk.length);
  });

  it("3. asserts every test file has an explicit disposition (KEEP or REVIEW)", () => {
    const registrySection = inventoryContent.split("## 3. Complete Test File Registry")[1];
    expect(registrySection, "Section 3 not found in TEST_INVENTORY.md").toBeDefined();
    const lines = registrySection.split("\n");

    for (const file of testFilesOnDisk) {
      const tableLine = lines.find((l) => l.includes(`\`${file}\``));
      expect(
        tableLine,
        `Line for "${file}" not found in Section 3 of TEST_INVENTORY.md`,
      ).toBeDefined();
      const hasValidDisposition =
        tableLine!.includes("**KEEP**") || tableLine!.includes("**REVIEW**");
      expect(
        hasValidDisposition,
        `File "${file}" has invalid disposition in TEST_INVENTORY.md: "${tableLine}"`,
      ).toBe(true);
    }
  });

  it("4. asserts no zero-active-test file is classified as KEEP", () => {
    const registrySection = inventoryContent.split("## 3. Complete Test File Registry")[1];
    const lines = registrySection.split("\n");

    for (const file of testFilesOnDisk) {
      const content = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      const itMatches = content.match(/\b(it|test)\s*\(/g) || [];
      const expectMatches = content.match(/\bexpect\s*\(/g) || [];

      const tableLine = lines.find((l) => l.includes(`\`${file}\``));

      if (tableLine && tableLine.includes("**KEEP**")) {
        expect(
          itMatches.length > 0,
          `File "${file}" is marked KEEP but contains 0 test() or it() blocks!`,
        ).toBe(true);
        expect(
          expectMatches.length > 0,
          `File "${file}" is marked KEEP but contains 0 expect() assertions!`,
        ).toBe(true);
      }
    }
  });

  it("5. asserts zero archived test files on disk and zero tests/archive/ references in inventory registry", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "tests/archive"))).toBe(false);
    const registrySection =
      inventoryContent.split("## 3. Complete Test File Registry")[1]?.split("## 4.")[0] || "";
    expect(registrySection.includes("tests/archive/")).toBe(false);
  });

  it("6. asserts every manifest certification test exists on disk", () => {
    for (const suite of certificationTestFiles) {
      expect(
        fs.existsSync(path.resolve(process.cwd(), suite)),
        `Certification suite "${suite}" in the manifest does not exist on disk!`,
      ).toBe(true);
    }
  });

  it("7. asserts all mandatory certification stages exist and have executable commands", () => {
    expect(STAGES).toHaveLength(5);
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

  it("8. keeps required release regressions inside the current certification manifest", () => {
    for (const suite of requiredCertificationRegressionFiles) {
      expect(certificationTestFiles).toContain(suite);
      expect(fs.existsSync(path.resolve(process.cwd(), suite)), suite).toBe(true);
    }
  });

  it("9. asserts zero bypasses exist in certification stage commands", () => {
    for (const stage of STAGES) {
      expect(stage.command).not.toMatch(/\|\|\s*true/i);
      expect(stage.command).not.toMatch(/\|\|\s*exit\s+0/i);
      expect(stage.command).not.toMatch(/;\s*exit\s+0/i);
      expect(stage.command).not.toMatch(/\|\|\s*:/);
    }
  });

  it("10. asserts essential operational, certification, and deployment scripts exist on disk", () => {
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
        `Critical script "${script}" does not exist on disk!`,
      ).toBe(true);
    }
  });
});
