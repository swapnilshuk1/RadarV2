import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { DB_PATH, RUNS_DIR, SEARCH_METRICS_NDJSON } from "./scraper/config";
import type { ExecutionPlan } from "./scraper/types";

function runTrace(definitionId?: string) {
  const db = new Database(DB_PATH);
  
  if (!definitionId) {
    const def = db.prepare("SELECT id FROM search_definitions WHERE status = 'ACTIVE' ORDER BY RANDOM() LIMIT 1").get() as any;
    if (!def) {
      console.error("No active definitions found in DB.");
      process.exit(1);
    }
    definitionId = def.id;
  }
  
  console.log(`Starting lineage audit for definition: ${definitionId}`);
  
  // Step 1: Definition
  const defRecord = db.prepare("SELECT * FROM search_definitions WHERE id = ?").get(definitionId) as any;
  if (!defRecord) {
    console.error(`❌ Definition ${definitionId} not found in database.`);
    process.exit(1);
  }
  console.log(`✅ Found Definition: ${defRecord.portal} - ${defRecord.raw_query} (${defRecord.location})`);
  
  // Step 2: WorkUnit in ExecutionPlan
  const planPath = path.join(RUNS_DIR, "ExecutionPlan.json");
  if (!fs.existsSync(planPath)) {
    console.error(`❌ ExecutionPlan.json not found at ${planPath}`);
    process.exit(1);
  }
  const plan: ExecutionPlan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
  const plannedUnits = plan.units.filter(u => u.definitionId === definitionId);
  if (plannedUnits.length === 0) {
    console.error(`❌ No WorkUnits planned for definition ${definitionId}`);
    process.exit(1);
  }
  console.log(`✅ Found ${plannedUnits.length} WorkUnits in ExecutionPlan.`);
  
  // Step 3: Execution Trace (manifest)
  const manifestPath = path.join(RUNS_DIR, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ manifest.json not found at ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const executedUnits = manifest.units.filter((u: any) => u.definitionId === definitionId);
  
  if (executedUnits.length === 0) {
    console.error(`❌ No WorkUnits found in execution manifest for definition ${definitionId}`);
    process.exit(1);
  }
  console.log(`✅ Found ${executedUnits.length} WorkUnits in manifest.`);
  
  const incomplete = executedUnits.filter((u: any) => u.status === "running" || u.status === "pending");
  if (incomplete.length > 0) {
    console.error(`❌ ${incomplete.length} WorkUnits are incomplete (running/pending).`);
    process.exit(1);
  }
  console.log(`✅ All execution WorkUnits reached terminal state.`);
  
  // Step 4: Telemetry Record
  if (!fs.existsSync(SEARCH_METRICS_NDJSON)) {
    console.error(`❌ ${SEARCH_METRICS_NDJSON} not found.`);
    process.exit(1);
  }
  const metrics = fs.readFileSync(SEARCH_METRICS_NDJSON, "utf-8").split("\n").filter(Boolean).map(line => JSON.parse(line));
  const runId = manifest.runId;
  const runMetrics = metrics.filter(m => m.runId === runId);
  
  // Check if every completed (done/failed) unit has a telemetry record?
  // Only "done" units emit telemetry.
  const doneUnits = executedUnits.filter((u: any) => u.status === "done");
  
  let telemetryMissing = 0;
  for (const unit of doneUnits) {
    const metric = runMetrics.find(m => 
      m.portal === unit.portal && 
      m.keyword === unit.keyword && 
      m.page === unit.page
    );
    if (!metric) {
      telemetryMissing++;
      console.error(`❌ Missing telemetry for Unit ${unit.id} (${unit.portal}:${unit.keyword}:${unit.page})`);
    }
  }
  
  if (telemetryMissing > 0) {
    console.error(`❌ Telemetry audit failed: ${telemetryMissing} done units missing metrics.`);
    process.exit(1);
  }
  
  console.log(`✅ Telemetry correctly recorded for all ${doneUnits.length} completed WorkUnits.`);
  
  console.log(`\n🎉 LINEAGE AUDIT PASSED for ${definitionId}`);
}

const args = process.argv.slice(2);
runTrace(args[0]);
