import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import { MetricIntegrityValidator, type CanonicalOpportunityMetrics } from "../src/lib/intelligence/metric-integrity";
import { getShortlistMetricsFn } from "../src/lib/intelligence/opportunity-server";

async function runPhase73Audit() {
  console.log("==========================================================");
  console.log(" RADAR V4 PHASE 7.3 METRIC INTEGRITY FORENSIC AUDIT");
  console.log("==========================================================\n");

  const personId = "guest-user";
  const db = getDatabaseAdapter();

  // ─────────────────────────────────────────────────────────────
  // 1. PERFORMANCE FORENSICS & LATENCY MEASUREMENT
  // ─────────────────────────────────────────────────────────────
  console.log("--- 1. PERFORMANCE FORENSICS ---");
  const perfSamples: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await OpportunityService.getMetricsForUser(personId);
    const end = performance.now();
    perfSamples.push(end - start);
  }
  const avgLatency = perfSamples.reduce((a, b) => a + b, 0) / perfSamples.length;
  const minLatency = Math.min(...perfSamples);
  const maxLatency = Math.max(...perfSamples);

  console.log(`Measured Latency over 10 iterations:`);
  console.log(`- Average: ${avgLatency.toFixed(2)} ms`);
  console.log(`- Min    : ${minLatency.toFixed(2)} ms`);
  console.log(`- Max    : ${maxLatency.toFixed(2)} ms`);
  console.log(`- High-resolution sample timings (ms):`, perfSamples.map((s) => s.toFixed(2)).join(", "));

  // ─────────────────────────────────────────────────────────────
  // 2. LOAD-TIME EXECUTION & REAL FAULT INJECTION (LOAD PATH)
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- 2. REAL LOAD-PATH FAULT INJECTION ---");
  const canonicalReal = await OpportunityService.getMetricsForUser(personId);
  console.log("Canonical Real Snapshot:", {
    totalScreened: canonicalReal.totalScreened,
    activePursuits: canonicalReal.activePursuits,
    totalShortlisted: canonicalReal.totalShortlisted,
    integrityStatus: canonicalReal.integrity.status,
  });

  // Corrupt snapshot injection test through validator
  const corruptSnapshot: Omit<CanonicalOpportunityMetrics, "integrity"> = {
    ...canonicalReal,
    totalScreened: 100, // Deliberate corruption
  };
  const injectedIntegrity = await MetricIntegrityValidator.validate(corruptSnapshot, db);
  console.log("Injected Corruption Result:", {
    status: injectedIntegrity.status,
    discrepancyCount: injectedIntegrity.discrepancies.length,
    discrepancies: injectedIntegrity.discrepancies,
  });

  // ─────────────────────────────────────────────────────────────
  // 3. VALIDATION FAILURE INJECTION (UNAVAILABLE STATE)
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- 3. VALIDATION FAILURE INJECTION (UNAVAILABLE) ---");
  const mockFailingDb: any = {
    one: async () => { throw new Error("Database timeout simulated"); },
    many: async () => { throw new Error("Database timeout simulated"); },
  };
  const unavailableIntegrity = await MetricIntegrityValidator.validate(canonicalReal, mockFailingDb);
  console.log("Unavailable Failure Result:", {
    status: unavailableIntegrity.status,
    discrepancies: unavailableIntegrity.discrepancies,
  });

  // ─────────────────────────────────────────────────────────────
  // 4. DYNAMIC CORPUS LIFECYCLE TEST
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- 4. DYNAMIC CORPUS LIFECYCLE TEST ---");
  const initialScreened = canonicalReal.totalScreened;
  const testJobHash = `test_dyn_${Date.now()}`;
  
  // Insert temporary evaluation
  await db.execute(
    `INSERT INTO candidate_evaluations (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_json, updated_at)
     VALUES (?, ?, 'v4.1', 'hash_test', 'PURSUE', 90, 'PURSUE', 90, '{}', CURRENT_TIMESTAMP)`,
    [personId, testJobHash]
  );

  const updatedMetrics = await OpportunityService.getMetricsForUser(personId);
  console.log(`Corpus +1 Test: Initial Screened = ${initialScreened}, Updated Screened = ${updatedMetrics.totalScreened}`);

  // Cleanup temporary evaluation
  await db.execute(`DELETE FROM candidate_evaluations WHERE job_hash = ?`, [testJobHash]);
  const cleanedMetrics = await OpportunityService.getMetricsForUser(personId);
  console.log(`Post-cleanup Screened = ${cleanedMetrics.totalScreened}`);

  // ─────────────────────────────────────────────────────────────
  // 5. USER DECISION STATE LIFECYCLE TEST
  // ─────────────────────────────────────────────────────────────
  console.log("\n--- 5. USER DECISION STATE LIFECYCLE TEST ---");
  const initialUserDecisions = canonicalReal.totalDecisions;
  const decisionHash = `test_dec_${Date.now()}`;

  // Insert temporary decision
  await db.execute(
    `INSERT INTO decisions (person_id, opportunity_id, action, reason, updated_at)
     VALUES (?, ?, 'PURSUE', 'Test decision', CURRENT_TIMESTAMP)`,
    [personId, decisionHash]
  );

  const postDecisionMetrics = await OpportunityService.getMetricsForUser(personId);
  console.log(`User Decision Test: Initial Decisions = ${initialUserDecisions}, Post-Decision = ${postDecisionMetrics.totalDecisions}`);
  console.log(`Engine Pursue count unchanged check: Initial = ${canonicalReal.engineBreakdown.pursue}, Post = ${postDecisionMetrics.engineBreakdown.pursue}`);

  // Cleanup decision
  await db.execute(`DELETE FROM decisions WHERE opportunity_id = ?`, [decisionHash]);
  const finalMetrics = await OpportunityService.getMetricsForUser(personId);
  console.log(`Post-decision cleanup count = ${finalMetrics.totalDecisions}`);

  console.log("\n==========================================================");
  console.log(" AUDIT COMPLETED CLEANLY");
  console.log("==========================================================");
}

runPhase73Audit().catch((err) => {
  console.error("Audit failed with error:", err);
  process.exit(1);
});
