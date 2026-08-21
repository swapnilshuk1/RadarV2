import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function run() {
  const userId = "ms6i7e3y-4x0chy5fy";

  console.log("==================================================");
  console.log("SEARCHING FOR ALL STALE/UNKNOWN PURSUE OPPORTUNITIES");
  console.log("==================================================");

  const repos = getRepositories();
  const userDecisions = await repos.decisions.getUserDecisions(userId);
  const opportunities = await OpportunityService.listForUser(userId);

  const affected: any[] = [];

  for (const o of opportunities) {
    const clientRec = userDecisions[o.jobHash];
    const userAction = o.userDecision?.userAction || (clientRec as any)?.verb;

    if (userAction === "PURSUE") {
      const currentFingerprint = o.engineRecommendation?.evaluationFingerprint || (o as any).recommendationResult?.policyVersion;
      const reviewedFingerprint = clientRec?.reviewedFingerprint || o.userDecision?.reviewedFingerprint || null;

      const isMatching = reviewedFingerprint && reviewedFingerprint === currentFingerprint;

      if (!isMatching) {
        affected.push({
          jobHash: o.jobHash,
          role: o.role,
          company: o.company,
          userAction,
          reviewedFingerprint,
          currentFingerprint,
          engineVerdict: o.engineRecommendation?.engineVerdict,
          qualityScore: o.engineRecommendation?.qualityScore,
          reviewWorkflowState: o.reviewWorkflowState,
        });
      }
    }
  }

  console.log(`\nFound ${affected.length} affected opportunity records with userAction = PURSUE and mismatched/stale/null fingerprint:\n`);

  affected.forEach((item, index) => {
    console.log(`--- Record #${index + 1} ---`);
    console.log(`  jobHash             : ${item.jobHash}`);
    console.log(`  role                : ${item.role}`);
    console.log(`  company             : ${item.company}`);
    console.log(`  userAction          : ${item.userAction}`);
    console.log(`  reviewedFingerprint : ${item.reviewedFingerprint}`);
    console.log(`  currentFingerprint  : ${item.currentFingerprint}`);
    console.log(`  engineVerdict       : ${item.engineVerdict}`);
    console.log(`  qualityScore        : ${item.qualityScore}`);
    console.log(`  reviewWorkflowState : ${item.reviewWorkflowState}`);
    console.log(``);
  });
}

run().catch(console.error);
