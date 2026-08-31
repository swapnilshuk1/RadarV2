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

describe("Certification Gate Integrity & Anti-Regression Contract", () => {
  const certifyScriptPath = path.resolve(process.cwd(), "scripts/certify.ts");
  const certifyScriptContent = fs.readFileSync(certifyScriptPath, "utf-8");

  it("1. asserts all 7 mandatory certification stages are registered in strict deterministic order", () => {
    expect(STAGES).toHaveLength(7);

    const expectedStageKeywords = [
      { name: "TypeScript", cmd: "tsc --noEmit" },
      { name: "Four Boundary Journeys", cmd: "tests/certification/" },
      { name: "Ingestion & Lineage", cmd: "canonical-ingestion-fk-regression" },
      { name: "Multi-Tenant & Scope Security", cmd: "scope-resolver-equivalence" },
      { name: "Serving Store & Keyset", cmd: "tests/serving/" },
      { name: "Editorial Governance", cmd: "tests/editorial/" },
      { name: "Production SSR Bundle Build", cmd: "npm run build" },
    ];

    expectedStageKeywords.forEach((expected, index) => {
      expect(STAGES[index].name).toContain(expected.name);
      expect(STAGES[index].command).toContain(expected.cmd);
    });
  });

  it("2. asserts critical bug-prevention suites are explicitly enumerated in stage commands", () => {
    const stage3 = STAGES.find((s) => s.command.includes("canonical-ingestion-fk-regression"));
    expect(stage3).toBeDefined();
    expect(stage3!.command).toContain("canonical-ingestion-fk-regression.test.ts");
    expect(stage3!.command).toContain("canonical-acquisition-integrity.test.ts");
    expect(stage3!.command).toContain("canonical-identity.test.ts");
    expect(stage3!.command).toContain("semantic-evidence-integrity-regression.test.ts");
    expect(stage3!.command).toContain("metrics-portal-breakdown.test.ts");

    const stage4 = STAGES.find((s) => s.command.includes("scope-resolver-equivalence"));
    expect(stage4).toBeDefined();
    expect(stage4!.command).toContain("scope-resolver-equivalence.test.ts");
    expect(stage4!.command).toContain("tenant-ontology-compiler.test.ts");
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

  it("4. asserts failing subprocess terminates certification gate with non-zero exit code", () => {
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
