import { getDatabaseAdapter } from "../src/data/database/index";

async function detailedBreakdown() {
  const db = getDatabaseAdapter();
  const userId = "ms6i7e3y-4x0chy5fy";

  // Check columns of candidate_evaluations
  const cols = await db.many<any>("PRAGMA table_info(candidate_evaluations)");
  console.log("candidate_evaluations columns:", cols.map(c => c.name));

  // 1. Fetch all candidate evaluations with their full JSON
  const rows = await db.many<{
    job_hash: string;
    person_id: string;
    effective_decision: string;
    evaluation_json: string;
  }>(`
    SELECT 
      job_hash,
      person_id,
      effective_decision,
      evaluation_json
    FROM candidate_evaluations
    WHERE person_id = ?
  `, [userId]);

  // 2. Fetch user decisions
  const userDecisions = await db.many<{
    opportunity_id: string;
    action: string;
    reason?: string;
  }>("SELECT opportunity_id, action, reason FROM decisions WHERE person_id = ?", [userId]);

  const userDecisionMap = new Map<string, { action: string; reason?: string }>();
  userDecisions.forEach(d => {
    userDecisionMap.set(d.opportunity_id, { action: d.action.toUpperCase(), reason: d.reason });
  });

  console.log("Total evaluations fetched for Swapnil Shukla:", rows.length);
  console.log("Total user decisions recorded:", userDecisions.length);

  interface RoleSummary {
    jobHash: string;
    title: string;
    company: string;
    location: string;
    fitScore: number;
    qualityScore: number;
    category: string;
    engineVerdict: string;
    userAction: string | null;
    frictionReasons?: string[];
    headline?: string;
  }

  const pursueRoles: RoleSummary[] = [];
  const considerRoles: RoleSummary[] = [];
  const passRoles: RoleSummary[] = [];

  const categoryBreakdown: Record<string, {
    total: number;
    pursue: { total: number; reviewed: number; unreviewed: number };
    consider: { total: number; reviewed: number; unreviewed: number };
    pass: { total: number; reviewed: number; unreviewed: number };
  }> = {};

  const scoreBuckets = {
    pursue: { "90-100": 0, "80-89": 0, "70-79": 0, "60-69": 0, "<60": 0 },
    consider: { "90-100": 0, "80-89": 0, "70-79": 0, "60-69": 0, "<60": 0 },
    pass: { "90-100": 0, "80-89": 0, "70-79": 0, "60-69": 0, "<60": 0 }
  };

  rows.forEach(r => {
    let oppData: any = {};
    try {
      oppData = JSON.parse(r.evaluation_json);
    } catch {}

    const jobHash = r.job_hash;
    const userDecision = userDecisionMap.get(jobHash)?.action || null;
    const engineVerdict = (oppData.engineRecommendation?.verdict || oppData.recommendation?.verb || r.effective_decision || "PASS").toUpperCase();
    const fitScore = Number(oppData.fit_score || oppData.recommendation?.fitScore || oppData.matchScore || 0);
    const qualityScore = Number(oppData.quality_score || oppData.recommendation?.qualityScore || 0);
    const category = oppData.category || oppData.opportunity_category || "uncategorized";

    const summary: RoleSummary = {
      jobHash,
      title: oppData.canonical_title || oppData.role || "Untitled",
      company: oppData.company || "Confidential",
      location: oppData.location || "Unspecified",
      fitScore,
      qualityScore,
      category,
      engineVerdict,
      userAction: userDecision,
      frictionReasons: oppData.watch_for || oppData.risks || [],
      headline: oppData.executive_brief?.headline || oppData.recommendation?.headline
    };

    if (!categoryBreakdown[category]) {
      categoryBreakdown[category] = {
        total: 0,
        pursue: { total: 0, reviewed: 0, unreviewed: 0 },
        consider: { total: 0, reviewed: 0, unreviewed: 0 },
        pass: { total: 0, reviewed: 0, unreviewed: 0 }
      };
    }
    categoryBreakdown[category].total++;

    const isReviewed = !!userDecision;

    const bucketKey = fitScore >= 90 ? "90-100" : fitScore >= 80 ? "80-89" : fitScore >= 70 ? "70-79" : fitScore >= 60 ? "60-69" : "<60";

    if (engineVerdict === "PURSUE") {
      pursueRoles.push(summary);
      categoryBreakdown[category].pursue.total++;
      if (isReviewed) categoryBreakdown[category].pursue.reviewed++;
      else categoryBreakdown[category].pursue.unreviewed++;
      scoreBuckets.pursue[bucketKey]++;
    } else if (engineVerdict === "CONSIDER") {
      considerRoles.push(summary);
      categoryBreakdown[category].consider.total++;
      if (isReviewed) categoryBreakdown[category].consider.reviewed++;
      else categoryBreakdown[category].consider.unreviewed++;
      scoreBuckets.consider[bucketKey]++;
    } else {
      passRoles.push(summary);
      categoryBreakdown[category].pass.total++;
      if (isReviewed) categoryBreakdown[category].pass.reviewed++;
      else categoryBreakdown[category].pass.unreviewed++;
      scoreBuckets.pass[bucketKey]++;
    }
  });

  console.log("\n============================================================");
  console.log("            PURSUE VS CONSIDER DEEP DIVE AUDIT              ");
  console.log("============================================================\n");

  console.log("--- 1. OVERALL VOLUME & REVIEW SPLIT ---");
  console.log(`PURSUE  (Engine Total: ${pursueRoles.length})`);
  console.log(`  Reviewed by You    : ${pursueRoles.filter(r => r.userAction !== null).length}`);
  console.log(`    - You marked PURSUE  : ${pursueRoles.filter(r => r.userAction === "PURSUE").length}`);
  console.log(`    - You marked PASS    : ${pursueRoles.filter(r => r.userAction === "PASS").length}`);
  console.log(`    - You marked CONSIDER: ${pursueRoles.filter(r => r.userAction === "CONSIDER").length}`);
  console.log(`  Unreviewed in Queue: ${pursueRoles.filter(r => r.userAction === null).length}\n`);

  console.log(`CONSIDER (Engine Total: ${considerRoles.length})`);
  console.log(`  Reviewed by You    : ${considerRoles.filter(r => r.userAction !== null).length}`);
  console.log(`    - You marked PURSUE  : ${considerRoles.filter(r => r.userAction === "PURSUE").length}`);
  console.log(`    - You marked PASS    : ${considerRoles.filter(r => r.userAction === "PASS").length}`);
  console.log(`    - You marked CONSIDER: ${considerRoles.filter(r => r.userAction === "CONSIDER").length}`);
  console.log(`  Unreviewed in Queue: ${considerRoles.filter(r => r.userAction === null).length}\n`);

  console.log("--- 2. CATEGORY-BY-CATEGORY BREAKDOWN ---");
  console.table(Object.entries(categoryBreakdown).map(([cat, data]) => ({
    Category: cat,
    Total: data.total,
    "Pursue (Total)": data.pursue.total,
    "Pursue (Unreviewed)": data.pursue.unreviewed,
    "Pursue (Reviewed)": data.pursue.reviewed,
    "Consider (Total)": data.consider.total,
    "Consider (Unreviewed)": data.consider.unreviewed,
    "Consider (Reviewed)": data.consider.reviewed,
    "Pass (Total)": data.pass.total,
  })));

  console.log("\n--- 3. FIT SCORE DISTRIBUTION (FIT %) ---");
  console.log("PURSUE Fit Scores  :", scoreBuckets.pursue);
  console.log("CONSIDER Fit Scores:", scoreBuckets.consider);

  console.log("\n--- 4. TOP PURSUE OPPORTUNITIES SAMPLE ---");
  pursueRoles.sort((a, b) => b.fitScore - a.fitScore).slice(0, 8).forEach((r, i) => {
    console.log(`  ${i + 1}. [Fit: ${r.fitScore}% | QS: ${r.qualityScore}] ${r.title} @ ${r.company} (${r.location}) [${r.category}] -> User: ${r.userAction || "UNREVIEWED"}`);
  });

  console.log("\n--- 5. TOP CONSIDER OPPORTUNITIES SAMPLE ---");
  considerRoles.sort((a, b) => b.fitScore - a.fitScore).slice(0, 8).forEach((r, i) => {
    console.log(`  ${i + 1}. [Fit: ${r.fitScore}% | QS: ${r.qualityScore}] ${r.title} @ ${r.company} (${r.location}) [${r.category}] -> User: ${r.userAction || "UNREVIEWED"}`);
  });

  console.log("\n============================================================");
  process.exit(0);
}

detailedBreakdown().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
