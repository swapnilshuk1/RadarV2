import { getDatabaseAdapter } from "../src/data/database/index.js";

async function main() {
  const db = getDatabaseAdapter();

  console.log("=== STARTING FULL DATABASE HYDRATION ===");

  // Pass 1: Backfill from ALL materialized_evaluations
  console.log("\n[Pass 1] Extracting from all materialized_evaluations...");
  const meRows = await db.many<{ canonical_job_id: string; evaluation_json: string }>(
    `SELECT canonical_job_id, evaluation_json 
     FROM materialized_evaluations 
     WHERE evaluation_json IS NOT NULL`
  );

  let meCount = 0;
  for (const r of meRows) {
    if (!r.evaluation_json) continue;
    try {
      const parsed = JSON.parse(r.evaluation_json);
      const company = parsed.company || parsed.opportunity?.company || parsed.record?.company;
      if (company && company !== "Unknown" && company !== "Unknown Company" && company !== "Company not available") {
        const res = await db.execute(
          `UPDATE canonical_opportunities 
           SET company_name = ? 
           WHERE id = ? AND (company_name IS NULL OR company_name = 'Unknown' OR company_name = 'Unknown Company' OR company_name = 'Company not available')`,
          [company, r.canonical_job_id]
        );
        await db.execute(
          `UPDATE opportunity_versions 
           SET company_name = ? 
           WHERE canonical_job_id = ? AND (company_name IS NULL OR company_name = 'Unknown' OR company_name = 'Unknown Company' OR company_name = 'Company not available')`,
          [company, r.canonical_job_id]
        );
        if (res.rowsAffected > 0) meCount++;
      }
    } catch {}
  }
  console.log(`[Pass 1 Complete] Hydrated ${meCount} canonical jobs from materialized evaluations.`);

  // Pass 2: Backfill from legacy opportunities & companies table
  console.log("\n[Pass 2] Joining with legacy opportunities & companies table...");
  const legacyRows = await db.many<{ canonical_id: string; company_name: string }>(
    `SELECT co.id as canonical_id, c.name as company_name
     FROM canonical_opportunities co
     JOIN opportunities o ON o.id = co.id OR o.id = co.canonical_fingerprint
     JOIN companies c ON c.id = o.company_id
     WHERE (co.company_name IS NULL OR co.company_name = 'Unknown' OR co.company_name = 'Unknown Company' OR co.company_name = 'Company not available')
       AND c.name IS NOT NULL AND c.name != 'Unknown' AND c.name != 'Unknown Company'`
  );

  let legacyCount = 0;
  for (const r of legacyRows) {
    const res = await db.execute(
      `UPDATE canonical_opportunities SET company_name = ? WHERE id = ?`,
      [r.company_name, r.canonical_id]
    );
    await db.execute(
      `UPDATE opportunity_versions SET company_name = ? WHERE canonical_job_id = ?`,
      [r.company_name, r.canonical_id]
    );
    if (res.rowsAffected > 0) legacyCount++;
  }
  console.log(`[Pass 2 Complete] Hydrated ${legacyCount} canonical jobs from legacy opportunities & companies tables.`);

  // Pass 3: Title pattern extraction (e.g. "Royal Orchid Hotels - Chief Marketing Officer")
  console.log("\n[Pass 3] Extracting company names from title patterns...");
  const titleRows = await db.many<{ canonical_id: string; job_title: string }>(
    `SELECT co.id as canonical_id, ov.job_title
     FROM canonical_opportunities co
     JOIN opportunity_versions ov ON ov.canonical_job_id = co.id
     WHERE (co.company_name IS NULL OR co.company_name = 'Unknown' OR co.company_name = 'Unknown Company' OR co.company_name = 'Company not available')
       AND ov.job_title LIKE '% - %'`
  );

  let titleCount = 0;
  for (const r of titleRows) {
    const parts = r.job_title.split(" - ");
    if (parts.length >= 2) {
      const candidateCompany = parts[0].trim();
      const lower = candidateCompany.toLowerCase();
      // Only use if first part looks like a company name (not a generic job title prefix)
      if (
        candidateCompany.length >= 3 && 
        candidateCompany.length <= 45 &&
        !lower.startsWith("director") &&
        !lower.startsWith("vp") &&
        !lower.startsWith("vice president") &&
        !lower.startsWith("head") &&
        !lower.startsWith("lead") &&
        !lower.startsWith("senior") &&
        !lower.startsWith("chief") &&
        !lower.startsWith("manager")
      ) {
        await db.execute(
          `UPDATE canonical_opportunities SET company_name = ? WHERE id = ?`,
          [candidateCompany, r.canonical_id]
        );
        await db.execute(
          `UPDATE opportunity_versions SET company_name = ? WHERE canonical_job_id = ?`,
          [candidateCompany, r.canonical_id]
        );
        titleCount++;
      }
    }
  }
  console.log(`[Pass 3 Complete] Hydrated ${titleCount} canonical jobs from title patterns.`);

  // Final Audit
  const remainingMissing = await db.one<{ count: number }>(
    `SELECT COUNT(*) as count FROM canonical_opportunities WHERE company_name IS NULL OR company_name = 'Unknown' OR company_name = 'Unknown Company' OR company_name = 'Company not available'`
  );
  const totalCanonical = await db.one<{ count: number }>(`SELECT COUNT(*) as count FROM canonical_opportunities`);

  console.log("\n=== FINAL HYDRATION SUMMARY ===");
  console.log("Total Canonical Opportunities:", totalCanonical?.count);
  console.log("Remaining missing company names:", remainingMissing?.count);
  console.log("Hydration Rate:", `${(((totalCanonical?.count! - remainingMissing?.count!) / totalCanonical?.count!) * 100).toFixed(1)}%`);
}

main().catch(console.error);
