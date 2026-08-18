import * as fs from "fs";
import * as path from "path";

interface Violation {
  file: string;
  line: number;
  type: string;
  description: string;
  snippet: string;
}

function scanFile(filePath: string): Violation[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations: Violation[] = [];
  const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Rule 1: Zero score-derived effort strategies
    if (
      (relPath.startsWith("src/lib/intelligence/editorial/") || relPath.startsWith("src/components/")) &&
      /qualityScore\s*>=/i.test(line) &&
      /DEEP|TARGETED|LIGHT|INVESTIGATE_FIRST|DO_NOT_INVEST/.test(line)
    ) {
      violations.push({
        file: relPath,
        line: lineNum,
        type: "SCORE_DERIVED_EFFORT_STRATEGY",
        description: "Raw qualityScore threshold used to derive effort strategy",
        snippet: line.trim(),
      });
    }

    // Rule 2: Zero user-decision overrides of pursuit strategy
    if (
      relPath.startsWith("src/lib/intelligence/editorial/") &&
      /userDecision/i.test(line) &&
      /effortLevel|pursuitMode|tailoringDepth\s*=/i.test(line)
    ) {
      violations.push({
        file: relPath,
        line: lineNum,
        type: "USER_DECISION_STRATEGY_OVERRIDE",
        description: "User decision attempting to override authoritative pursuit strategy",
        snippet: line.trim(),
      });
    }

    // Rule 3: Zero raw capability score derived effort level
    if (
      relPath.endsWith("PursuitStrategyResolver.ts") &&
      /overallFit|capabilityScore|rawScore/i.test(line) &&
      /if\s*\(/i.test(line) &&
      />=|<=|>|</.test(line)
    ) {
      violations.push({
        file: relPath,
        line: lineNum,
        type: "RAW_CAPABILITY_EFFORT_OVERRIDE",
        description: "PursuitStrategyResolver evaluating raw score thresholds directly",
        snippet: line.trim(),
      });
    }
  });

  return violations;
}

function scanDir(dirPath: string): string[] {
  let files: string[] = [];
  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      if (item.name !== "node_modules" && item.name !== ".git") {
        files = files.concat(scanDir(fullPath));
      }
    } else if (item.isFile() && (item.name.endsWith(".ts") || item.name.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }

  return files;
}

export function runPursuitStrategyAuthorityAudit() {
  console.log("=== RADAR V4 Phase P1.3 Static AST Authority Audit ===");
  const srcDir = path.join(process.cwd(), "src");
  const files = scanDir(srcDir);
  let totalViolations: Violation[] = [];

  for (const file of files) {
    const v = scanFile(file);
    totalViolations = totalViolations.concat(v);
  }

  console.log(`Scanned ${files.length} source files.`);
  console.log(`Total Pursuit Strategy Authority Violations: ${totalViolations.length}`);

  const outputDir = path.join(process.cwd(), ".scraper-artifacts/v4-engine-simulation/latest");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const report = {
    timestamp: new Date().toISOString(),
    filesScanned: files.length,
    violationCount: totalViolations.length,
    violations: totalViolations,
  };

  fs.writeFileSync(
    path.join(outputDir, "pursuit-strategy-authority-audit.json"),
    JSON.stringify(report, null, 2)
  );

  if (totalViolations.length > 0) {
    console.error("❌ Pursuit Strategy Authority Audit FAILED with violations:");
    console.error(JSON.stringify(totalViolations, null, 2));
    return false;
  }

  console.log("✅ Pursuit Strategy Authority Audit PASSED: 0 violations.");
  return true;
}

if (process.argv[1] && process.argv[1].endsWith("audit-pursuit-strategy-authority.ts")) {
  const passed = runPursuitStrategyAuthorityAudit();
  if (!passed) {
    process.exit(1);
  }
}
