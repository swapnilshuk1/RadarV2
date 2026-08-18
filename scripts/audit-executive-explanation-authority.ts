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

    // Rule 1: Zero score-derived verdicts in Editorial/UI
    if (
      (relPath.startsWith("src/lib/intelligence/editorial/") || relPath.startsWith("src/components/")) &&
      /qualityScore\s*>=/i.test(line) &&
      /PURSUE|CONSIDER|PASS/.test(line)
    ) {
      violations.push({
        file: relPath,
        line: lineNum,
        type: "SCORE_DERIVED_VERDICT",
        description: "Raw qualityScore threshold used to derive editorial verdict",
        snippet: line.trim(),
      });
    }

    // Rule 2: Zero user-decision overrides of engine verdict
    if (
      relPath.startsWith("src/lib/intelligence/editorial/") &&
      /userDecision/i.test(line) &&
      /engineVerdict\s*=/i.test(line)
    ) {
      violations.push({
        file: relPath,
        line: lineNum,
        type: "USER_DECISION_OVERRIDE",
        description: "User decision attempting to override authoritative engineVerdict",
        snippet: line.trim(),
      });
    }

    // Rule 3: No raw score derived editorial thesis
    if (
      relPath.endsWith("ExecutiveThesisBuilder.ts") &&
      /qualityScore/i.test(line) &&
      /if\s*\(/i.test(line)
    ) {
      violations.push({
        file: relPath,
        line: lineNum,
        type: "SCORE_DERIVED_THESIS",
        description: "ExecutiveThesisBuilder evaluating raw score thresholds",
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

function runAudit() {
  console.log("=== RADAR V4 Phase P1.2 Static AST Authority Audit ===");
  const srcDir = path.join(process.cwd(), "src");
  const files = scanDir(srcDir);
  let totalViolations: Violation[] = [];

  for (const file of files) {
    const v = scanFile(file);
    totalViolations = totalViolations.concat(v);
  }

  console.log(`Scanned ${files.length} source files.`);
  console.log(`Total Authority Violations: ${totalViolations.length}`);

  if (totalViolations.length > 0) {
    console.error("\nViolations Found:");
    totalViolations.forEach((v) => {
      console.error(`  [${v.type}] ${v.file}:${v.line} - ${v.description}`);
      console.error(`    Snippet: ${v.snippet}`);
    });
    process.exit(1);
  } else {
    console.log("\n✅ 0 Authority Violations Found. AST Authority Audit PASSED.");
    process.exit(0);
  }
}

runAudit();
