import { getDatabaseAdapter } from "../src/data/database/index.js";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service.js";

async function main() {
  const db = getDatabaseAdapter();
  const users = await db.many("SELECT * FROM users");
  console.log("Users in DB:", users);

  const people = await db.many("SELECT * FROM people");
  console.log("People in DB:", people.map(p => ({ id: p.id, tenant_id: p.tenant_id, name: p.name })));

  const plans = await db.many("SELECT id, tenant_id, person_id, status FROM search_plans");
  console.log("Search plans:", plans);

  if (people.length > 0) {
    const personId = people[0].id;
    console.log(`\nTesting OpportunityService for personId=${personId}:`);
    const metrics = await OpportunityService.getMetricsForUser(personId);
    console.log("Authoritative Metrics:", {
      totalScreened: metrics.totalScreened,
      activePursuits: metrics.activePursuits,
      totalShortlisted: metrics.totalShortlisted,
      totalDecisions: metrics.totalDecisions,
      engineBreakdown: metrics.engineBreakdown,
      categoryMetrics: metrics.categoryMetrics,
    });

    const allOpps = await OpportunityService.listForUser(personId);
    console.log(`\nTotal Opps returned by listForUser: ${allOpps.length}`);
    
    const needsSignalOpps = await OpportunityService.listForUser(personId, { categoryId: "needs_more_signal" });
    console.log(`Opps returned with categoryId='needs_more_signal': ${needsSignalOpps.length}`);

    // Check individual opportunities in allOpps
    const decisionSparse = allOpps.filter(o => o.decision === "SPARSE_SPEC");
    const verdictSparse = allOpps.filter(o => o.engineRecommendation?.engineVerdict === "SPARSE_SPEC");
    const effectiveSparse = allOpps.filter(o => o.effectiveDecision === "NOT_EVALUABLE");
    console.log(`Counts within allOpps:`);
    console.log(`  o.decision === 'SPARSE_SPEC': ${decisionSparse.length}`);
    console.log(`  o.engineRecommendation?.engineVerdict === 'SPARSE_SPEC': ${verdictSparse.length}`);
    console.log(`  o.effectiveDecision === 'NOT_EVALUABLE': ${effectiveSparse.length}`);
    
    // Check verdicts distribution across allOpps
    const verdicts: Record<string, number> = {};
    const decisions: Record<string, number> = {};
    const effectives: Record<string, number> = {};
    for (const o of allOpps) {
      const v = o.engineRecommendation?.engineVerdict || "NONE";
      const d = o.decision || "NONE";
      const e = o.effectiveDecision || "NONE";
      verdicts[v] = (verdicts[v] || 0) + 1;
      decisions[d] = (decisions[d] || 0) + 1;
      effectives[e] = (effectives[e] || 0) + 1;
    }
    console.log("Verdict breakdown:", verdicts);
    console.log("Decision breakdown:", decisions);
    console.log("Effective breakdown:", effectives);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
