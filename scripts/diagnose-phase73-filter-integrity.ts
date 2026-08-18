/**
 * scripts/diagnose-phase73-filter-integrity.ts
 *
 * READ-ONLY Forensic Audit Script for Phase 7.3 Filter Population Integrity.
 */

import { getDatabaseAdapter } from "../src/data/database";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";

async function main() {
  const db = getDatabaseAdapter();

  console.log("\n============================================================");
  console.log("   RADAR V4 PHASE 7.3 — FILTER INTEGRITY FORENSIC AUDIT     ");
  console.log("============================================================\n");

  // Find active person_id in DB
  const personRows = await db.many<{ person_id: string; cnt: number }>(
    `SELECT person_id, COUNT(*) as cnt FROM candidate_evaluations GROUP BY person_id`
  );
  console.log("Distinct person_ids in candidate_evaluations:", personRows);
  const personId = personRows.find(p => p.cnt === 2231)?.person_id || personRows[0]?.person_id || "usr_exec_001";

  // 1. Total Evaluations in Corpus
  const totalEvalRow = await db.one<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM candidate_evaluations WHERE person_id = ?`,
    [personId]
  );
  const totalEval = totalEvalRow?.cnt ?? 0;

  // 2. Decisions & Review States
  const decisions = await db.many<{ opportunity_id: string; action: string }>(
    `SELECT opportunity_id, action FROM decisions WHERE person_id = ?`,
    [personId]
  );
  const decisionMap = new Map(decisions.map((d) => [d.opportunity_id, d.action]));

  // 3. Load all 2,231 evaluations with canonical title, recommendation, and job description
  const allEvals = await db.many<{
    job_hash: string;
    canonical_title: string;
    company_id: string;
    quality_score: number;
    engine_verdict: string;
    effective_decision: string;
    content: string;
    payload_type: string;
  }>(
    `SELECT 
       ce.job_hash,
       o.canonical_title,
       o.company_id,
       ce.quality_score,
       ce.engine_verdict,
       ce.effective_decision,
       d.content,
       d.payload_type
     FROM candidate_evaluations ce
     JOIN opportunities o ON ce.job_hash = o.id
     LEFT JOIN documents d ON ce.job_hash = d.opportunity_id AND d.payload_type = 'JD_CLEAN'
     WHERE ce.person_id = ?
     ORDER BY ce.quality_score DESC`,
    [personId]
  );

  console.log(`Authoritative Corpus Size for ${personId}: ${allEvals.length} evaluations (Expected ~2,231)`);
  console.log(`Total Recorded User Decisions: ${decisionMap.size}`);

  // Count unreviewed
  let unreviewedCount = 0;
  let shortlistedCount = 0; // PURSUE or CONSIDER

  // Analyze Categories across the ENTIRE corpus vs Top 100
  const categoryStats = {
    "Commercial Growth": { total: 0, unreviewed: 0, shortlisted: 0, top100: 0, outsideTop100: 0 },
    "Transformation": { total: 0, unreviewed: 0, shortlisted: 0, top100: 0, outsideTop100: 0 },
    "Country Leadership": { total: 0, unreviewed: 0, shortlisted: 0, top100: 0, outsideTop100: 0 },
    "Platform & Digital": { total: 0, unreviewed: 0, shortlisted: 0, top100: 0, outsideTop100: 0 },
    "Founder-led": { total: 0, unreviewed: 0, shortlisted: 0, top100: 0, outsideTop100: 0 },
    "Private Equity": { total: 0, unreviewed: 0, shortlisted: 0, top100: 0, outsideTop100: 0 },
    "Needs More Signal": { total: 0, unreviewed: 0, shortlisted: 0, top100: 0, outsideTop100: 0 },
  };

  // Inspect existing getCategoryTags implementation logic
  const legacyGetCategoryTags = (role: string, desc: string, rec: string, mandate?: string, intent?: string) => {
    const tags: string[] = ["All"];
    const title = (role || "").toLowerCase();
    const rawText = (role + " " + desc + " " + rec).toLowerCase();

    if (mandate === "TRANSFORMATION" || mandate === "TURNAROUND" || rawText.includes("transformation") || rawText.includes("modernize") || rawText.includes("overhaul")) {
      tags.push("Transformation");
    }
    if (intent === "ACCELERATE_GROWTH" || mandate === "COMMERCIAL_EXPANSION" || rawText.includes("scale") || rawText.includes("expansion") || rawText.includes("growth")) {
      tags.push("High Growth");
    }
    if (title.includes("digital") || title.includes("product") || title.includes("technology") || title.includes("cto") || title.includes("cio")) {
      tags.push("Digital & Product");
    }
    if (title.includes("commercial") || title.includes("revenue") || title.includes("cro") || title.includes("sales")) {
      tags.push("Commercial");
    }
    if (title.includes("operations") || title.includes("coo") || title.includes("p&l") || title.includes("general manager")) {
      tags.push("Operations");
    }
    return tags;
  };

  // Canonical Mandate Classifier
  const deriveCanonicalCategory = (role: string, company: string, desc: string, verdict: string) => {
    const opp = { role, company, description: desc, recommendation: verdict } as any;
    const jobProj = JobProjectionBuilder.build(opp);
    const mandate = jobProj.trueExecutiveMandate || "COMMERCIAL_EXPANSION";
    const intent = jobProj.executiveMission?.intent;
    const title = (role || "").toLowerCase();
    const text = (role + " " + desc).toLowerCase();

    const categories: string[] = [];

    // 1. Commercial Growth
    if (
      mandate === "COMMERCIAL_EXPANSION" ||
      intent === "ACCELERATE_GROWTH" ||
      title.includes("commercial") ||
      title.includes("growth") ||
      title.includes("sales") ||
      title.includes("revenue") ||
      title.includes("cro") ||
      title.includes("business development") ||
      text.includes("commercial growth") ||
      text.includes("revenue expansion")
    ) {
      categories.push("Commercial Growth");
    }

    // 2. Transformation
    if (
      mandate === "TRANSFORMATION" ||
      mandate === "TURNAROUND" ||
      title.includes("transformation") ||
      text.includes("digital transformation") ||
      text.includes("business turnaround")
    ) {
      categories.push("Transformation");
    }

    // 3. Country Leadership
    if (
      title.includes("country manager") ||
      title.includes("managing director") ||
      title.includes("general manager") ||
      title.includes("vp & gm") ||
      title.includes("president") ||
      mandate === "GOVERNANCE"
    ) {
      categories.push("Country Leadership");
    }

    // 4. Platform & Digital
    if (
      title.includes("digital") ||
      title.includes("platform") ||
      title.includes("product") ||
      title.includes("technology") ||
      title.includes("cto") ||
      title.includes("cio") ||
      title.includes("cpo")
    ) {
      categories.push("Platform & Digital");
    }

    // 5. Founder-led
    if (
      intent === "PROFESSIONALIZE_FOUNDER_COMPANY" ||
      text.includes("founder") ||
      text.includes("bootstrapped") ||
      text.includes("promoter")
    ) {
      categories.push("Founder-led");
    }

    // 6. Private Equity
    if (
      intent === "PREPARE_IPO" ||
      intent === "INTEGRATE_ACQUISITION" ||
      text.includes("private equity") ||
      text.includes("pe-backed") ||
      text.includes("portfolio company")
    ) {
      categories.push("Private Equity");
    }

    if (verdict === "SPARSE_SPEC") {
      categories.push("Needs More Signal");
    }

    return categories;
  };

  let legacyCommercialTagsCountInTop100 = 0;
  let legacyCommercialTagsCountTotal = 0;

  for (let i = 0; i < allEvals.length; i++) {
    const row = allEvals[i];
    const isTop100 = i < 100;

    const userDec = decisionMap.get(row.job_hash);
    const isReviewed = !!userDec;
    const effectiveDec = userDec || row.engine_verdict;

    if (!isReviewed) unreviewedCount++;
    if (effectiveDec === "PURSUE" || effectiveDec === "CONSIDER") shortlistedCount++;

    // Legacy test
    const opp = { role: row.canonical_title, description: row.content || "", recommendation: row.engine_verdict } as any;
    const jobProj = JobProjectionBuilder.build(opp);
    const legacyTags = legacyGetCategoryTags(
      row.canonical_title,
      row.content || "",
      row.engine_verdict,
      jobProj.trueExecutiveMandate,
      jobProj.executiveMission?.intent
    );

    if (legacyTags.includes("Commercial Growth")) {
      legacyCommercialTagsCountTotal++;
      if (isTop100) legacyCommercialTagsCountInTop100++;
    }

    // Derived Canonical Categories
    const canonicalCats = deriveCanonicalCategory(row.canonical_title, row.company_id, row.content || "", row.engine_verdict);

    for (const cat of canonicalCats) {
      if (cat in categoryStats) {
        const stats = categoryStats[cat as keyof typeof categoryStats];
        stats.total++;
        if (!isReviewed) stats.unreviewed++;
        if (effectiveDec === "PURSUE" || effectiveDec === "CONSIDER") stats.shortlisted++;
        if (isTop100) stats.top100++;
        else stats.outsideTop100++;
      }
    }
  }

  console.log("\n--- FORENSIC TAXONOMY MISMATCH DIAGNOSIS ---");
  console.log(`Legacy getCategoryTags() returning "Commercial Growth" in Top 100: ${legacyCommercialTagsCountInTop100}`);
  console.log(`Legacy getCategoryTags() returning "Commercial Growth" in Total Corpus: ${legacyCommercialTagsCountTotal}`);
  console.log("--> EXPLANATION: Legacy getCategoryTags() pushed 'Commercial' or 'High Growth', BUT NEVER 'Commercial Growth'!");
  console.log("--> RESULT: Asking for 'Commercial Growth' returned EXACTLY ZERO matching tags!");

  console.log("\n--- AUTHORITATIVE CATEGORY POPULATION ANALYSIS (FULL 2,231 CORPUS) ---");
  console.table(categoryStats);

  console.log("\n--- TOP-100 BOUNDED FEED vs FULL CORPUS COMPARISON ---");
  console.log(`Total Screened Corpus: ${allEvals.length}`);
  console.log(`Commercial Growth Total Corpus: ${categoryStats["Commercial Growth"].total}`);
  console.log(`Commercial Growth Unreviewed Corpus: ${categoryStats["Commercial Growth"].unreviewed}`);
  console.log(`Commercial Growth Shortlisted Corpus: ${categoryStats["Commercial Growth"].shortlisted}`);
  console.log(`Commercial Growth inside Top-100 Feed: ${categoryStats["Commercial Growth"].top100}`);
  console.log(`Commercial Growth outside Top-100 Feed: ${categoryStats["Commercial Growth"].outsideTop100}`);

  console.log("\n============================================================");
  console.log("                   DIAGNOSIS SUMMARY                        ");
  console.log("============================================================");
  console.log("ROOT CAUSE 1 (Taxonomy Mismatch): UI Filter button asks for 'Commercial Growth', while legacy getCategoryTags() returned 'Commercial' or 'High Growth'. String mismatch = 0 results.");
  console.log("ROOT CAUSE 2 (Bounded Retrieval Contamination): Category counts were computed in client memory over remaining (derived from top 100 items).");
  console.log("ROOT CAUSE 3 (Needs More Signal 0/0): Numerator sparseOps was computed over top 100 items (0), while denominator totalSparse came from global metrics (0 if no SPARSE_SPEC in top 100).");
  console.log("============================================================\n");
}

main().catch((err) => {
  console.error("Diagnostic script failed:", err);
  process.exit(1);
});
