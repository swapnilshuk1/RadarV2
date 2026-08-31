import fs from "node:fs";
import path from "node:path";

const ledgerPath = path.resolve(process.cwd(), "scripts/historical_recovery_dryrun_ledger.json");
const data = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));

console.log("=== THIRD DIAGNOSTIC: 251 RECOVERY FAILURE CLUSTER ANALYSIS ===");

const entries = data.ledgerEntries;
const failedEntries = entries.filter((e: any) => e.reacquisition.outcome === "RECOVERY_FAILED");
console.log(`Total entries: ${entries.length}`);
console.log(`Failed entries: ${failedEntries.length}`);

// 1. Group by Portal
const byPortal: Record<string, number> = {};
for (const e of failedEntries) {
  const p = e.v1.source || "Unknown";
  byPortal[p] = (byPortal[p] || 0) + 1;
}
console.log("\n1. Failures by Portal:", byPortal);

// 2. Group by Failure Reason
const byReason: Record<string, number> = {};
for (const e of failedEntries) {
  const r = e.reacquisition.failureReason || "UNKNOWN";
  byReason[r] = (byReason[r] || 0) + 1;
}
console.log("\n2. Failures by Reason:", byReason);

// 3. Group by HTTP Status / Error Type
const byHttpStatus: Record<string, number> = {};
for (const e of failedEntries) {
  const status = e.reacquisition.atsProvenance?.httpStatus ?? "NO_HTTP_ATTEMPT";
  byHttpStatus[String(status)] = (byHttpStatus[String(status)] || 0) + 1;
}
console.log("\n3. Failures by HTTP Status:", byHttpStatus);

// 4. Group by Destination Host
const byHost: Record<string, number> = {};
for (const e of failedEntries) {
  const host = e.reacquisition.atsProvenance?.destinationHost || "unresolved";
  byHost[host] = (byHost[host] || 0) + 1;
}
console.log("\n4. Failures by Destination Host:", byHost);

// 5. Group by Priority
const byPriority: Record<string, number> = {};
for (const e of failedEntries) {
  const p = e.v1.priority || "Unknown";
  byPriority[p] = (byPriority[p] || 0) + 1;
}
console.log("\n5. Failures by Original Priority:", byPriority);

// 6. Inspect Sample Failures across Indeed and Naukri
console.log("\n6. Sample Failed Indeed Items:");
const indeedFails = failedEntries.filter((e: any) => e.v1.source === "Indeed").slice(0, 5);
for (const f of indeedFails) {
  console.log(`  - [${f.canonicalJobId}] ${f.v1.jobTitle} (${f.v1.companyName}) -> URL: ${f.v1.canonicalUrl} | Reason: ${f.reacquisition.failureReason}`);
}

console.log("\n7. Sample Failed Naukri Items:");
const naukriFails = failedEntries.filter((e: any) => e.v1.source === "Naukri").slice(0, 5);
for (const f of naukriFails) {
  console.log(`  - [${f.canonicalJobId}] ${f.v1.jobTitle} (${f.v1.companyName}) -> URL: ${f.v1.canonicalUrl} | Reason: ${f.reacquisition.failureReason}`);
}
