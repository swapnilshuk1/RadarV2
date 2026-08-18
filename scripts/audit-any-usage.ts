import * as fs from "fs";
import * as path from "path";

// Authoritative domain path prefixes / files
const P0_AUTHORITATIVE_PATTERNS = [
  "src/lib/intelligence/policy/DecisionPolicyEngine.ts",
  "src/domain/decision_v4.ts",
  "src/lib/intelligence/record.ts",
  "src/lib/intelligence/present.ts",
  "src/lib/intelligence/editorial/EditorialContext.ts",
  "src/lib/intelligence/editorial/ExecutiveDecisionExplanation.ts",
  "src/lib/intelligence/editorial/PrimaryReasonResolver.ts",
  "src/lib/intelligence/editorial/PursuitStrategy.ts",
  "src/lib/intelligence/editorial/PursuitStrategyResolver.ts",
  "src/lib/intelligence/editorial/BriefCompositionEngine.ts",
  "src/lib/intelligence/ekb/CandidateEvidenceGraph.ts",
  "src/lib/intelligence/ekb/TruthPreservingRewriteEngine.ts",
  "src/lib/intelligence/ekb/ExecutionEvidenceGate.ts",
  "src/lib/intelligence/engine.ts",
];

interface AnyOccurrence {
  file: string;
  line: number;
  content: string;
  tier: "P0" | "P1" | "P2";
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function isP0File(normPath: string): boolean {
  return P0_AUTHORITATIVE_PATTERNS.some((pattern) => normPath.endsWith(pattern));
}

function isP2File(normPath: string): boolean {
  return normPath.startsWith("tests/") || normPath.startsWith("scripts/") || normPath.includes(".test.") || normPath.includes(".spec.");
}

function walkDir(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === "node_modules" || file === "dist" || file === ".git" || file === "build" || file === ".scraper-artifacts") {
      continue;
    }
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath, fileList);
    } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

export function auditAnyUsage() {
  const projectRoot = process.cwd();
  const allFiles = walkDir(projectRoot);

  const occurrences: AnyOccurrence[] = [];

  const anyRegex = /(?::\s*any\b|as\s+any\b|<any>|<any\[\]>|\bany\[\])/g;

  for (const absPath of allFiles) {
    const relPath = normalizePath(path.relative(projectRoot, absPath));
    const content = fs.readFileSync(absPath, "utf-8");
    const lines = content.split("\n");

    lines.forEach((lineText, idx) => {
      // Ignore comments
      const trimmed = lineText.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        return;
      }

      if (anyRegex.test(lineText)) {
        let tier: "P0" | "P1" | "P2" = "P1";
        if (isP0File(relPath)) {
          tier = "P0";
        } else if (isP2File(relPath)) {
          tier = "P2";
        }

        occurrences.push({
          file: relPath,
          line: idx + 1,
          content: trimmed,
          tier,
        });
      }
    });
  }

  const p0List = occurrences.filter((o) => o.tier === "P0");
  const p1List = occurrences.filter((o) => o.tier === "P1");
  const p2List = occurrences.filter((o) => o.tier === "P2");

  const p0Files = Array.from(new Set(p0List.map((o) => o.file)));
  const p1Files = Array.from(new Set(p1List.map((o) => o.file)));
  const p2Files = Array.from(new Set(p2List.map((o) => o.file)));

  const report = {
    timestamp: new Date().toISOString(),
    totalAnyOccurrences: occurrences.length,
    authoritativeDomainAny: p0List.length,
    p1Occurrences: p1List.length,
    p2Occurrences: p2List.length,
    p0Files,
    p1FilesCount: p1Files.length,
    p2FilesCount: p2Files.length,
    p0Details: p0List,
  };

  const outputDir = path.join(projectRoot, ".scraper-artifacts/v4-engine-simulation/latest");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, "type-safety-audit.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const mdPath = path.join(outputDir, "type-safety-audit.md");
  const mdContent = `# RADAR V4 Type-Safety Audit Report
**Timestamp**: ${report.timestamp}
**Authoritative Domain Any (P0)**: ${report.authoritativeDomainAny}
**Supporting Any (P1)**: ${report.p1Occurrences}
**Test/Script Any (P2)**: ${report.p2Occurrences}
**Total Any Occurrences**: ${report.totalAnyOccurrences}

## Hard Certification Invariant
\`AUTHORITATIVE_DOMAIN_ANY = ${report.authoritativeDomainAny}\` (${report.authoritativeDomainAny === 0 ? "✅ PASS" : "❌ FAIL"})

## P0 Details (Authoritative Domain Boundaries)
${
  p0List.length === 0
    ? "✅ Zero `any` usages in authoritative domain contracts."
    : p0List.map((o) => `- \`${o.file}:${o.line}\`: \`${o.content}\``).join("\n")
}
`;

  fs.writeFileSync(mdPath, mdContent);

  console.log(`Type Safety Audit Complete:
- Total: ${report.totalAnyOccurrences}
- P0 (Authoritative Domain): ${report.authoritativeDomainAny}
- P1 (Supporting Services): ${report.p1Occurrences}
- P2 (Tests & Scripts): ${report.p2Occurrences}
Saved report to ${mdPath}`);

  return report;
}

if (process.argv[1] && normalizePath(process.argv[1]).includes("audit-any-usage.ts")) {
  auditAnyUsage();
}
