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
import { tmpdir } from "node:os";
import { spawnSync } from "child_process";
import { STAGES, FEEDBACK_STAGES, type Stage } from "../../scripts/certify";
import {
  certificationManifest,
  certificationTestFiles,
  requiredCertificationRegressionFiles,
  uniqueCertificationTestFiles,
} from "../../scripts/certification/manifest";
import {
  filesForAffectedGroups,
  selectAffectedGroupIds,
} from "../../scripts/certification/affected";

describe("Certification Gate Integrity & Anti-Regression Contract", () => {
  const certifyScriptPath = path.resolve(process.cwd(), "scripts/certify.ts");
  const certifyScriptContent = fs.readFileSync(certifyScriptPath, "utf-8");

  it("1. asserts all release-gate stages are registered in strict deterministic order", () => {
    expect(STAGES).toHaveLength(9);

    const expectedStageKeywords = [
      { name: "Lint", cmd: "npm run lint" },
      { name: "Formatting", cmd: "npm run format:check" },
      { name: "TypeScript", cmd: "tsconfig.verify.json" },
      { name: "Production SSR Bundle Build", cmd: "npm run build" },
      { name: "Four Boundary Journeys", cmd: "vitest.certification.config.ts" },
      { name: "Ingestion & Lineage", cmd: "Unified Vitest certification manifest" },
      { name: "Multi-Tenant & Scope Security", cmd: "Unified Vitest certification manifest" },
      { name: "Serving Store & Keyset", cmd: "Unified Vitest certification manifest" },
      { name: "Staged-v8 Memo & Serving Contracts", cmd: "Unified Vitest certification manifest" },
    ];

    expectedStageKeywords.forEach((expected, index) => {
      expect(STAGES[index].name).toContain(expected.name);
      expect(STAGES[index].command).toContain(expected.cmd);
    });
  });

  it("2. derives the release inventory from one manifest and includes every required regression", () => {
    expect(certificationManifest.map((group) => group.id)).toEqual([
      "boundary-journeys",
      "ingestion-lineage",
      "tenant-security",
      "serving-pagination",
      "staged-dossier-merge-gate",
      "gate-0-safety",
      "pursuit",
      "runtime-release-safety",
    ]);
    expect(uniqueCertificationTestFiles).toHaveLength(certificationTestFiles.length);
    for (const file of requiredCertificationRegressionFiles)
      expect(certificationTestFiles).toContain(file);

    for (const file of certificationTestFiles) {
      expect(
        fs.existsSync(path.resolve(process.cwd(), file)),
        `Certification file "${file}" is missing`,
      ).toBe(true);
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
    expect(selectAffectedGroupIds(["package.json"])).toEqual(
      certificationManifest.map((group) => group.id),
    );
    expect(
      selectAffectedGroupIds(["src/lib/intelligence/editorial/BriefCompositionEngine.ts"]),
    ).toEqual(["boundary-journeys", "staged-dossier-merge-gate"]);
    expect(selectAffectedGroupIds(["unmapped/future-system.ts"])).toEqual(
      certificationManifest.map((group) => group.id),
    );
    expect(filesForAffectedGroups(["tenant-security"])).toEqual(
      certificationManifest.find((group) => group.id === "tenant-security")!.files,
    );
    expect(selectAffectedGroupIds(["src/pursuit/store.ts"])).toEqual(["pursuit"]);
    expect(selectAffectedGroupIds(["docs/ARCHITECTURE.md"])).toEqual([]);
    expect(selectAffectedGroupIds(["tests/TEST_INVENTORY.md"])).toEqual(["boundary-journeys"]);
    expect(filesForAffectedGroups(selectAffectedGroupIds(["tests/TEST_INVENTORY.md"]))).toContain(
      "tests/certification/test-inventory-audit.test.ts",
    );
  });

  function runStages(stages: Stage[], authoritative = true, summaryPath = "") {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import { runCertification } from './scripts/certify.ts'; runCertification(${JSON.stringify(stages)},${authoritative});`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
      },
    );
    return { status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") };
  }
  it("4. collects multiple failures and still runs later independent diagnostics before failing", () => {
    const result = runStages([
      { name: "First failure", command: 'node -e "process.exit(2)"', description: "fixture" },
      {
        name: "Later independent check",
        command: "node -e \"console.log('LATER_CHECK_EXECUTED')\"",
        description: "fixture",
      },
      { name: "Second failure", command: 'node -e "process.exit(3)"', description: "fixture" },
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("LATER_CHECK_EXECUTED");
    expect(result.output).toContain("Failed Stage: First failure");
    expect(result.output).toContain("Failed Stage: Second failure");
    expect(result.output).toContain("CERTIFICATION FAIL");
    expect(result.output).not.toContain("CERTIFICATION PASS");
  });
  it("4a. skips manifest-dependent reports after manifest failure without suppressing independent checks", () => {
    const result = runStages([
      {
        name: "Manifest",
        command: 'node -e "process.exit(2)"',
        description: "fixture",
        execution: "manifest",
      },
      {
        name: "Dependent group",
        command: "Never execute",
        description: "fixture",
        execution: "reported-by-manifest",
      },
      {
        name: "Independent",
        command: "node -e \"console.log('INDEPENDENT_EXECUTED')\"",
        description: "fixture",
      },
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Skipped Dependent group");
    expect(result.output).toContain("INDEPENDENT_EXECUTED");
    expect(result.output).not.toContain("Dependent group passed");
  });
  it("4b. keeps PR feedback separate from authoritative build and release certification", () => {
    expect(FEEDBACK_STAGES.map((stage) => stage.command)).toEqual([
      "npm run lint",
      "npm run format:check",
      "npx tsc -p tsconfig.verify.json --noEmit",
      "npm run certify:affected",
    ]);
    const result = runStages(
      [{ name: "Feedback", command: 'node -e "process.exit(0)"', description: "fixture" }],
      false,
    );
    expect(result.status).toBe(0);
    expect(result.output).toContain("FEEDBACK PASS");
    expect(result.output).not.toContain("CERTIFICATION PASS");
  });
  it("4c. emits one failure summary containing all check outcomes", () => {
    const directory = fs.mkdtempSync(path.join(tmpdir(), "radar-check-summary-"));
    const summaryPath = path.join(directory, "summary.md");
    try {
      const result = runStages(
        [
          { name: "Lint", command: 'node -e "process.exit(2)"', description: "fixture" },
          { name: "Types", command: 'node -e "process.exit(0)"', description: "fixture" },
        ],
        false,
        summaryPath,
      );
      expect(result.status).toBe(1);
      const summary = fs.readFileSync(summaryPath, "utf8");
      expect(summary).toContain("FEEDBACK: FAIL");
      expect(summary).toContain("| Lint | failed |");
      expect(summary).toContain("| Types | passed |");
      expect(summary).toContain("no release artifact");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("5. asserts every current boundary-journey suite exists on disk", () => {
    const boundary = certificationManifest.find((group) => group.id === "boundary-journeys");
    expect(boundary).toBeDefined();
    for (const file of boundary!.files) {
      expect(fs.existsSync(path.resolve(process.cwd(), file)), file).toBe(true);
    }
  });

  it("6. asserts certification criteria does not hardcode volatile live dataset row counts", () => {
    const boundary = certificationManifest.find((group) => group.id === "boundary-journeys");
    expect(boundary).toBeDefined();
    for (const file of boundary!.files) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
      expect(source).not.toMatch(/expect\(rows\.length\)\.toBe\(\d{3,}\)/);
    }
  });
});
