import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import { getRepositories } from "../src/data/sqlite/provider";

async function checkHeadspaceDowngrade() {
  const userId = "ms6i7e3y-4x0chy5fy";
  const repos = getRepositories();

  const userDecisionsDB = await repos.decisions.getUserDecisions(userId);
  const activePursuitsCount = Object.values(userDecisionsDB).filter((d) => d.verb === "PURSUE").length;
  console.log(`Active Pursuits Count in DB for user ${userId}:`, activePursuitsCount);

  const list = await OpportunityService.listForUser(userId);

  const targetHashes = ["j-9d2006e16aba", "j-099437e80b44"];

  for (const jobHash of targetHashes) {
    const opp = list.find((o) => o.jobHash === jobHash);
    if (opp) {
      console.log(`\n========================================`);
      console.log(`JOB HASH: ${jobHash}`);
      console.log(`Title: ${opp.canonicalTitle}`);
      console.log(`Company: ${opp.companyName}`);
      console.log(`Decision (Legacy): ${opp.decision}`);
      console.log(`Engine Recommendation engineVerdict (Final Served): ${opp.engineRecommendation?.engineVerdict}`);
      console.log(`Engine Recommendation verb0 (Intrinsic in DB): ${opp.engineRecommendation?.verb0}`);
      console.log(`Review Workflow State: ${opp.reviewWorkflowState}`);
      console.log(`Base Recommendation Prose:`, opp.recommendationReason);
    } else {
      console.log(`JOB HASH ${jobHash} NOT FOUND IN listForUser!`);
    }
  }

  process.exit(0);
}

checkHeadspaceDowngrade().catch(console.error);
