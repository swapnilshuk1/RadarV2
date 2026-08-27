import { getDatabaseAdapter } from "../src/data/database/index.js";
import { SqliteCanonicalServingStore } from "../src/data/sqlite/repositories/SqliteCanonicalServingStore.js";
import { classifyOpportunityCategories } from "../src/lib/domain/category_taxonomy.js";

async function main() {
  const db = getDatabaseAdapter();
  const store = new SqliteCanonicalServingStore(db);
  const scope = { tenantId: "tenant_default", personId: "person_swapnil" };
  
  const metrics = await store.getOpportunityMetrics(scope);
  console.log("=== AUTHORITATIVE METRICS ===");
  console.log("Total Screened:", metrics.totalScreened);
  console.log("Active Pursuits:", metrics.activePursuits);
  console.log("Total Shortlisted:", metrics.totalShortlisted);
  console.log("Engine Breakdown:", metrics.engineBreakdown);
  console.log("Category Metrics:", JSON.stringify(metrics.categoryMetrics, null, 2));
  
  const allOpps = await store.listOpportunities(scope);
  console.log("\n=== LIST OPPORTUNITIES ===");
  console.log("Total Opps from listOpportunities():", allOpps.length);
  
  const sparseByDecision = allOpps.filter(o => o.decision === "SPARSE_SPEC");
  const sparseByEngineVerdict = allOpps.filter(o => o.engineRecommendation?.engineVerdict === "SPARSE_SPEC");
  const sparseByEffective = allOpps.filter(o => o.effectiveDecision === "NOT_EVALUABLE");
  console.log("Opps with o.decision === 'SPARSE_SPEC':", sparseByDecision.length);
  console.log("Opps with o.engineRecommendation?.engineVerdict === 'SPARSE_SPEC':", sparseByEngineVerdict.length);
  console.log("Opps with o.effectiveDecision === 'NOT_EVALUABLE':", sparseByEffective.length);
  
  const needsSignalOpps = await store.listOpportunities(scope, { categoryId: "needs_more_signal" });
  console.log("Opps from listOpportunities({ categoryId: 'needs_more_signal' }):", needsSignalOpps.length);

  // Trace how each opportunity was classified for categories in getOpportunityMetrics
  let matchCount = 0;
  for (const opp of allOpps) {
    const cats = classifyOpportunityCategories({
      role: opp.role,
      evaluationStatus: (opp as any).evaluationStatus,
      recommendation: (opp as any).recommendation,
      description: opp.role,
    });
    if (cats.includes("needs_more_signal")) {
      matchCount++;
      if (matchCount <= 5) {
        console.log(`\nSample Opp matched 'needs_more_signal': ${opp.jobHash} | ${opp.role}`);
        console.log("  opp.decision:", opp.decision);
        console.log("  opp.engineRecommendation?.engineVerdict:", opp.engineRecommendation?.engineVerdict);
        console.log("  (opp as any).evaluationStatus:", (opp as any).evaluationStatus);
        console.log("  (opp as any).recommendation:", (opp as any).recommendation);
      }
    }
  }
  console.log(`\nTotal Opps where classifyOpportunityCategories matched 'needs_more_signal': ${matchCount}`);

  process.exit(0);
}

main().catch(console.error);
