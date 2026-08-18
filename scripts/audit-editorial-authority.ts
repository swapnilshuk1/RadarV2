import fs from "node:fs";
import path from "node:path";

interface AuditViolation {
  file: string;
  line: number;
  snippet: string;
  rule: string;
  description: string;
}

const SRC_DIR = path.resolve(process.cwd(), "src");

/** Forbidden pattern rules */
const FORBIDDEN_RULES: Array<{
  id: string;
  description: string;
  pattern: RegExp;
  allowedFiles?: string[];
}> = [
  {
    id: "SCORE_TO_VERDICT_DERIVATION",
    description: "Deriving editorial verdict or recommendation from raw scores or score thresholds",
    pattern: /(?:qualityScore|capabilityScore|identityScore|rawScore|score)\s*(?:>=|>|<=|<)\s*\d+.*\?\s*["'](?:PURSUE|CONSIDER|PASS)/i,
  },
  {
    id: "USER_DECISION_EDITORIAL_OVERRIDE",
    description: "Using user decision to set authoritative editorial verdict or thesis",
    pattern: /editorialContext\.engineVerdict\s*=\s*.*userDecision/i,
  },
  {
    id: "OPPORTUNITY_DECISION_AS_EDITORIAL_AUTHORITY",
    description: "Using opportunity.decision (which incorporates user choice) as authoritative engine verdict",
    pattern: /engineVerdict\s*=\s*.*opportunity\.decision\b/i,
    allowedFiles: ["decisions-store.ts"], // client state hooks only
  },
  {
    id: "SCORE_DERIVED_CAREER_CLASSIFICATION",
    description: "Independently deriving career value classifications (HIGH/LIMITED UPSIDE/REGRESSION) from numeric thresholds inside Editorial/UI",
    pattern: /careerRegressionScore\s*(?:>=|>|<=|<)\s*\d+.*\?\s*["'](?:DOWNSCALED|REGRESSION|LIMITED)/i,
  },
  {
    id: "UI_VERDICT_INFERENCE_FROM_SCORE",
    description: "UI component inferring decision meaning or gate flags from score thresholds",
    pattern: /brief\.qualityScore\s*(?:>=|>|<=|<)\s*\d+.*dossierState\.engineVerdict/i,
  },
];

function getAllTsFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllTsFiles(filePath));
    } else if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      results.push(filePath);
    }
  }
  return results;
}

export function runEditorialAuthorityAudit(): { violations: AuditViolation[]; passed: boolean } {
  const violations: AuditViolation[] = [];
  const files = getAllTsFiles(SRC_DIR);

  for (const filePath of files) {
    const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
    
    // Ignore test files and non-editorial/UI files if needed
    if (relativePath.includes("node_modules") || relativePath.includes(".test.")) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const rule of FORBIDDEN_RULES) {
        if (rule.allowedFiles && rule.allowedFiles.some((f) => relativePath.endsWith(f))) {
          continue;
        }

        if (rule.pattern.test(line)) {
          violations.push({
            file: relativePath,
            line: i + 1,
            snippet: line.trim(),
            rule: rule.id,
            description: rule.description,
          });
        }
      }
    }
  }

  return {
    violations,
    passed: violations.length === 0,
  };
}

if (process.argv[1]?.includes("audit-editorial-authority")) {
  console.log("=================================================");
  console.log("RADAR V4 — Static Editorial Authority Auditor");
  console.log("=================================================");

  const { violations, passed } = runEditorialAuthorityAudit();

  if (violations.length > 0) {
    console.error(`❌ Audit FAILED: ${violations.length} forbidden editorial authority violation(s) found:\n`);
    violations.forEach((v, idx) => {
      console.error(`${idx + 1}. [${v.rule}] ${v.file}:${v.line}`);
      console.error(`   Snippet: ${v.snippet}`);
      console.error(`   Description: ${v.description}\n`);
    });
    process.exit(1);
  } else {
    console.log("✅ Audit PASSED: 0 forbidden editorial authority violations found across src/.");
    process.exit(0);
  }
}
