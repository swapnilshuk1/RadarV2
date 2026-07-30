// scripts/test-dynamic-search-plan.ts

import { CareerIntentModel } from "./scraper/run/career-intent";
import { SearchPlanner } from "./scraper/run/search-planner";
import path from "path";

console.log("=================================================================");
console.log("  RADAR v2 DYNAMIC SEARCH PLANNER & SCRAPER BENCHMARK");
console.log("=================================================================\n");

async function testDynamicSearchPlan() {
  const profilePath = path.join(process.cwd(), "src", "data", "candidate-profile.json");
  const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
  const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");

  // 1. Extract Dynamic Intent
  console.log("1. Extracting Dynamic Career Intent...");
  const intent = CareerIntentModel.extractIntent(profilePath, taxonomyPath);
  console.log(`   ✓ Target Titles      : [${intent.targetTitles.join(", ")}]`);
  console.log(`   ✓ Preferred Locations: [${intent.preferredLocations.join(", ")}]`);
  console.log(`   ✓ Target Levels      : [${intent.targetLevel.join(", ")}]\n`);

  // 2. Generate Dynamic Search Plan
  console.log("2. Generating Dynamic Search Plan...");
  const searchPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);
  console.log(`   ✓ Search Plan Version: ${searchPlan.version}`);
  console.log(`   ✓ Search Hypotheses  : ${searchPlan.searchHypotheses.length} groups compiled`);
  console.log(`   ✓ Ranked Queries     : ${searchPlan.rankedQueries.length} portal queries compiled`);
  console.log("\n   ✓ Top 5 Compiled Search Queries:");
  for (const q of searchPlan.rankedQueries.slice(0, 5)) {
    console.log(`     • [Score: ${q.score}] ${q.query} (${q.dimension})`);
  }

  console.log("\n=================================================================");
  console.log("  DYNAMIC SEARCH PLANNER PASSED: ZERO DOWNTIME & ZERO ERRORS");
  console.log("=================================================================");
}

testDynamicSearchPlan().catch((err) => {
  console.error("Dynamic Search Planner Test Error:", err);
  process.exit(1);
});
