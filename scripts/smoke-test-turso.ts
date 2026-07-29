import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/services/OpportunityService";

async function runSmokeTest() {
  console.log("==================================================");
  console.log("🔥 RUNNING RADAR TURSO CLOUD SMOKE TEST");
  console.log("==================================================\n");

  const adapter = getDatabaseAdapter();

  // 1. Raw Query Test
  console.log("1. Checking raw table counts in Turso Cloud...");
  const tableChecks = ["opportunities", "companies", "documents", "facts", "evidence", "_migrations"];
  for (const table of tableChecks) {
    const row = await adapter.one<{ count: number }>(`SELECT COUNT(*) as count FROM "${table}"`);
    console.log(`   └─ Table '${table}': ${row?.count ?? 0} rows`);
  }

  // 2. Repository Layer Test
  console.log("\n2. Testing Repository Layer (getRepositories)...");
  const repos = getRepositories();
  const activeOpps = await repos.opportunities.listActiveOpportunities();
  console.log(`   └─ Active Opportunities fetched: ${activeOpps.length}`);

  if (activeOpps.length > 0) {
    const sampleOpp = activeOpps[0];
    console.log(`   └─ Sample Opportunity: "${sampleOpp.canonicalTitle}" (ID: ${sampleOpp.id})`);
    
    // Fetch associated company
    const company = await repos.companies.findByName("any"); // or direct lookup
    const companyRow = await adapter.one<{ name: string }>("SELECT name FROM companies WHERE id = ?", [sampleOpp.companyId]);
    console.log(`   └─ Associated Company: "${companyRow?.name ?? "Unknown"}"`);

    // Fetch facts
    const facts = await repos.knowledge.findFactsForOpportunity(sampleOpp.id);
    console.log(`   └─ Associated Facts count: ${facts.length}`);
  }

  // 3. Application Service Layer Test
  console.log("\n3. Testing Application Service Layer (OpportunityService)...");
  const service = new OpportunityService();
  const serviceOpps = await service.getActiveOpportunities();
  console.log(`   └─ OpportunityService returned ${serviceOpps.length} active opportunities.`);

  console.log("\n==================================================");
  console.log("✅ SMOKE TEST PASSED 100%! TURSO CLOUD IS READY!");
  console.log("==================================================\n");
}

runSmokeTest().catch((err) => {
  console.error("\n❌ SMOKE TEST FAILED:", err);
  process.exit(1);
});
