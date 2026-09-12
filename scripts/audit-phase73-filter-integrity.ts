import { getDatabaseAdapter } from "../src/data/database";
import { SqliteEvaluationStore } from "../src/data/sqlite/repositories/SqliteEvaluationStore";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import { CANONICAL_CATEGORIES } from "../src/lib/domain/category_taxonomy";

async function main() {
  console.log("==========================================================================");
  console.log("RADAR V4 — Phase 7.3 Filter Population Integrity Audit");
  console.log("==========================================================================");

  const db = getDatabaseAdapter();
  const personId = "ms6i7e3y-4x0chy5fy"; // Active primary user
  const evalStore = new SqliteEvaluationStore(db);

  // 1. Fetch Authoritative Full Corpus Category Metrics
  const categoryMetrics = await evalStore.getCategoryMetrics(personId);
  const overallMetrics = await OpportunityService.getMetricsForUser(personId);

  console.log(`Active Person ID      : ${personId}`);
  console.log(`Total Screened Corpus : ${overallMetrics.totalScreened}`);
  console.log(`Total Shortlisted     : ${overallMetrics.totalShortlisted}`);
  console.log(`Total Active Pursuits : ${overallMetrics.activePursuits}`);
  console.log(`Total Decisions       : ${overallMetrics.totalDecisions}`);
  console.log(`Metric Integrity Status: ${overallMetrics.integrity.status}\n`);

  console.log("--------------------------------------------------------------------------");
  console.log("Canonical Category Population Matrix Across 2,231 Database Evaluations");
  console.log("--------------------------------------------------------------------------");

  for (const catDef of CANONICAL_CATEGORIES) {
    const counts = categoryMetrics[catDef.id] || { total: 0, unreviewed: 0, shortlisted: 0 };
    
    // Perform Filter-Before-Limit Retrieval Check
    const records = await evalStore.listEvaluationsForUser(personId, 50, catDef.id);

    console.log(`Category ID    : ${catDef.id.padEnd(20)} | Label: ${catDef.label.padEnd(22)}`);
    console.log(`  - Total In DB : ${counts.total}`);
    console.log(`  - Unreviewed  : ${counts.unreviewed}`);
    console.log(`  - Shortlisted : ${counts.shortlisted}`);
    console.log(`  - Retr. Count : ${records.length} (Limit 50)`);

    // Verify Invariants
    if (counts.unreviewed > counts.total) {
      throw new Error(`INVARIANT VIOLATION: Category ${catDef.id} unreviewed (${counts.unreviewed}) > total (${counts.total})`);
    }
    if (counts.shortlisted > counts.total) {
      throw new Error(`INVARIANT VIOLATION: Category ${catDef.id} shortlisted (${counts.shortlisted}) > total (${counts.total})`);
    }
    if (counts.total > overallMetrics.totalScreened) {
      throw new Error(`INVARIANT VIOLATION: Category ${catDef.id} total (${counts.total}) > totalScreened (${overallMetrics.totalScreened})`);
    }

    if (counts.total > 0 && records.length === 0) {
      throw new Error(`SILENT ZERO FAILURE: Category ${catDef.id} has ${counts.total} items in DB but listEvaluationsForUser returned 0!`);
    }

    console.log(`  - Status      : 🟢 VERIFIED CLEAN\n`);
  }

  console.log("==========================================================================");
  console.log("Phase 7.3 Filter Population Integrity Audit Completed Successfully.");
  console.log("==========================================================================");
}

main().catch((err) => {
  console.error("❌ Phase 7.3 Audit Failed:", err);
  process.exit(1);
});
