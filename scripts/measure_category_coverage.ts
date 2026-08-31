import { getDatabaseAdapter } from "../src/data/database/index";
import { classifyOpportunityCategories, CANONICAL_CATEGORIES, CategoryId } from "../src/lib/domain/category_taxonomy";

async function measureCategoryCoverage() {
  const db = getDatabaseAdapter();
  const rows = await db.many<any>(`
    SELECT 
      spc.canonical_job_id,
      ov.job_title,
      me.evaluation_state,
      me.decision as engine_decision,
      me.evaluation_json
    FROM search_plan_candidates spc
    JOIN canonical_opportunities co ON co.id = spc.canonical_job_id
    JOIN opportunity_versions ov ON ov.id = spc.opportunity_version
    LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id
      AND me.tenant_id = spc.tenant_id
      AND me.person_id = spc.person_id
    WHERE spc.tenant_id = 'tenant_default'
      AND spc.person_id = 'ms6i7e3y-4x0chy5fy'
      AND spc.attention_decision = 'CANDIDATE'
  `);

  console.log(`Loaded ${rows.length} rows for category measurement`);

  // We test two oracles:
  // Oracle 1: What SqliteCanonicalServingStore ACTUALLY executes at lines 426-440:
  // oppPartial = { role: r.job_title, evaluationState: r.evaluation_state, recommendation: r.engine_decision, description: r.job_title }
  //
  // Oracle 2: Full classification with parsed evaluation_json (if any mandate/intent were present)

  const categories = CANONICAL_CATEGORIES.map(c => c.id).filter(id => id !== "all") as CategoryId[];

  const servingStoreResults: Record<string, number> = {};
  const sqlCandidateResults: Record<string, number> = {};
  const matches: Record<string, { exactMatches: number; falsePositives: number; falseNegatives: number }> = {};

  for (const cat of categories) {
    servingStoreResults[cat] = 0;
    sqlCandidateResults[cat] = 0;
    matches[cat] = { exactMatches: 0, falsePositives: 0, falseNegatives: 0 };
  }

  for (const r of rows) {
    // 1. Current serving store classification
    const oppPartial = {
      role: r.job_title || "",
      evaluationStatus: r.evaluation_state === "SPARSE_SPEC" ? "SPARSE_SPEC" : "COMPLETE",
      evaluationState: r.evaluation_state,
      recommendation: r.engine_decision,
      description: r.job_title || "",
    };
    const currentStoreCats = classifyOpportunityCategories(oppPartial);

    // 2. SQL Candidate matching logic (simulating SQL LIKE queries on ov.job_title & me.evaluation_state)
    const title = (r.job_title || "").toLowerCase();
    const isSparse = r.evaluation_state === "SPARSE_SPEC";

    const sqlCats: CategoryId[] = [];
    if (isSparse) sqlCats.push("needs_more_signal");
    
    // transformation:
    if (title.includes("transformation") || title.includes("turnaround") || title.includes("overhaul")) {
      sqlCats.push("transformation");
    }
    // commercial_growth:
    if (
      title.includes("commercial") || title.includes("growth") || title.includes("sales") ||
      title.includes("revenue") || title.includes("cro") || title.includes("business development") ||
      title.includes("gtm")
    ) {
      sqlCats.push("commercial_growth");
    }
    // country_leadership:
    if (
      title.includes("country manager") || title.includes("managing director") ||
      title.includes("general manager") || title.includes("vp & gm") || title.includes("president")
    ) {
      sqlCats.push("country_leadership");
    }
    // platform_digital:
    if (
      title.includes("digital") || title.includes("platform") || title.includes("product") ||
      title.includes("technology") || title.includes("cto") || title.includes("cio") || title.includes("cpo")
    ) {
      sqlCats.push("platform_digital");
    }
    // founder_led:
    if (title.includes("founder") || title.includes("bootstrapped") || title.includes("promoter")) {
      sqlCats.push("founder_led");
    }
    // private_equity:
    if (title.includes("private equity") || title.includes("pe") || title.includes("portfolio company")) {
      sqlCats.push("private_equity");
    }

    for (const cat of categories) {
      const inCurrent = currentStoreCats.includes(cat);
      const inSql = sqlCats.includes(cat);

      if (inCurrent) servingStoreResults[cat]++;
      if (inSql) sqlCandidateResults[cat]++;

      if (inCurrent && inSql) matches[cat].exactMatches++;
      else if (!inCurrent && inSql) matches[cat].falsePositives++;
      else if (inCurrent && !inSql) matches[cat].falseNegatives++;
    }
  }

  console.log("\n=== CATEGORY COMPARISON RESULTS ===");
  console.table(categories.map(cat => {
    const totalCurrent = servingStoreResults[cat];
    const totalSql = sqlCandidateResults[cat];
    const { exactMatches, falsePositives, falseNegatives } = matches[cat];
    const coverage = totalCurrent > 0 ? ((exactMatches / totalCurrent) * 100).toFixed(2) + "%" : "100.00%";
    return {
      category: cat,
      currentMatches: totalCurrent,
      sqlMatches: totalSql,
      exactMatches,
      falsePositives,
      falseNegatives,
      coverage
    };
  }));
}

measureCategoryCoverage().catch(console.error);
