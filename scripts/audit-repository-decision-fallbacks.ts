import fs from "fs";
import path from "path";

export interface AuditFinding {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  patternMatched: string;
  classification: "ENGINE_AUTHORITATIVE" | "USER_DECISION" | "DERIVED" | "FALLBACK" | "UNKNOWN";
  recommendation: string;
}

const FORBIDDEN_PATTERNS = [
  { pattern: /\|\|\s*o\.decision/g, name: "Fallback to o.decision" },
  { pattern: /decisions\[[^\]]+\]\?\.verb\s*\|\|/g, name: "Collapse user decision with engine verdict" },
  { pattern: /recommendationResult\?\.decision/g, name: "Fallback to recommendationResult.decision" },
  { pattern: /\?\?\s*["']CONSIDER["']/g, name: "Hardcoded CONSIDER default" },
  { pattern: /\?\?\s*["']PURSUE["']/g, name: "Hardcoded PURSUE default" },
  { pattern: /\?\?\s*["']PASS["']/g, name: "Hardcoded PASS default" },
];

function scanDirectory(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      scanDirectory(filePath, fileList);
    } else if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

export function runDecisionFallbackAudit(): { findings: AuditFinding[]; totalFilesScanned: number; clean: boolean } {
  const srcDir = path.resolve(process.cwd(), "src");
  const files = scanDirectory(srcDir);
  const findings: AuditFinding[] = [];

  for (const filePath of files) {
    const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const forbidden of FORBIDDEN_PATTERNS) {
        forbidden.pattern.lastIndex = 0;
        if (forbidden.pattern.test(line)) {
          findings.push({
            filePath: relPath,
            lineNumber: i + 1,
            lineContent: line.trim(),
            patternMatched: forbidden.name,
            classification: "FALLBACK",
            recommendation: "Refactor to use resolveDossierDecisionState or pure engineRecommendation.engineVerdict.",
          });
        }
      }
    }
  }

  const clean = findings.length === 0;
  return { findings, totalFilesScanned: files.length, clean };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").includes("audit-repository-decision-fallbacks")) {
  console.log("──────────────────────────────────────────────────");
  console.log("RADAR V4 — Repository Decision-Fallback Audit");
  console.log("──────────────────────────────────────────────────");
  const { findings, totalFilesScanned, clean } = runDecisionFallbackAudit();
  console.log(`Files Scanned : ${totalFilesScanned}`);
  console.log(`Audit Findings: ${findings.length}`);
  console.log(`Clean Status  : ${clean ? "PASS 🟢" : "FAIL 🔴"}`);
  console.log("──────────────────────────────────────────────────");

  if (!clean) {
    console.log("\nFORBIDDEN DECISION FALLBACK PATTERNS DETECTED:");
    for (const f of findings) {
      console.log(`\n[${f.classification}] ${f.filePath}:${f.lineNumber}`);
      console.log(`  Pattern: ${f.patternMatched}`);
      console.log(`  Code   : ${f.lineContent}`);
      console.log(`  Fix    : ${f.recommendation}`);
    }
    process.exit(1);
  } else {
    console.log("Zero forbidden decision fallbacks found in production tree.");
    process.exit(0);
  }
}
