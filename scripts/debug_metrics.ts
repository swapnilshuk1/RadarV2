import { getRepositories } from "../src/data/sqlite/provider.js";
import { resolveScope } from "../src/lib/intelligence/opportunity-service.js";

async function main() {
  const scope = await resolveScope("ms6i7e3y-4x0chy5fy");
  const repos = getRepositories();
  const opps = await repos.canonicalServing.listOpportunities(scope);
  console.log("Total opps from listOpportunities:", opps.length);

  let pursueCount = 0;
  let considerCount = 0;
  let totalShortlisted = 0;

  for (const opp of opps) {
    if (opp.evaluationState === "COMPLETE") {
      const eff = opp.effectiveDecision;
      if (eff === "ENGINE_PURSUIT" || eff === "USER_CONFIRMED") {
        pursueCount++;
        totalShortlisted++;
      } else if (eff === "PREFERENCE_OVERRIDE" || eff === "ENGINE_CONSIDER") {
        considerCount++;
        totalShortlisted++;
      }
    }
  }

  console.log({ pursueCount, considerCount, totalShortlisted });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
