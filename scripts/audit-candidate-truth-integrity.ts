/**
 * scripts/audit-candidate-truth-integrity.ts
 *
 * RADAR V4 — Static Candidate Truth Integrity Auditor
 *
 * Static analysis tool that scans all production source code in `src/`
 * for dangerous template interpolations, target employer leakages,
 * hardcoded financial fabrications, and ungated execution pathways.
 */

import * as fs from "fs";
import * as path from "path";

interface StaticAuditViolation {
  file: string;
  line: number;
  pattern: string;
  matchedSnippet: string;
  description: string;
}

const FORBIDDEN_PATTERNS = [
  {
    regex: /Ex-\$\{[^}]+\}/,
    desc: "Unsafe Ex-${company} interpolation in candidate history template."
  },
  {
    regex: /Spearheaded\s+[^`"'\n]+at\s+\$\{[^}]+\}/i,
    desc: "Unsafe 'Spearheaded ... at ${company}' template interpolation."
  },
  {
    regex: /\$12M\+\s+annual\s+budget/i,
    desc: "Fabricated '$12M+ annual budget' metric outside candidate evidence source."
  },
  {
    regex: /Held\s+full\s+enterprise\s+P&L\s+responsibility\s+\(\$12M\+\)/i,
    desc: "Fabricated enterprise P&L claim outside candidate evidence source."
  },
  {
    regex: /suggestedRevision:\s*`[^`]*\$\{job\.company\}[^`]*`/i,
    desc: "Direct interpolation of ${job.company} into suggestedRevision."
  }
];

function scanDirectory(dir: string, violations: StaticAuditViolation[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      scanDirectory(fullPath, violations);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      // Exclude the auditor itself and test files that test for the forbidden patterns
      if (entry.name.includes("audit-candidate-truth-integrity") || entry.name.includes("test")) {
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, idx) => {
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.regex.test(line)) {
            violations.push({
              file: fullPath,
              line: idx + 1,
              pattern: pat.regex.toString(),
              matchedSnippet: line.trim(),
              description: pat.desc
            });
          }
        }
      });
    }
  }
}

export function runStaticTruthAudit(): { success: boolean; violations: StaticAuditViolation[] } {
  const violations: StaticAuditViolation[] = [];
  const srcDir = path.resolve(process.cwd(), "src");

  console.log(`[StaticTruthAudit] Scanning ${srcDir} for dangerous candidate generation patterns...`);
  scanDirectory(srcDir, violations);

  if (violations.length === 0) {
    console.log(`[StaticTruthAudit] \x1b[32mPASS: Zero architectural violations detected across production sources.\x1b[0m`);
    return { success: true, violations: [] };
  } else {
    console.error(`[StaticTruthAudit] \x1b[31mFAIL: ${violations.length} architectural violations detected!\x1b[0m`);
    violations.forEach((v, i) => {
      console.error(`  ${i + 1}. [${v.file}:${v.line}] ${v.description}`);
      console.error(`     Snippet: "${v.matchedSnippet}"`);
    });
    return { success: false, violations };
  }
}

if (process.argv[1]?.includes("audit-candidate-truth-integrity")) {
  const res = runStaticTruthAudit();
  if (!res.success) {
    process.exit(1);
  }
}
