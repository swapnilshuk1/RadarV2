import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import { resolveShortlistCardBadgeState } from "../src/routes/index";

async function run() {
  const userId = "ms6i7e3y-4x0chy5fy";
  const jobHash = "j-f1b1ee48cdde";

  console.log("==================================================");
  console.log("TRACE FOR OPPORTUNITY:", jobHash);
  console.log("==================================================");

  // 1. Get raw evaluation row from repository
  const repos = getRepositories();
  const rawRow = await repos.evaluations.getEvaluation(userId, jobHash);
  console.log("\n1. RAW EVALUATION ROW FROM DB:");
  console.log("  engine_verdict:", (rawRow as any)?.engineVerdict || (rawRow as any)?.engine_verdict);
  console.log("  quality_score:", (rawRow as any)?.qualityScore || (rawRow as any)?.quality_score);
  console.log("  user_decision_override:", (rawRow as any)?.userDecisionOverride || (rawRow as any)?.user_decision_override);
  console.log("  effective_decision:", (rawRow as any)?.effectiveDecision || (rawRow as any)?.effective_decision);

  // 2. Run OpportunityService.getForUser
  const opp = await OpportunityService.getForUser(userId, jobHash);
  console.log("\n2. OPPORTUNITY OBJECT RETURNED BY OpportunityService.getForUser:");
  if (opp) {
    console.log("  opp.decision:", opp.decision);
    console.log("  opp.reviewWorkflowState:", opp.reviewWorkflowState);
    console.log("  opp.engineRecommendation:", JSON.stringify(opp.engineRecommendation, null, 2));
    console.log("  opp.userDecision:", JSON.stringify(opp.userDecision, null, 2));
    console.log("  opp.recommendationResult:", JSON.stringify((opp as any).recommendationResult, null, 2));
  } else {
    console.log("  Opportunity NOT found by getForUser!");
  }

  // 3. Check what resolveShortlistCardBadgeState evaluates to
  if (opp) {
    const badgeState = resolveShortlistCardBadgeState(opp);
    console.log("\n3. PRESENTATION LAYER BADGE STATE:");
    console.log("  primaryLabel:", badgeState.primaryLabel);
    console.log("  badgeClass:", badgeState.badgeClass);
    console.log("  isStale:", badgeState.isStale);
    console.log("  staleLabel:", badgeState.staleLabel);
    console.log("  previousAction:", badgeState.previousAction);
  }

  // 4. Trace activePursuits and attentionWindow in OpportunityService
  const metrics = await OpportunityService.getMetricsForUser(userId);
  console.log("\n4. METRICS COMPUTED FOR USER:");
  console.log("  totalScreened:", metrics.totalScreened);
  console.log("  activePursuits:", metrics.activePursuits);
  console.log("  totalShortlisted:", metrics.totalShortlisted);
  console.log("  engineBreakdown:", metrics.engineBreakdown);
}

run().catch(console.error);
