import { CareerIntentModel } from "./scraper/run/career-intent";
import { SearchPlanner } from "./scraper/run/search-planner";
import path from "path";
import fs from "fs";

const profilePath = path.join(process.cwd(), "src", "data", "candidate-profile.json");
const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");
const searchPlanOutputPath = path.join(process.cwd(), "src", "data", "search-plan.json");

console.log("=== EXECUTING DYNAMIC END-TO-END SEARCH PLAN GENERATOR ===");

console.log("\n1. Running Career Intent Model over Candidate Profile...");
const intent = CareerIntentModel.extractIntent(profilePath, taxonomyPath);
console.log("   Intent Extracted:", JSON.stringify(intent, null, 2));

console.log("\n2. Executing Search Planner to map Intent + Lexicon to Search Plan...");
const searchPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);

console.log("\n3. Persisting First-Class 'Search Plan' Artifact to src/data/search-plan.json...");
fs.writeFileSync(searchPlanOutputPath, JSON.stringify(searchPlan, null, 2), "utf-8");
console.log(`   Saved successfully! Path: ${searchPlanOutputPath}`);

console.log("\n💡 Generated Hypotheses in the Search Plan:");
searchPlan.searchHypotheses.forEach((h) => {
  console.log(`\n📌 Hypothesis: ${h.name}`);
  console.log(`   Description: ${h.description}`);
  console.log(`   Queries: ${h.queries.map(q => `"${q}"`).join(", ")}`);
});

console.log("\n🔥 Top 10 Ranked Portal Queries:");
searchPlan.rankedQueries.slice(0, 10).forEach((item, idx) => {
  console.log(`${idx + 1}. "${item.query}" (Score: ${item.score.toFixed(1)})`);
});
