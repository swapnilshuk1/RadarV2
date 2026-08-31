import fs from "node:fs";
import path from "node:path";

const ledgerPath = path.resolve(process.cwd(), "scripts/historical_recovery_ledger.json");
const data = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));

console.log("=== FOURTH DIAGNOSTIC: 10-RECORD PILOT WRITE INTEGRITY AUDIT ===");

const entries = data.ledgerEntries;
console.log(`Auditing ${entries.length} pilot ledger records:\n`);

for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  const v1 = e.v1;
  const v2 = e.v2;
  const ev = e.evaluation;

  console.log(`[Record #${i + 1}] Canonical Job ID: ${e.canonicalJobId} (${v1.jobTitle} - ${v1.companyName})`);
  console.log(`  - v1 ID:                 ${v1.opportunityVersionId}`);
  console.log(`  - v2 ID:                 ${v2?.opportunityVersionId || "N/A"}`);
  console.log(`  - parentVersionId:       ${v2?.parentVersionId || "N/A"}`);
  console.log(`  - parentVersion matches: ${v2?.parentVersionId === v1.opportunityVersionId ? "YES (Verified)" : "NO (DEFECT)"}`);
  console.log(`  - v1 Acq State:          status=${v1.acquisitionStatus}, quality=${v1.acquisitionQuality}`);
  console.log(`  - v2 Acq State:          status=${v2?.acquisitionStatus}, quality=${v2?.acquisitionQuality}, evidence=${v2?.evidenceState}`);
  console.log(`  - v1 Eval State:         ${v1.evaluationState} (decision=${v1.decision}, score=${v1.qualityScore})`);
  console.log(`  - v2 Eval State:         ${ev?.afterEvaluationState} (decision=${ev?.afterDecision}, score=${ev?.afterScore})`);
  console.log(`  - v1 Eval Identity:      ${v1.evaluationIdentity}`);
  console.log(`  - v2 Eval Identity:      ${ev?.afterEvaluationIdentity}`);
  console.log(`  - Evaluation Reused:     ${v1.evaluationIdentity === ev?.afterEvaluationIdentity ? "YES (DEFECT)" : "NO (Isolated)"}`);
  console.log(`  - Reacquisition Outcome: ${e.reacquisition.outcome} (${e.reacquisition.failureReason || "OK"})`);
  console.log(`  - Writes Performed:      ${e.writesPerformed}`);
  console.log("");
}
