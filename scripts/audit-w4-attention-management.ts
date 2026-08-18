import * as fs from "fs";
import * as path from "path";

console.log("=== W4 STATIC AUTHORITY & PRESENTATION-STATE ISOLATION AUDITOR ===");

const filesToAudit = [
  "src/routes/index.tsx",
  "src/routes/profile.tsx",
  "src/lib/attention-store.ts",
  "src/lib/intelligence/preferences-server.ts",
];

let violations = 0;

filesToAudit.forEach((relPath) => {
  const fullPath = path.resolve(process.cwd(), relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ [W4 Audit] File missing: ${relPath}`);
    violations++;
    return;
  }

  const content = fs.readFileSync(fullPath, "utf-8");

  // Violation Check 1: Engine re-scoring or decision mutation
  if (content.includes("DecisionPolicyEngine") || content.includes("evaluateOpportunity")) {
    console.error(`❌ [W4 Audit] ${relPath} attempts engine re-scoring or verdict recalculation.`);
    violations++;
  }

  // Violation Check 2: Cursor or presentation state written into userDecision
  if (content.includes("userDecision.activeWindow") || content.includes("userDecision.cursorIndex")) {
    console.error(`❌ [W4 Audit] ${relPath} leaks presentation state into userDecision!`);
    violations++;
  }

  // Violation Check 3: Altering career intent semantics
  if (content.includes("careerIntent.attentionWindow")) {
    console.error(`❌ [W4 Audit] ${relPath} attaches attentionWindow directly to careerIntent! Use candidate_state instead.`);
    violations++;
  }
});

if (violations === 0) {
  console.log("✅ [W4 Audit] ALL 4 PRESENTATION & AUTHORITY AUDITS PASSED WITH ZERO VIOLATIONS!");
  process.exit(0);
} else {
  console.error(`❌ [W4 Audit] AUDIT FAILED WITH ${violations} VIOLATION(S).`);
  process.exit(1);
}
