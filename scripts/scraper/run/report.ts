import fs from "fs";
import path from "path";
import { readJsonSafe } from "../utils/fs-atomic";
import { RUNS_DIR, SEARCH_METRICS_NDJSON } from "../config";
import type { PageExecutionRecord } from "../types";
import { CertificationEngine } from "../telemetry/certify";

export function generateAcquisitionReport(runId: string) {
  const runDir = path.join(RUNS_DIR, runId);
  const manifestPath = path.join(runDir, "manifest.json"); // Acting as ExecutionState
  const planPath = path.join(process.cwd(), ".radar", "runs", "ExecutionPlan.json");

  const state = readJsonSafe<any>(manifestPath);
  const plan = readJsonSafe<any>(planPath);

  if (!state) {
    console.error("No execution state found for report generation.");
    return;
  }

  // 1. Calculate Definitions Planned
  const plannedDefs = new Set<string>();
  let executionMode = "AD_HOC";
  if (plan && plan.workUnits) {
    executionMode = "PLANNED";
    plan.workUnits.forEach((u: any) => plannedDefs.add(u.definitionId));
  }
  let definitionsPlanned = plannedDefs.size;

  // 2. Read Telemetry Records
  const records: PageExecutionRecord[] = [];
  if (fs.existsSync(SEARCH_METRICS_NDJSON)) {
    const lines = fs.readFileSync(SEARCH_METRICS_NDJSON, "utf-8").split("\n").filter(l => l.trim() !== "");
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record.runId === runId && record.type === "PageExecutionRecord") {
          records.push(record);
        }
      } catch {}
    }
  }

  // 3. Certification Engine
  const certEngine = new CertificationEngine();
  const certResult = certEngine.certify(records);
  let certification = certResult.passed ? "PASS" : "FAIL";

  // 4. Aggregate Metrics
  const executedDefs = new Set<string>();
  let listings = 0;
  let uniqueOpportunities = 0;
  let duplicateCount = 0;
  let rejectedCount = 0;
  let browserMinutes = 0;
  
  // Portal Health Aggregations
  const portalStats = new Map<string, { attempts: number; successes: number }>();

  for (const r of records) {
    if (r.definitionId && r.definitionId !== "unknown" && !r.definitionId.startsWith("def:adhoc:")) {
      executedDefs.add(r.definitionId);
    }
    
    listings += r.cardsSeen;
    duplicateCount += r.duplicates;
    rejectedCount += r.rejected;
    uniqueOpportunities += r.opportunities;
    browserMinutes += (r.latencyMs / 1000 / 60);

    const pStats = portalStats.get(r.portal) || { attempts: 0, successes: 0 };
    pStats.attempts++;
    if (r.failureReason === null) {
      pStats.successes++;
    }
    portalStats.set(r.portal, pStats);
  }

  const definitionsExecuted = executedDefs.size;
  if (executionMode === "AD_HOC") {
    definitionsPlanned = definitionsExecuted; // Normalize ad-hoc for coverage display
  }

  // Additional check: did we execute what we planned?
  if (executionMode === "PLANNED" && definitionsPlanned > 0 && definitionsExecuted !== definitionsPlanned) {
    certification = "FAIL (Definitions Planned != Definitions Executed)";
  }

  // Compute Telemetry Completeness
  const completenessPct = definitionsPlanned > 0 ? (definitionsExecuted / definitionsPlanned) * 100 : (definitionsExecuted > 0 ? 100 : 0);
  const coverage = completenessPct.toFixed(1) + "%";

  let decisionReadiness = "NOT READY";
  if (completenessPct >= 90) {
    decisionReadiness = "READY";
  } else if (completenessPct > 0) {
    decisionReadiness = "PARTIAL";
  }

  const duplicateRate = listings > 0 ? (duplicateCount / listings * 100).toFixed(1) : "0.0";
  
  const llmTokens = state.telemetry?.llmCalls ? state.telemetry.llmCalls * 500 : 0;
  const costPerOpp = uniqueOpportunities > 0 ? ((browserMinutes * 0.05 + llmTokens * 0.00001) / uniqueOpportunities).toFixed(3) : "0.000";

  console.log(`
================================================
ACQUISITION REPORT
================================================
Mode: ${executionMode}
Run ID: ${runId}
Status: ${state.status}
Readiness: ${decisionReadiness}
TELEMETRY CERTIFIED: ${certification}
`);

  if (!certResult.passed) {
    console.log(`\n--- FATAL CERTIFICATION VIOLATIONS ---`);
    certResult.violations.filter(v => v.severity === "Fatal").forEach(v => {
      console.log(`[${v.law}] ${v.message}`);
    });
  }
  
  const warnings = certResult.violations.filter(v => v.severity === "Warning");
  if (warnings.length > 0) {
    console.log(`\n--- WARNINGS ---`);
    warnings.forEach(v => {
      console.log(`[${v.law}] ${v.message}`);
    });
  }

  console.log(`
------------------------------------------------
1. ACQUISITION (Current Run vs Cumulative)
------------------------------------------------
Definitions Planned:  ${definitionsPlanned}
Definitions Executed: ${definitionsExecuted}
Coverage:             ${coverage}
Listings Seen:        ${listings}
Rejected:             ${rejectedCount}
Unique Opportunities: ${uniqueOpportunities}

------------------------------------------------
2. PORTAL HEALTH (From Telemetry)
------------------------------------------------`);

  portalStats.forEach((stats, portal) => {
    const healthPct = stats.attempts > 0 ? Math.round((stats.successes / stats.attempts) * 100) : 0;
    console.log(`${portal.padEnd(15)} | Score: ${healthPct}% (${stats.successes}/${stats.attempts})`);
  });

  console.log(`
------------------------------------------------
3. EFFICIENCY
------------------------------------------------
Browser minutes:      ${browserMinutes.toFixed(1)}
LLM tokens:           ${llmTokens}
Cost/opportunity:     $${costPerOpp}
================================================
`);

  const reportPath = path.join(runDir, "AcquisitionReport.json");
  fs.writeFileSync(reportPath, JSON.stringify({
    mode: executionMode,
    runId,
    runStatus: state.status,
    decisionReadiness,
    certification,
    acquisition: { 
      definitionsPlanned,
      definitionsExecuted,
      coverage,
      listings, 
      rejected: rejectedCount,
      uniqueOpportunities 
    },
    efficiency: { 
      browserMinutes, 
      llmTokens, 
      costPerOpp 
    }
  }, null, 2), "utf-8");
  
  console.log(`Saved report to ${reportPath}`);
}
