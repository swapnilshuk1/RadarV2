import { getRepositories } from "../src/data/sqlite/provider.js";
import { resolveScope } from "../src/lib/intelligence/opportunity-service.js";

async function main() {
  const scope = await resolveScope("ms6i7e3y-4x0chy5fy");
  console.log("Resolved scope:", scope);
  const repos = getRepositories();
  const opps = await repos.canonicalServing.listOpportunities(scope);
  console.log("Total opps:", opps.length);

  const stateCounts: Record<string, number> = {};
  const effCounts: Record<string, number> = {};

  for (const opp of opps) {
    stateCounts[opp.evaluationState] = (stateCounts[opp.evaluationState] || 0) + 1;
    if (opp.evaluationState === "EVALUATED" || opp.evaluationState === "COMPLETE" as any) {
      const eff = (opp as any).effectiveDecision || "MISSING";
      effCounts[eff] = (effCounts[eff] || 0) + 1;
    }
  }

  console.log("EvaluationState distribution:", stateCounts);
  console.log("EffectiveDecision distribution:", effCounts);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
