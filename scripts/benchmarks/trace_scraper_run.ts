import { getDatabaseAdapter } from "../../src/data/database";

async function traceScraperRun() {
  const db = await getDatabaseAdapter();

  console.log("\n=== TRACING JOBS FROM LAST SCRAPER RUN ===");

  const sampleTitles = [
    "%Assistant Manager%",
    "%Management Consultant%",
    "%Avantor%",
    "%OPENTEXT%",
    "%Strategy & Transformation%",
    "%Service Delivery Director%",
    "%SAP Financial%",
    "%Supply Chain Analytics%",
    "%Transformer Sales%",
    "%Head - Marketing - FinTech%",
    "%Marketing Head%",
    "%Vice President APAC%",
    "%Portage Point%",
  ];

  for (const pattern of sampleTitles) {
    const rows = await db.many<any>(
      `SELECT co.id as canonical_id, co.source as source_portal, co.created_at, co.company_name as co_company,
              ov.id as version_id, ov.job_title, ov.company_name as ov_company, ov.location, ov.acquisition_quality, length(ov.raw_content) as content_length,
              me.decision, me.quality_score, me.vetoed, me.evaluation_state, me.evaluation_json
       FROM canonical_opportunities co
       JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
       LEFT JOIN materialized_evaluations me ON co.id = me.canonical_job_id
       WHERE ov.job_title LIKE ? OR co.company_name LIKE ?
       ORDER BY co.created_at DESC
       LIMIT 1`,
      [pattern, pattern]
    );

    if (rows.length > 0) {
      const job = rows[0];
      console.log("\n============================================================");
      console.log(`Job: "${job.job_title}" @ "${job.ov_company || job.co_company}" | Portal: ${job.source_portal}`);
      console.log(`Canonical ID: ${job.canonical_id} | Version ID: ${job.version_id}`);
      console.log(`Location: ${job.location} | Created: ${job.created_at} | Content Length: ${job.content_length} bytes | Quality: ${job.acquisition_quality}`);
      console.log(`Evaluation Decision: ${job.decision} | Score: ${job.quality_score} | Vetoed: ${job.vetoed} | State: ${job.evaluation_state}`);
      if (job.evaluation_json) {
        try {
          const evalData = JSON.parse(job.evaluation_json);
          console.log(`- Veto Reasons: ${JSON.stringify(evalData.vetoReasons || evalData.veto_reasons || [])}`);
          console.log(`- Dimensions Grounded: ${JSON.stringify(evalData.dimensions || evalData.jobProjection?.dimensions || {})}`);
          console.log(`- Recommendation Verdict: ${evalData.verdict || evalData.decision}`);
          console.log(`- Fit Tier: ${evalData.fitTier || evalData.fit_tier}`);
          console.log(`- Brief Headline: ${evalData.brief?.headline || evalData.explanation?.headline || 'N/A'}`);
        } catch (e) {
          console.log(`- Raw JSON preview: ${job.evaluation_json.slice(0, 200)}`);
        }
      } else {
        console.log(`- NO MATERIALIZED EVALUATION FOUND!`);
      }
    } else {
      console.log(`\nNo job found matching pattern: ${pattern}`);
    }
  }

  // Also query latest 15 jobs overall
  console.log("\n\n=== 15 MOST RECENTLY CREATED OPPORTUNITIES ===");
  const recent = await db.many<any>(
    `SELECT co.id, co.source as source_portal, co.created_at,
            ov.job_title, ov.company_name, length(ov.raw_content) as content_length,
            me.decision, me.quality_score, me.vetoed
     FROM canonical_opportunities co
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
     LEFT JOIN materialized_evaluations me ON co.id = me.canonical_job_id
     ORDER BY co.created_at DESC
     LIMIT 15`
  );
  for (const r of recent) {
    console.log(`- [${r.source_portal}] "${r.job_title}" @ ${r.company_name} | Length: ${r.content_length}b | Created: ${r.created_at} | Decision: ${r.decision} | Score: ${r.quality_score} | Vetoed: ${r.vetoed}`);
  }
}

traceScraperRun().catch(console.error);
