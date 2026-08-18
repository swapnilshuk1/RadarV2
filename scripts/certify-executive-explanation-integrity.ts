import * as fs from "fs";
import * as path from "path";
import { runExplanationAudit } from "./eval/run-v4-executive-explanation-audit";

async function certify() {
  console.log("=== RADAR V4 Phase P1.2 Mechanical Certification Harness ===");

  // 1. Run corpus evaluation
  await runExplanationAudit();

  const metricsPath = path.join(
    process.cwd(),
    ".scraper-artifacts/v4-engine-simulation/latest/executive-explanation-quality-metrics.json"
  );

  if (!fs.existsSync(metricsPath)) {
    console.error("❌ Quality metrics file not found. Certification FAILED.");
    process.exit(1);
  }

  const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
  const gates = metrics.hardGates;

  const hardPass =
    gates.engineVerdictMismatch === 0 &&
    gates.careerValueSignalLoss === 0 &&
    gates.careerRegressionSuppressed === 0 &&
    gates.userDecisionEditorialOverride === 0 &&
    gates.scoreDerivedEditorialVerdict === 0 &&
    gates.surfaceVerdictDivergence === 0 &&
    gates.fabricatedCareerSignals === 0 &&
    gates.explanationProvenanceLoss === 0 &&
    gates.contradictoryExplanation === 0;

  const certStatus = hardPass ? "PASS" : "FAIL";

  const certContent = `# RADAR V4 Phase P1.2 Certification Report
**Status**: ${certStatus}  
**Timestamp**: ${new Date().toISOString()}  

## Executive Decision Explanation Quality, Rationale Hierarchy & Actionability

### Hard Integrity Gates
| Gate | Violations | Result |
| :--- | :---: | :---: |
| \`engineVerdictMismatch\` | ${gates.engineVerdictMismatch} | ${gates.engineVerdictMismatch === 0 ? "PASS" : "FAIL"} |
| \`careerValueSignalLoss\` | ${gates.careerValueSignalLoss} | ${gates.careerValueSignalLoss === 0 ? "PASS" : "FAIL"} |
| \`careerRegressionSuppressed\` | ${gates.careerRegressionSuppressed} | ${gates.careerRegressionSuppressed === 0 ? "PASS" : "FAIL"} |
| \`userDecisionEditorialOverride\` | ${gates.userDecisionEditorialOverride} | ${gates.userDecisionEditorialOverride === 0 ? "PASS" : "FAIL"} |
| \`scoreDerivedEditorialVerdict\` | ${gates.scoreDerivedEditorialVerdict} | ${gates.scoreDerivedEditorialVerdict === 0 ? "PASS" : "FAIL"} |
| \`surfaceVerdictDivergence\` | ${gates.surfaceVerdictDivergence} | ${gates.surfaceVerdictDivergence === 0 ? "PASS" : "FAIL"} |
| \`fabricatedCareerSignals\` | ${gates.fabricatedCareerSignals} | ${gates.fabricatedCareerSignals === 0 ? "PASS" : "FAIL"} |
| \`explanationProvenanceLoss\` | ${gates.explanationProvenanceLoss} | ${gates.explanationProvenanceLoss === 0 ? "PASS" : "FAIL"} |
| \`contradictoryExplanation\` | ${gates.contradictoryExplanation} | ${gates.contradictoryExplanation === 0 ? "PASS" : "FAIL"} |

### Verification Summary
- **Primary Reason Coverage**: ${metrics.primaryReasonCoverage}%
- **Career Value Signal Coverage**: ${metrics.careerValueSignalCoverage}%
- **Provenance Coverage**: ${metrics.provenanceCoverage}%
- **Recommended Action Coverage**: ${metrics.recommendedActionCoverage}%
- **Surface Convergence Rate**: ${metrics.surfaceConvergenceRate}%

${hardPass ? "✅ RADAR V4 Phase P1.2 is CERTIFIED. All 9 hard gates = 0." : "❌ Phase P1.2 Certification FAILED."}
`;

  const outputDir = path.join(process.cwd(), ".scraper-artifacts/v4-engine-simulation/latest");
  fs.writeFileSync(path.join(outputDir, "phase-p1.2-certification.md"), certContent);

  console.log("\n" + certContent);

  if (!hardPass) {
    process.exit(1);
  }
}

certify().catch((err) => {
  console.error("Certification error:", err);
  process.exit(1);
});
