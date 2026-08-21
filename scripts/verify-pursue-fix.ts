import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function verify() {
  const userId = "ms6i7e3y-4x0chy5fy";
  const targetIds = ["j-f1b1ee48cdde", "j-54ccee9cecb4", "j-066180afd525"];

  console.log("==================================================");
  console.log("VERIFYING POST-FIX BEHAVIOR FOR KNOWN & ALL PURSUE OPPORTUNITIES");
  console.log("==================================================");

  const repos = getRepositories();
  const userDecisions = await repos.decisions.getUserDecisions(userId);
  const opportunities = await OpportunityService.listForUser(userId);

  console.log("\n--- Checking 3 Known Target Opportunities ---");
  for (const id of targetIds) {
    const opp = opportunities.find((o) => o.jobHash === id);
    const dec = userDecisions[id];

    console.log(`\nOpportunity ID: ${id}`);
    console.log(`  Title: ${opp?.role} (${opp?.company})`);
    console.log(`  User Decision in DB (verb): ${dec?.verb}`);
    console.log(`  Updated At timestamp: ${dec?.updatedAt}`);
    console.log(`  Engine Verdict: ${opp?.engineRecommendation?.engineVerdict}`);
    console.log(`  Quality Score: ${opp?.engineRecommendation?.qualityScore}`);
    console.log(`  Review Workflow State: ${opp?.reviewWorkflowState}`);
    console.log(`  Present in Opportunities List (/decisions): ${Boolean(opp && dec?.verb === "PURSUE")}`);
  }

  // Count remaining on shortlist logic
  const remaining = opportunities.filter((o) => {
    const clientRec = userDecisions[o.jobHash];
    const userVerb = clientRec?.verb || o.userDecision?.userAction;
    if (userVerb === "PURSUE") return false;

    const currentFingerprint = o.engineRecommendation?.evaluationFingerprint || (o as any).recommendationResult?.policyVersion;
    if (clientRec && clientRec.reviewedFingerprint && clientRec.reviewedFingerprint === currentFingerprint) return false;

    if (o.reviewWorkflowState === "UNREVIEWED") {
      if (clientRec && !clientRec.reviewedFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_STALE") {
      if (clientRec && clientRec.reviewedFingerprint === currentFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_UNKNOWN") {
      if (clientRec && clientRec.reviewedFingerprint === currentFingerprint) return false;
      const action = o.userDecision?.userAction || o.engineRecommendation?.engineVerdict;
      return action === "PURSUE" || action === "CONSIDER";
    }

    return false;
  });

  const stalePursueOnShortlist = remaining.filter((o) => {
    const verb = userDecisions[o.jobHash]?.verb || o.userDecision?.userAction;
    return verb === "PURSUE";
  });

  console.log("\n==================================================");
  console.log(`Total items on unresolved Shortlist queue: ${remaining.length}`);
  console.log(`Stale/Unknown PURSUE items remaining on Shortlist: ${stalePursueOnShortlist.length}`);
  console.log("==================================================");

  if (stalePursueOnShortlist.length === 0) {
    console.log("SUCCESS: 0 stale/unknown PURSUE items remain on Shortlist queue!");
  } else {
    console.error("FAILURE: Some stale PURSUE items are still on Shortlist!");
    process.exit(1);
  }
}

verify().catch(console.error);
