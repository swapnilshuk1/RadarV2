import { execSync } from "child_process";
import fs from "fs";

const migrateFiles = [
  "tests/architecture-contracts-strong.test.ts",
  "tests/canonical-identity.test.ts",
  "tests/deployment-determinism.test.ts",
  "tests/evaluation-coordinator-events.test.ts",
  "tests/model_c_quality.test.ts",
  "tests/normalizeScrapedText.test.ts",
  "tests/policy_d_boundary.test.ts",
  "tests/recommendation-golden.test.ts",
  "tests/regression-defects.test.ts",
  "tests/runtime-persistence-source.test.ts",
  "tests/scrape-progress-persistence.test.ts"
];

for (const file of migrateFiles) {
  console.log(`\n================== ${file} ==================`);
  try {
    const out = execSync(`npx vitest run "${file}" --no-color`, { encoding: "utf8" });
    console.log("PASS!");
  } catch (err: any) {
    const errOut = (err.stdout || "") + "\n" + (err.stderr || "");
    const failLines = errOut.split("\n").filter((l: string) => l.includes("FAIL") || l.includes("AssertionError") || l.includes("Error:"));
    console.log(failLines.slice(0, 10).join("\n"));
  }
}
