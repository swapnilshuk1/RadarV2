/**
 * scripts/benchmarks/test_feed_rank.ts
 */
import { getDatabaseAdapter } from "../../src/data/database/index";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveScope } from "../../src/lib/intelligence/opportunity-service";

async function main() {
  const db = getDatabaseAdapter();
  const personId = "ms6i7e3y-4x0chy5fy";
  const tenantId = "tenant_default";

  const scope = await resolveScope(personId, tenantId);
  const queries = new SqliteOpportunityQueries(db);

  // Fetch 200 items from feed
  const feed = await queries.getFeed(scope, undefined, { decisionFilter: "unreviewed" }, 500);
  console.log(`Retrieved ${feed.items.length} unreviewed items from feed.`);

  const found = feed.items.find((item) => item.job_hash === "li-cmo-enterprise-001");

  if (found) {
    const rank = feed.items.indexOf(found) + 1;
    console.log(`\nFound opportunity in feed at Rank #${rank} of ${feed.items.length}:`);
    console.log(`- Role: ${found.role}`);
    console.log(`- Company: ${found.company}`);
    console.log(`- Location: ${found.location}`);
    console.log(`- Population Tier: ${found.population_tier}`);
    console.log(`- Effective Decision: ${found.effective_decision}`);
    console.log(`- Engine Verdict: ${found.engine_verdict}`);
    console.log(`- Quality Score: ${found.quality_score}`);
    console.log(`- Vetoed: ${found.vetoed}`);
  } else {
    console.log("Opportunity not in first 500 items.");
  }
}

main().catch(console.error);
