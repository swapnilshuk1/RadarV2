/**
 * scripts/benchmarks/trace_pipeline_lifecycle.ts
 *
 * Exhaustive Trace of Ingested Opportunities:
 * Ingestion -> SearchPlan Projection -> Evaluation Worker -> Scorer/Candidate Match -> Materialized Evaluation -> Shortlist Feed Query
 */

import { getDatabaseAdapter } from "../../src/data/database/index";
import { EvaluationWorker } from "../../src/lib/intelligence/EvaluationWorker";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";

async function traceAllRecentOpportunities() {
  const db = getDatabaseAdapter();

  console.log("================================================================================");
  console.log("             RADAR PIPELINE END-TO-END LIFECYCLE AUDIT & TRACE");
  console.log("================================================================================");

  // 1. Identify Candidate / Profile Identity
  const user = await db.one<{ id: string; tenant_id: string; email: string }>(
    `SELECT id, tenant_id, email FROM people WHERE email LIKE '%swapnil%' OR id = 'ms6i7e3y-4x0chy5fy' LIMIT 1`
  );
  console.log(`Target User Identity:`, user);

  if (!user) {
    console.error("Target user not found!");
    return;
  }

  // 2. Fetch the 10 most recent canonical opportunities
  const recentOpps = await db.many<{
    id: string;
    source: string;
    source_job_id: string;
    company_name: string;
    canonical_url: string;
    created_at: string;
    job_title: string;
    location: string;
    latest_version: string;
    raw_content: string;
    acquisition_quality: string;
    acquisition_status: string;
  }>(
    `SELECT 
       co.id,
       co.source,
       co.source_job_id,
       co.company_name,
       co.canonical_url,
       co.created_at,
       ov.id as latest_version,
       ov.job_title,
       ov.location,
       ov.raw_content,
       ov.acquisition_quality,
       ov.acquisition_status
     FROM canonical_opportunities co
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
     ORDER BY co.created_at DESC
     LIMIT 10`
  );

  console.log(`\nFound ${recentOpps.length} most recent opportunities to trace across the pipeline.\n`);

  // 3. Process any pending evaluation jobs first so we trace their evaluated state
  console.log("--------------------------------------------------------------------------------");
  console.log("[STAGE 1] Running Evaluation Worker for any queued evaluation jobs...");
  console.log("--------------------------------------------------------------------------------");
  try {
    const worker = new EvaluationWorker(db);
    const workerResult = await worker.drainQueue({ maxJobs: 50, concurrency: 2 });
    console.log(`Evaluation Worker Drain Result:`, workerResult);
  } catch (err: any) {
    console.error(`Evaluation Worker Error:`, err.message);
  }

  // 4. Trace each opportunity through the 5 architectural stages
  console.log("\n--------------------------------------------------------------------------------");
  console.log("[STAGE 2] Detailed Step-by-Step Trace for Each Scraped Opportunity");
  console.log("--------------------------------------------------------------------------------\n");

  for (let i = 0; i < recentOpps.length; i++) {
    const opp = recentOpps[i];
    console.log(`================================================================================`);
    console.log(`[#${i + 1}] TRACING OPPORTUNITY: ${opp.job_title} @ ${opp.company_name} (${opp.source} / ${opp.source_job_id})`);
    console.log(`================================================================================`);
    console.log(`1. ACQUISITION & INGESTION STAGE:`);
    console.log(`   - Canonical Job ID    : ${opp.id}`);
    console.log(`   - Opportunity Version : ${opp.latest_version}`);
    console.log(`   - Ingested At         : ${opp.created_at}`);
    console.log(`   - Portal / Apply URL  : ${opp.source} | ${opp.canonical_url}`);
    console.log(`   - Acquisition Status  : ${opp.acquisition_status} (Quality: ${opp.acquisition_quality})`);
    console.log(`   - Raw Content Length  : ${opp.raw_content?.length || 0} characters`);

    // Step B: Search Plan Projection
    const candidates = await db.many<{
      search_plan_id: string;
      tenant_id: string;
      person_id: string;
      attention_decision: string;
      created_at: string;
    }>(
      `SELECT search_plan_id, tenant_id, person_id, attention_decision, created_at 
       FROM search_plan_candidates 
       WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [opp.id, opp.latest_version]
    );

    console.log(`\n2. SEARCH PLAN ATTENTION GATE PROJECTION:`);
    if (candidates.length === 0) {
      console.log(`   ⚠️ NO search_plan_candidates row found for this version!`);
    } else {
      for (const cand of candidates) {
        console.log(`   - Search Plan [${cand.search_plan_id}]:`);
        console.log(`     Tenant: ${cand.tenant_id} | Person: ${cand.person_id}`);
        console.log(`     Attention Decision : ${cand.attention_decision}`);
      }
    }

    // Step C: Evaluation Job Status
    const jobs = await db.many<{
      id: string;
      status: string;
      attempts: number;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, status, attempts, last_error, created_at, updated_at 
       FROM evaluation_jobs 
       WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [opp.id, opp.latest_version]
    );

    console.log(`\n3. EVALUATION WORK QUEUE:`);
    if (jobs.length === 0) {
      console.log(`   ℹ️ No evaluation_jobs queued (likely rejected at AttentionGate or previously finalized)`);
    } else {
      for (const job of jobs) {
        console.log(`   - Job ID: ${job.id}`);
        console.log(`     Status: ${job.status} (Attempts: ${job.attempts})`);
        if (job.last_error) console.log(`     Error Message: ${job.last_error}`);
      }
    }

    // Step D: Materialized Evaluation & Scorer Details
    const evaluations = await db.many<{
      id: string;
      tenant_id: string;
      person_id: string;
      evaluation_context_fingerprint: string;
      evaluation_state: string;
      decision: string;
      quality_score: number | null;
      vetoed: number;
      rationale: string | null;
      evaluation_json: string;
      materialized_at: string;
    }>(
      `SELECT 
         id, tenant_id, person_id, evaluation_context_fingerprint,
         evaluation_state, decision, quality_score, vetoed,
         rationale, evaluation_json, materialized_at
       FROM materialized_evaluations
       WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [opp.id, opp.latest_version]
    );

    console.log(`\n4. MATERIALIZED EVALUATION (SCORING & FIT WITH CANDIDATE PROFILE):`);
    if (evaluations.length === 0) {
      console.log(`   ❌ No materialized_evaluations record found.`);
    } else {
      for (const ev of evaluations) {
        console.log(`   - Evaluation ID : ${ev.id}`);
        console.log(`     Tenant: ${ev.tenant_id} | Person: ${ev.person_id}`);
        console.log(`     State: ${ev.evaluation_state} | Engine Decision: ${ev.decision}`);
        console.log(`     Fit Quality Score : ${ev.quality_score !== null ? ev.quality_score + "/100" : "None"}`);
        console.log(`     Vetoed : ${ev.vetoed === 1 ? "YES" : "NO"}`);
        if (ev.rationale) console.log(`     Rationale : "${ev.rationale}"`);
        if (ev.evaluation_json) {
          try {
            const parsed = JSON.parse(ev.evaluation_json);
            if (parsed.whyNow) console.log(`     Why Now Context : "${parsed.whyNow}"`);
            if (parsed.dimensionScores) console.log(`     Dimension Scores :`, parsed.dimensionScores);
            if (parsed.primaryConcern) console.log(`     Primary Concern :`, parsed.primaryConcern);
          } catch {
            // json parse ignore
          }
        }
      }
    }

    // Step E: User Decision State
    const userDecision = await db.one<{
      action: string;
      reason: string | null;
      updated_at: string;
    }>(
      `SELECT action, reason, updated_at 
       FROM canonical_decisions 
       WHERE canonical_job_id = ? AND person_id = ?`,
      [opp.id, user.id]
    );
    console.log(`\n5. EXECUTIVE DECISION STATE:`);
    console.log(`   - User Action: ${userDecision ? userDecision.action : "UNREVIEWED (None)"}`);
    if (userDecision?.reason) console.log(`   - Reason: ${userDecision.reason}`);

    console.log(`\n`);
  }

  // 5. Query Frontend Shortlist Feed for the User
  console.log("================================================================================");
  console.log("[STAGE 3] FRONTEND SHORTLIST FEED QUERY AUDIT (OpportunityService.listForUser)");
  console.log("================================================================================");

  try {
    const feed = await OpportunityService.listForUser(user.id, { decisionFilter: "unreviewed" });
    console.log(`Total Unreviewed Opportunities in Frontend Shortlist: ${feed.length}\n`);

    console.log("Top 10 Opportunities Rendered on Shortlist View:");
    feed.slice(0, 10).forEach((item, idx) => {
      console.log(
        `  ${idx + 1}. [${item.scrapedFrom}] ${item.role} @ ${item.company}` +
        ` | Decision: ${item.decision} | Score: ${item.recommendationResult?.score ?? "N/A"}` +
        ` | Hash: ${item.jobHash}`
      );
    });

    // Check if any of our recent opportunities are present in the feed
    console.log("\nChecking Presence of Recent Opportunities in Shortlist Feed:");
    for (const opp of recentOpps) {
      const inFeed = feed.find((f) => f.jobHash === opp.source_job_id || f.jobHash === opp.id);
      if (inFeed) {
        console.log(`  ✓ PRESENT: [${opp.source}] ${opp.job_title} @ ${opp.company_name} (Decision: ${inFeed.decision}, Score: ${inFeed.recommendationResult?.score ?? "N/A"})`);
      } else {
        console.log(`  ✗ NOT IN FEED: [${opp.source}] ${opp.job_title} @ ${opp.company_name}`);
      }
    }
  } catch (err: any) {
    console.error("Error querying OpportunityService.listForUser:", err.message);
  }
}

traceAllRecentOpportunities().catch(console.error);
