import { getDatabaseAdapter } from "../../src/data/database/index";
import { resolveScope, OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import { getRepositories } from "../../src/data/sqlite/provider";
import { performance } from "perf_hooks";

const CANONICAL_USER = "ms6i7e3y-4x0chy5fy";

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number[];
}

function computeStats(samples: number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const p = (pct: number) => {
    const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
    return sorted[idx];
  };
  return {
    min: sorted[0] || 0,
    max: sorted[sorted.length - 1] || 0,
    avg: sorted.length ? sum / sorted.length : 0,
    p50: p(50),
    p95: p(95),
    p99: p(99),
    samples: sorted,
  };
}

async function runBaseline() {
  console.log("=================================================");
  console.log("   RADAR v2 — Phase 1 Serving Baseline Benchmark  ");
  console.log("=================================================\n");

  const db = getDatabaseAdapter();
  const repos = getRepositories();

  // 1. Dataset Counts & Distribution Audit
  console.log("--- 1. Auditing Current Production Dataset ---");
  const scope = await resolveScope(CANONICAL_USER);
  const activeContext = await repos.canonicalServing.getActiveContext(scope);

  console.log(`Authorized Scope: tenant=${scope.tenantId}, person=${scope.personId}`);
  console.log(`Active Context: plan=${activeContext?.searchPlanId}, fingerprint=${activeContext?.contextFingerprint}`);

  const candidatesCountRow = await db.one<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM search_plan_candidates WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ? AND attention_decision = 'CANDIDATE'`,
    [scope.tenantId, scope.personId, activeContext!.searchPlanId]
  );
  const totalCandidates = candidatesCountRow?.cnt || 0;

  const decisionsCountRow = await db.one<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM canonical_decisions WHERE tenant_id = ? AND person_id = ?`,
    [scope.tenantId, scope.personId]
  );
  const totalDecisions = decisionsCountRow?.cnt || 0;

  console.log(`Total Candidates in Active Search Plan: ${totalCandidates}`);
  console.log(`Total Canonical Decisions Recorded: ${totalDecisions}`);

  // 2. Component Latency Decomposition & Profiling (Single Run Detailed Instrumentation)
  console.log("\n--- 2. Profiling Component Latency Breakdown ---");
  
  // A. Scope Resolution
  const t0_scope = performance.now();
  const profiledScope = await resolveScope(CANONICAL_USER);
  const t_scope = performance.now() - t0_scope;

  // B. Active Context Resolution
  const t0_ctx = performance.now();
  const profiledContext = await repos.canonicalServing.getActiveContext(profiledScope);
  const t_ctx = performance.now() - t0_ctx;

  // C. Raw SQL Query execution for listOpportunities
  const t0_sql = performance.now();
  const rows = await db.many<any>(
    `SELECT 
       co.id as canonical_job_id,
       co.source as source,
       co.source_job_id as source_job_id,
       co.canonical_url as apply_url,
       co.company_name as company_name,
       ov.id as opportunity_version_id,
       ov.job_title as job_title,
       ov.location as location,
       ov.employment_type as employment_type,
       ov.posted_at as posted_at,
       ov.posted_precision as posted_precision,
       ov.raw_content as description,
       spc.attention_decision as attention_decision,
       me.id as evaluation_id,
       me.evaluation_state as evaluation_state,
       me.decision as engine_decision,
       me.quality_score as quality_score,
       me.rationale as rationale,
       me.evidence_ids as evidence_ids,
       me.evaluation_json as evaluation_json,
       me.materialized_at as materialized_at,
       d.action as user_action,
       d.reason as user_reason,
       d.updated_at as user_decision_updated_at
     FROM search_plan_candidates spc
     JOIN canonical_opportunities co ON co.id = spc.canonical_job_id
     JOIN opportunity_versions ov ON ov.id = spc.opportunity_version
     LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id 
       AND me.opportunity_version = spc.opportunity_version
       AND me.tenant_id = spc.tenant_id 
       AND me.person_id = spc.person_id
       AND me.evaluation_context_fingerprint = ?
     LEFT JOIN canonical_decisions d 
       ON d.canonical_job_id = spc.canonical_job_id
       AND d.tenant_id = spc.tenant_id
       AND d.person_id = spc.person_id
     WHERE spc.tenant_id = ? 
       AND spc.person_id = ? 
       AND spc.search_plan_id = ?
       AND spc.attention_decision = 'CANDIDATE'`,
    [profiledContext!.contextFingerprint, profiledScope.tenantId, profiledScope.personId, profiledContext!.searchPlanId]
  );
  const t_sql = performance.now() - t0_sql;

  // D. JSON Parsing Time
  const t0_json = performance.now();
  let parsedJsonBytes = 0;
  for (const r of rows) {
    if (r.evaluation_json) {
      parsedJsonBytes += r.evaluation_json.length;
      try { JSON.parse(r.evaluation_json); } catch {}
    }
  }
  const t_json = performance.now() - t0_json;

  // E. Full listOpportunities execution
  const t0_fullList = performance.now();
  const allOpps = await repos.canonicalServing.listOpportunities(profiledScope);
  const t_fullList = performance.now() - t0_fullList;

  // F. Serialized JSON payload size
  const serializedBytes = Buffer.byteLength(JSON.stringify(allOpps), "utf-8");

  // G. Metrics Query execution
  const t0_metrics = performance.now();
  const metrics = await repos.canonicalServing.getOpportunityMetrics(profiledScope);
  const t_metrics = performance.now() - t0_metrics;

  // H. Sample Dossier Details execution
  const sampleJobHash = allOpps[0]?.jobHash;
  const t0_dossier = performance.now();
  const dossier = sampleJobHash ? await repos.canonicalServing.getOpportunityDetails(profiledScope, sampleJobHash) : null;
  const t_dossier = performance.now() - t0_dossier;

  console.log(`Decomposed Timings (Single Run):`);
  console.log(`  - Scope Resolution:             ${t_scope.toFixed(2)} ms`);
  console.log(`  - Active Context Resolution:     ${t_ctx.toFixed(2)} ms`);
  console.log(`  - SQL Query Execution:           ${t_sql.toFixed(2)} ms (retrieved ${rows.length} rows)`);
  console.log(`  - JSON Parsing (${(parsedJsonBytes / 1024 / 1024).toFixed(2)} MB):     ${t_json.toFixed(2)} ms`);
  console.log(`  - Full listOpportunities():     ${t_fullList.toFixed(2)} ms`);
  console.log(`  - Full Metrics Execution:        ${t_metrics.toFixed(2)} ms`);
  console.log(`  - Dossier Point Lookup:          ${t_dossier.toFixed(2)} ms`);
  console.log(`  - Full Response Payload Size:    ${(serializedBytes / 1024 / 1024).toFixed(2)} MB (${serializedBytes} bytes)`);

  // 3. Statistical Distribution across 10 Iterations (P50, P95, P99)
  console.log("\n--- 3. Measuring Statistical Latency (10 Iterations) ---");
  const scopeSamples: number[] = [];
  const feedSamples: number[] = [];
  const metricsSamples: number[] = [];
  const dossierSamples: number[] = [];

  for (let i = 1; i <= 10; i++) {
    process.stdout.write(`Iteration ${i}/10... `);
    
    const s0 = performance.now();
    const sc = await resolveScope(CANONICAL_USER);
    scopeSamples.push(performance.now() - s0);

    const f0 = performance.now();
    const list = await repos.canonicalServing.listOpportunities(sc);
    feedSamples.push(performance.now() - f0);

    const m0 = performance.now();
    await repos.canonicalServing.getOpportunityMetrics(sc);
    metricsSamples.push(performance.now() - m0);

    if (list[0]?.jobHash) {
      const d0 = performance.now();
      await repos.canonicalServing.getOpportunityDetails(sc, list[0].jobHash);
      dossierSamples.push(performance.now() - d0);
    }
    console.log("done");
  }

  const scopeStats = computeStats(scopeSamples);
  const feedStats = computeStats(feedSamples);
  const metricsStats = computeStats(metricsSamples);
  const dossierStats = computeStats(dossierSamples);

  console.log("\n=================================================");
  console.log("          BASELINE BENCHMARK RESULTS            ");
  console.log("=================================================");
  console.log("Operation                 P50        P95        P99        Min        Max        Avg");
  console.log("----------------------------------------------------------------------------------");
  console.log(`Scope Resolution:     ${scopeStats.p50.toFixed(0).padStart(6)}ms ${scopeStats.p95.toFixed(0).padStart(9)}ms ${scopeStats.p99.toFixed(0).padStart(9)}ms ${scopeStats.min.toFixed(0).padStart(9)}ms ${scopeStats.max.toFixed(0).padStart(9)}ms ${scopeStats.avg.toFixed(0).padStart(9)}ms`);
  console.log(`Feed (Full List):     ${feedStats.p50.toFixed(0).padStart(6)}ms ${feedStats.p95.toFixed(0).padStart(9)}ms ${feedStats.p99.toFixed(0).padStart(9)}ms ${feedStats.min.toFixed(0).padStart(9)}ms ${feedStats.max.toFixed(0).padStart(9)}ms ${feedStats.avg.toFixed(0).padStart(9)}ms`);
  console.log(`Metrics:              ${metricsStats.p50.toFixed(0).padStart(6)}ms ${metricsStats.p95.toFixed(0).padStart(9)}ms ${metricsStats.p99.toFixed(0).padStart(9)}ms ${metricsStats.min.toFixed(0).padStart(9)}ms ${metricsStats.max.toFixed(0).padStart(9)}ms ${metricsStats.avg.toFixed(0).padStart(9)}ms`);
  console.log(`Dossier Details:      ${dossierStats.p50.toFixed(0).padStart(6)}ms ${dossierStats.p95.toFixed(0).padStart(9)}ms ${dossierStats.p99.toFixed(0).padStart(9)}ms ${dossierStats.min.toFixed(0).padStart(9)}ms ${dossierStats.max.toFixed(0).padStart(9)}ms ${dossierStats.avg.toFixed(0).padStart(9)}ms`);
  console.log("=================================================\n");

  // 4. Output dataset counts breakdown
  const verdictCounts: Record<string, number> = {};
  const effectiveCounts: Record<string, number> = {};
  const tierCounts: Record<number, number> = {};

  for (const opp of allOpps) {
    const verdict = (opp as any).engineRecommendation?.engineVerdict || "UNMATERIALIZED";
    verdictCounts[verdict] = (verdictCounts[verdict] || 0) + 1;

    const eff = (opp as any).effectiveDecision || "NONE";
    effectiveCounts[eff] = (effectiveCounts[eff] || 0) + 1;

    const tier = (opp as any).populationTier ?? (eff === "ENGINE_PURSUIT" || eff === "USER_CONFIRMED" ? 0 : 5);
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  }

  console.log("Dataset Distributions:");
  console.log("  - Engine Verdicts:", verdictCounts);
  console.log("  - Effective Decisions:", effectiveCounts);
  console.log("  - Metrics Integrity:", metrics.integrity.status);
}

runBaseline().catch(console.error);
