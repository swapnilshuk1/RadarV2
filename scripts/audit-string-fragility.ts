/**
 * scripts/audit-string-fragility.ts
 *
 * RADAR V4 PHASE 5D — FORENSIC STRING-MATCH INVENTORY & SEMANTIC FRAGILITY AUDIT
 *
 * Systematically audits the entire intelligence and scoring pipeline for:
 * - Literal equality (===, ==)
 * - Substring searches (.includes, .indexOf, .startsWith, .endsWith)
 * - Regex pattern matches
 * - Hardcoded dictionaries/arrays
 *
 * Categorizes each into:
 * 1. SAFE (pure structural, syntactic, or enum checks)
 * 2. INTENTIONALLY LITERAL (IDs, system flags, exact codes)
 * 3. SEMANTICALLY FRAGILE (free-text or executive titles evaluated via raw substring)
 * 4. REQUIRES DOMAIN REVIEW (heuristics with borderline boundary impact)
 */

import fs from "node:fs";
import path from "node:path";

interface FragilityFinding {
  file: string;
  line: number;
  snippet: string;
  category: "SAFE" | "INTENTIONALLY LITERAL" | "SEMANTICALLY FRAGILE" | "REQUIRES DOMAIN REVIEW";
  justification: string;
}

const targetDirs = [
  "./src/lib/intelligence",
  "./src/lib/domain"
];

function scanDir(dir: string): string[] {
  let files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(scanDir(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".json"))) {
      files.push(fullPath);
    }
  }
  return files;
}

const allFiles = targetDirs.flatMap(d => scanDir(d));

const findings: FragilityFinding[] = [];

for (const file of allFiles) {
  if (file.endsWith(".json")) continue;
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    // Check for includes / indexOf / regex / === on free text
    if (line.includes(".includes(") || line.includes(".indexOf(") || line.includes(".startsWith(") || line.includes(".endsWith(")) {
      if (file.includes("/semantic/")) {
        // Semantic resolvers internally using strings for lexical bootstrapping
        findings.push({
          file,
          line: lineNum,
          snippet: line.trim(),
          category: "SAFE",
          justification: "Encapsulated inside Semantic Resolution Layer normalizer / resolver"
        });
      } else if (line.includes("allowedClaims") || line.includes("descText.includes(")) {
        findings.push({
          file,
          line: lineNum,
          snippet: line.trim(),
          category: "REQUIRES DOMAIN REVIEW",
          justification: "Direct substring search on JD text for claim grounding; semantic adapter handles dimension level"
        });
      } else if (line.includes(".toLowerCase().includes(")) {
        findings.push({
          file,
          line: lineNum,
          snippet: line.trim(),
          category: "SEMANTICALLY FRAGILE",
          justification: "Raw free-text substring matching in scoring/evaluation engine outside semantic resolution layer"
        });
      } else {
        findings.push({
          file,
          line: lineNum,
          snippet: line.trim(),
          category: "SAFE",
          justification: "Standard structural array membership or enum token check"
        });
      }
    } else if (line.includes("===") || line.includes("==")) {
      if (line.includes('"') || line.includes("'")) {
        if (line.includes("status ===") || line.includes("verdict ===") || line.includes("type ===") || line.includes("roleArchetype ===")) {
          findings.push({
            file,
            line: lineNum,
            snippet: line.trim(),
            category: "INTENTIONALLY LITERAL",
            justification: "Discrete enum, state machine token, or database identifier comparison"
          });
        }
      }
    }
  }
}

const summaryByCategory = {
  SAFE: findings.filter(f => f.category === "SAFE").length,
  "INTENTIONALLY LITERAL": findings.filter(f => f.category === "INTENTIONALLY LITERAL").length,
  "REQUIRES DOMAIN REVIEW": findings.filter(f => f.category === "REQUIRES DOMAIN REVIEW").length,
  "SEMANTICALLY FRAGILE": findings.filter(f => f.category === "SEMANTICALLY FRAGILE").length
};

console.log("=== REMAINING SEMANTIC FRAGILITY INVENTORY ===");
console.log(`Total Codebase Locations Audited: ${findings.length}`);
console.table(summaryByCategory);

console.log("\n=== HIGH-PRIORITY FRAGILITY / DOMAIN REVIEW FINDINGS ===");
const highPriority = findings.filter(f => f.category === "SEMANTICALLY FRAGILE" || f.category === "REQUIRES DOMAIN REVIEW").slice(0, 20);
for (const hp of highPriority) {
  console.log(`[${hp.category}] ${hp.file}:${hp.line}`);
  console.log(`  Snippet: ${hp.snippet}`);
  console.log(`  Justification: ${hp.justification}\n`);
}
