import { getDatabaseAdapter } from "../src/data/database/index.js";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service.js";
import { classifyOpportunityCategories, resolveCanonicalCategoryId } from "../src/lib/domain/category_taxonomy.js";

async function main() {
  const db = getDatabaseAdapter();
  const personId = "ms6i7e3y-4x0chy5fy";

  // 1. Check all candidate opportunities returned by listForUser
  const allOpps = await OpportunityService.listForUser(personId);
  console.log(`\n=== 1. ALL CANDIDATE OPPS (Total: ${allOpps.length}) ===`);

  // How many opps matched needs_more_signal in classifyOpportunityCategories during getOpportunityMetrics?
  const matchedInMetrics: any[] = [];
  for (const opp of allOpps) {
    // Exact call from SqliteCanonicalServingStore.ts line 489
    const cats = classifyOpportunityCategories({
      role: opp.role,
      evaluationStatus: (opp as any).evaluationStatus,
      recommendation: (opp as any).recommendation,
      description: opp.role,
    });
    if (cats.includes("needs_more_signal")) {
      matchedInMetrics.push(opp);
    }
  }
  console.log(`Matched needs_more_signal in getOpportunityMetrics logic: ${matchedInMetrics.length}`);

  // Why did they match? Inspect the conditions in classifyOpportunityCategories:
  // if (o.evaluationStatus === "SPARSE_SPEC" || rec.includes("sparse") || mandate === "SPARSE_SPEC")
  let countByEvalStatus = 0;
  let countByRec = 0;
  let countByMandate = 0;
  for (const opp of matchedInMetrics) {
    const role = (opp.role || "").toLowerCase();
    const desc = (opp.role || "").toLowerCase();
    const rec = ((opp as any).recommendation || "").toLowerCase();
    const rawText = `${role} ${desc} ${rec}`;
    const mandate = ((opp as any).trueExecutiveMandate || "").toUpperCase();

    if ((opp as any).evaluationStatus === "SPARSE_SPEC") countByEvalStatus++;
    if (rec.includes("sparse")) countByRec++;
    if (mandate === "SPARSE_SPEC") countByMandate++;
  }
  console.log(`Breakdown of WHY they matched:`);
  console.log(`  evaluationStatus === 'SPARSE_SPEC': ${countByEvalStatus}`);
  console.log(`  rec.includes('sparse'): ${countByRec}`);
  console.log(`  mandate === 'SPARSE_SPEC': ${countByMandate}`);

  // Sample 5 matched in metrics
  console.log("\nSample 5 matched in metrics:");
  for (let i = 0; i < Math.min(5, matchedInMetrics.length); i++) {
    const opp = matchedInMetrics[i];
    console.log(`  Opp ${i}: ${opp.jobHash} | ${opp.role} at ${opp.company}`);
    console.log(`    opp.decision: ${opp.decision}`);
    console.log(`    opp.engineRecommendation?.engineVerdict: ${opp.engineRecommendation?.engineVerdict}`);
    console.log(`    opp.recommendationResult:`, opp.recommendationResult);
    console.log(`    (opp as any).recommendation:`, (opp as any).recommendation);
  }

  // 2. Now check what OpportunityService.listForUser(personId, { categoryId: "needs_more_signal" }) returns!
  const categoryOps = await OpportunityService.listForUser(personId, { categoryId: "needs_more_signal" });
  console.log(`\n=== 2. OPPS RETURNED WITH categoryId='needs_more_signal' (Total: ${categoryOps.length}) ===`);
  if (categoryOps.length > 0) {
    console.log("Sample 3 returned for categoryId='needs_more_signal':");
    for (let i = 0; i < Math.min(3, categoryOps.length); i++) {
      const opp = categoryOps[i];
      console.log(`  Opp ${i}: ${opp.jobHash} | ${opp.role} at ${opp.company}`);
      console.log(`    opp.decision: ${opp.decision}`);
      console.log(`    opp.engineRecommendation?.engineVerdict: ${opp.engineRecommendation?.engineVerdict}`);
    }
  }

  // 3. Now check what index.tsx does with categoryOps or allOpps when selectedCategoryId === "needs_more_signal"!
  // In index.tsx:
  // activeOps = categoryOps ?? opportunitiesList (which is allOpps)
  // remaining = activeOps.filter(o => userVerb !== 'PURSUE' && userVerb !== 'CONSIDER' && userVerb !== 'PASS' ...)
  // sparseOps = remaining.filter((o) => o.decision === "SPARSE_SPEC")
  // filteredRemaining = selectedCategoryId === "needs_more_signal" ? sparseOps : shortlistedOps;
  
  const activeOps = categoryOps;
  console.log(`\n=== 3. CLIENT INDEX.TSX SIMULATION ===`);
  console.log(`activeOps.length: ${activeOps.length}`);
  
  const sparseOpsInClient = activeOps.filter((o) => o.decision === "SPARSE_SPEC");
  console.log(`activeOps.filter(o => o.decision === 'SPARSE_SPEC'): ${sparseOpsInClient.length}`);
  
  const engineVerdictSparse = activeOps.filter((o) => o.engineRecommendation?.engineVerdict === "SPARSE_SPEC");
  console.log(`activeOps.filter(o => o.engineRecommendation?.engineVerdict === 'SPARSE_SPEC'): ${engineVerdictSparse.length}`);

  const decisionsCount: Record<string, number> = {};
  for (const o of activeOps) {
    decisionsCount[o.decision || "undefined"] = (decisionsCount[o.decision || "undefined"] || 0) + 1;
  }
  console.log("Distribution of o.decision in activeOps:", decisionsCount);

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
