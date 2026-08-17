import * as fs from "fs";
import * as path from "path";
import { runPursuitStrategyAudit } from "./eval/run-v4-pursuit-strategy-audit";

async function certify() {
  console.log("=== RADAR V4 Phase P1.3 Mechanical Certification Harness ===");

  // 1. Run corpus evaluation
  await runPursuitStrategyAudit();

  const metricsPath = path.join(
    process.cwd(),
    ".scraper-artifacts/v4-engine-simulation/latest/pursuit-strategy-quality-metrics.json"
  );

  if (!fs.existsSync(metricsPath)) {
    console.error("❌ Quality metrics file not found. Certification FAILED.");
    process.exit(1);
  }

  const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
  const gates = metrics.hardGates;

  const hardPass =
    gates.engineVerdictMutation === 0 &&
    gates.userDecisionStrategyOverride === 0 &&
    gates.scoreDerivedEffortStrategy === 0 &&
    gates.scoreDerivedRecommendedAction === 0 &&
    gates.careerRegressionSuppressed === 0 &&
    gates.explanationStrategyContradiction === 0 &&
    gates.strategySurfaceDivergence === 0 &&
    gates.provenanceLoss === 0 &&
    gates.candidateTruthViolation === 0 &&
    gates.nonDeterministicStrategy === 0 &&
    gates.precedenceViolation === 0 &&
    gates.careerRegressionEffortContradiction === 0 &&
    gates.sparseSpecificationEffortContradiction === 0 &&
    gates.strategyActionContradiction === 0 &&
    gates.strategyEnumSurfaceLeakage === 0;

  const certStatus = hardPass ? "PASS" : "FAIL";

  const certContent = `# RADAR V4 Phase P1.3 Certification Report
**Status**: ${certStatus}  
**Timestamp**: ${new Date().toISOString()}  

## Pursuit Strategy, Effort Allocation & Actionability

### Hard Integrity Gates (15 Zero-Tolerance Hard Gates)
| Gate | Violations | Result |
| :--- | :---: | :---: |
| \`engineVerdictMutation\` | ${gates.engineVerdictMutation} | ${gates.engineVerdictMutation === 0 ? "PASS" : "FAIL"} |
| \`userDecisionStrategyOverride\` | ${gates.userDecisionStrategyOverride} | ${gates.userDecisionStrategyOverride === 0 ? "PASS" : "FAIL"} |
| \`scoreDerivedEffortStrategy\` | ${gates.scoreDerivedEffortStrategy} | ${gates.scoreDerivedEffortStrategy === 0 ? "PASS" : "FAIL"} |
| \`scoreDerivedRecommendedAction\` | ${gates.scoreDerivedRecommendedAction} | ${gates.scoreDerivedRecommendedAction === 0 ? "PASS" : "FAIL"} |
| \`careerRegressionSuppressed\` | ${gates.careerRegressionSuppressed} | ${gates.careerRegressionSuppressed === 0 ? "PASS" : "FAIL"} |
| \`explanationStrategyContradiction\` | ${gates.explanationStrategyContradiction} | ${gates.explanationStrategyContradiction === 0 ? "PASS" : "FAIL"} |
| \`strategySurfaceDivergence\` | ${gates.strategySurfaceDivergence} | ${gates.strategySurfaceDivergence === 0 ? "PASS" : "FAIL"} |
| \`provenanceLoss\` | ${gates.provenanceLoss} | ${gates.provenanceLoss === 0 ? "PASS" : "FAIL"} |
| \`candidateTruthViolation\` | ${gates.candidateTruthViolation} | ${gates.candidateTruthViolation === 0 ? "PASS" : "FAIL"} |
| \`nonDeterministicStrategy\` | ${gates.nonDeterministicStrategy} | ${gates.nonDeterministicStrategy === 0 ? "PASS" : "FAIL"} |
| \`precedenceViolation\` | ${gates.precedenceViolation} | ${gates.precedenceViolation === 0 ? "PASS" : "FAIL"} |
| \`careerRegressionEffortContradiction\` | ${gates.careerRegressionEffortContradiction} | ${gates.careerRegressionEffortContradiction === 0 ? "PASS" : "FAIL"} |
| \`sparseSpecificationEffortContradiction\` | ${gates.sparseSpecificationEffortContradiction} | ${gates.sparseSpecificationEffortContradiction === 0 ? "PASS" : "FAIL"} |
| \`strategyActionContradiction\` | ${gates.strategyActionContradiction} | ${gates.strategyActionContradiction === 0 ? "PASS" : "FAIL"} |
| \`strategyEnumSurfaceLeakage\` | ${gates.strategyEnumSurfaceLeakage} | ${gates.strategyEnumSurfaceLeakage === 0 ? "PASS" : "FAIL"} |

### Strategy Distributions (125 Replay Opportunities)
- **Effort Levels**:
${Object.entries(metrics.distributions.effortLevel)
  .map(([k, v]) => `  - \`${k}\`: ${v}`)
  .join("\n")}
- **Pursuit Modes**:
${Object.entries(metrics.distributions.pursuitMode)
  .map(([k, v]) => `  - \`${k}\`: ${v}`)
  .join("\n")}
- **Tailoring Depths**:
${Object.entries(metrics.distributions.tailoringDepth)
  .map(([k, v]) => `  - \`${k}\`: ${v}`)
  .join("\n")}
- **Rules Applied**:
${Object.entries(metrics.distributions.ruleId)
  .map(([k, v]) => `  - \`${k}\`: ${v}`)
  .join("\n")}

${hardPass ? "✅ RADAR V4 Phase P1.3 is CERTIFIED. All 15 hard gates = 0." : "❌ Phase P1.3 Certification FAILED."}
`;

  const outputDir = path.join(process.cwd(), ".scraper-artifacts/v4-engine-simulation/latest");
  fs.writeFileSync(path.join(outputDir, "pursuit-strategy-certification.md"), certContent);

  console.log("\n" + certContent);

  if (!hardPass) {
    process.exit(1);
  }
}

certify().catch((err) => {
  console.error("Certification error:", err);
  process.exit(1);
});
