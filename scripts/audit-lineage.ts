import fs from "fs";
import path from "path";
import { getDatabaseAdapter } from "../src/data/database";

async function main() {
  const runDirs = fs.readdirSync(path.join(process.cwd(), ".scraper-artifacts", "runs"))
    .filter(d => d.startsWith("run-"))
    .sort()
    .reverse();
    
  const runId = runDirs[0];
  if (!runId) {
    console.error("No runs found");
    return;
  }
  
  const runDir = path.join(process.cwd(), ".scraper-artifacts", "runs", runId);
  const manifestPath = path.join(runDir, "manifest.json");
  const reportPath = path.join(runDir, "AcquisitionReport.json");
  
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found for run ${runId}`);
    return;
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  
  // 1. Definition -> WorkUnit
  const units = manifest.units;
  if (!units || units.length === 0) {
    console.error("No units in manifest");
    return;
  }
  
  // Pick a random definition that was actually started
  const startedUnits = units.filter((u: any) => u.startedAt);
  if (startedUnits.length === 0) {
    console.log("No started units found in this run. Run a scrape first.");
    return;
  }
  
  const targetUnit = startedUnits[Math.floor(Math.random() * startedUnits.length)];
  const targetDefinitionId = targetUnit.definitionId;
  
  console.log(`\n=== LINEAGE AUDIT FOR RUN ${runId} ===\n`);
  console.log(`[Definition]`);
  console.log(`  Definition ID : ${targetDefinitionId}`);
  console.log(`  Query         : ${targetUnit.keyword}`);
  console.log(`  Portal        : ${targetUnit.portal}\n`);
  
  // Find all work units for this definition
  const defUnits = units.filter((u: any) => u.definitionId === targetDefinitionId);
  console.log(`[WorkUnits]`);
  defUnits.forEach((u: any) => {
    console.log(`  Unit ID       : ${u.id}`);
    console.log(`  Status        : ${u.status}`);
    console.log(`  Page          : ${u.page}`);
    console.log(`  Attempts      : ${u.attempts}\n`);
  });
  
  // Find executions in DB
  const db = getDatabaseAdapter();
  console.log(`[OpportunityDiscovery (Database)]`);
  const discoveries = await db.many<any>(
    `SELECT * FROM opportunity_discoveries WHERE first_definition = ?`,
    [targetUnit.keyword]
  );
  console.log(`  Found         : ${discoveries.length} discoveries`);
  discoveries.forEach((d: any) => {
    console.log(`  Discovery ID  : ${d.id}`);
    console.log(`  Opportunity ID: ${d.opportunity_id}`);
    console.log(`  Execution ID  : ${d.execution_id}\n`);
  });
  
  // Check ReadModel / AcquisitionReport
  console.log(`[AcquisitionReport]`);
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    console.log(`  Run Status      : ${report.runStatus}`);
    console.log(`  Report Quality  : ${report.reportQuality}`);
    console.log(`  Definitions Planned  : ${report.acquisition?.definitions?.planned}`);
    console.log(`  Definitions Started  : ${report.acquisition?.definitions?.started}`);
    console.log(`  Definitions Completed: ${report.acquisition?.definitions?.completed}\n`);
  } else {
    console.log(`  (Report not yet generated)`);
  }
}

main().catch(console.error);
