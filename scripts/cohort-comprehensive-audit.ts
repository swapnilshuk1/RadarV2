import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function comprehensiveAudit() {
  const db = getDatabaseAdapter();
  const repos = getRepositories();
  const userId = "ms6i7e3y-4x0chy5fy";

  console.log("==================================================");
  console.log("COMPREHENSIVE COHORT & DATA-FLOW AUDIT");
  console.log("==================================================");

  // 1. List all tables in Turso DB
  const tables = await db.many<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  console.log("Tables in Turso DB:", tables.map((t) => t.name).join(", "));

  // 2. Sample opportunities and candidate_evaluations to see ID formatting
  const sampleOpps = await db.many<any>("SELECT id, canonical_title, company_id, created_at FROM opportunities LIMIT 5");
  console.log("\nSample opportunities:", sampleOpps);

  const sampleEvals = await db.many<any>("SELECT job_hash, engine_verdict, quality_score, updated_at FROM candidate_evaluations WHERE person_id = ? LIMIT 5", [userId]);
  console.log("\nSample candidate_evaluations:", sampleEvals);

  // 3. Inspect recent documents created_at and opportunity_id
  const recentDocs = await db.many<any>(
    "SELECT id, opportunity_id, created_at FROM documents WHERE created_at >= '2026-08-16' ORDER BY created_at DESC"
  );
  console.log(`\nRecent documents (>= 2026-08-16): ${recentDocs.length}`);
  if (recentDocs.length > 0) {
    console.log("First 5 recent docs:", recentDocs.slice(0, 5));
  }

  // 4. Inspect recent opportunities created_at
  const recentOpps = await db.many<any>(
    "SELECT id, canonical_title, company_id, location, created_at FROM opportunities WHERE created_at >= '2026-08-16' ORDER BY created_at DESC"
  );
  console.log(`\nRecent opportunities in 'opportunities' table (>= 2026-08-16): ${recentOpps.length}`);

  // 5. Let's check candidate_evaluations created/updated timestamps or evaluation JSON timestamps
  const allEvals = await db.many<any>(
    "SELECT job_hash, engine_verdict, quality_score, user_decision_override, effective_decision, evaluation_json, updated_at FROM candidate_evaluations WHERE person_id = ?",
    [userId]
  );
  console.log(`\nTotal candidate_evaluations for user: ${allEvals.length}`);

  let evalEvaluatedAtDates: Record<string, number> = {};
  let enrichedCount = 0;
  let pursueCount = 0;
  let considerCount = 0;
  let passCount = 0;
  let sparseCount = 0;

  const evalByHash = new Map<string, any>();

  for (const ev of allEvals) {
    evalByHash.set(ev.job_hash, ev);
    try {
      const parsed = JSON.parse(ev.evaluation_json);
      const evalAt = parsed.evaluatedAt ? parsed.evaluatedAt.slice(0, 10) : (ev.updated_at ? ev.updated_at.slice(0, 10) : "UNKNOWN");
      evalEvaluatedAtDates[evalAt] = (evalEvaluatedAtDates[evalAt] || 0) + 1;

      const verb = parsed.engineVerdict || ev.engine_verdict;
      if (verb === "PURSUE") pursueCount++;
      else if (verb === "CONSIDER") considerCount++;
      else if (verb === "PASS") passCount++;
      else if (verb === "SPARSE_SPEC") sparseCount++;

      // Check enrichment
      const isEnriched = Boolean(
        (parsed.evidence && parsed.evidence.length > 0) ||
        (parsed.decisionDrivers && parsed.decisionDrivers.length > 0) ||
        (parsed.relativeDifferentiator && parsed.relativeDifferentiator.length > 0)
      );
      if (isEnriched) enrichedCount++;
    } catch {}
  }

  console.log("Evaluations count by evaluatedAt / updated_at date:", evalEvaluatedAtDates);
  console.log(`Engine Verdict Breakdown across ALL ${allEvals.length} evaluations:`);
  console.log(`  PURSUE: ${pursueCount}`);
  console.log(`  CONSIDER: ${considerCount}`);
  console.log(`  PASS: ${passCount}`);
  console.log(`  SPARSE_SPEC: ${sparseCount}`);
  console.log(`  Semantically Enriched: ${enrichedCount}`);

  // 6. Check user decisions table
  const userDecisions = await db.many<any>(
    "SELECT opportunity_id as job_hash, action as verb, reviewed_fingerprint, updated_at FROM decisions WHERE person_id = ?",
    [userId]
  );
  console.log(`\nTotal explicit user decisions in DB: ${userDecisions.length}`);
  const userDecByHash = new Map<string, any>();
  for (const d of userDecisions) {
    userDecByHash.set(d.job_hash, d);
  }

  // 7. Test OpportunityService.listForUser(userId) and index.tsx Shortlist filtering
  const opportunities = await OpportunityService.listForUser(userId);
  console.log(`\nOpportunityService.listForUser(userId) returned: ${opportunities.length} opportunities`);

  // Let's trace how many pass Shortlist remaining filter BEFORE and AFTER our fix
  // Original index.tsx filter (without userVerb === "PURSUE" exclusion):
  const remainingOriginal = opportunities.filter((o) => {
    const clientRec = userDecByHash.get(o.jobHash);
    const currentFingerprint = o.engineRecommendation?.evaluationFingerprint || (o as any).recommendationResult?.policyVersion;
    if (clientRec && clientRec.reviewed_fingerprint && clientRec.reviewed_fingerprint === currentFingerprint) return false;

    if (o.reviewWorkflowState === "UNREVIEWED") {
      if (clientRec && !clientRec.reviewed_fingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_STALE") {
      if (clientRec && clientRec.reviewed_fingerprint === currentFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_UNKNOWN") {
      if (clientRec && clientRec.reviewed_fingerprint === currentFingerprint) return false;
      const action = o.userDecision?.userAction || o.engineRecommendation?.engineVerdict;
      return action === "PURSUE" || action === "CONSIDER";
    }

    return false;
  });

  // Current index.tsx filter (WITH userVerb === "PURSUE" exclusion):
  const remainingCurrent = opportunities.filter((o) => {
    const clientRec = userDecByHash.get(o.jobHash);
    const userVerb = clientRec?.verb || o.userDecision?.userAction;
    if (userVerb === "PURSUE") return false;

    const currentFingerprint = o.engineRecommendation?.evaluationFingerprint || (o as any).recommendationResult?.policyVersion;
    if (clientRec && clientRec.reviewed_fingerprint && clientRec.reviewed_fingerprint === currentFingerprint) return false;

    if (o.reviewWorkflowState === "UNREVIEWED") {
      if (clientRec && !clientRec.reviewed_fingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_STALE") {
      if (clientRec && clientRec.reviewed_fingerprint === currentFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_UNKNOWN") {
      if (clientRec && clientRec.reviewed_fingerprint === currentFingerprint) return false;
      const action = o.userDecision?.userAction || o.engineRecommendation?.engineVerdict;
      return action === "PURSUE" || action === "CONSIDER";
    }

    return false;
  });

  console.log(`\nShortlist remaining count BEFORE fix (original filter): ${remainingOriginal.length}`);
  console.log(`Shortlist remaining count AFTER fix (current filter): ${remainingCurrent.length}`);

  // Let's break down the 68 items excluded by the fix
  const excludedByFix = remainingOriginal.filter((o) => {
    const clientRec = userDecByHash.get(o.jobHash);
    const userVerb = clientRec?.verb || o.userDecision?.userAction;
    return userVerb === "PURSUE";
  });

  console.log(`\nExact items excluded by userVerb === 'PURSUE' fix: ${excludedByFix.length}`);

  // Check how many of these 68 excluded items have an EXPLICIT row in the 'decisions' table vs userDecisionOverride
  let explicitDecisionsInExcluded = 0;
  let implicitOverridesInExcluded = 0;

  for (const o of excludedByFix) {
    const inDecisionsTable = userDecByHash.has(o.jobHash);
    if (inDecisionsTable) {
      explicitDecisionsInExcluded++;
    } else {
      implicitOverridesInExcluded++;
    }
  }

  console.log(`  - Explicit rows in 'decisions' table: ${explicitDecisionsInExcluded}`);
  console.log(`  - Non-explicit (userDecisionOverride on evaluation row): ${implicitOverridesInExcluded}`);
}

comprehensiveAudit().catch(console.error);
