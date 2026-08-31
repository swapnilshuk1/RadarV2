import { getDatabaseAdapter } from "../../src/data/database";
import * as fs from "fs";
import * as path from "path";

async function find39Opportunities() {
  const db = await getDatabaseAdapter();

  console.log("Querying opportunities created around 2026-08-31 13:21:00 to 13:35:00...");

  // First check if there's a run manifest or acquisition log table
  const tables = await db.many<any>(`SELECT name FROM sqlite_master WHERE type='table'`);
  console.log("Tables:", tables.map(t => t.name).filter(n => n.includes("run") || n.includes("acq") || n.includes("log") || n.includes("opp") || n.includes("cand")).join(", "));

  // Check opportunities created on 2026-08-31
  const opps = await db.many<any>(
    `SELECT co.id as canonical_id, co.source as portal, co.source_job_id, co.canonical_url, co.company_name, co.created_at,
            ov.id as version_id, ov.job_title, ov.company_name as ov_company, ov.location, ov.raw_content,
            ov.acquisition_status, ov.acquisition_quality,
            length(ov.raw_content) as raw_size,
            me.decision, me.quality_score, me.vetoed, me.evaluation_state, me.evaluation_json
     FROM canonical_opportunities co
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
     LEFT JOIN materialized_evaluations me ON co.id = me.canonical_job_id
     WHERE co.created_at >= '2026-08-31 13:20:00' AND co.created_at <= '2026-08-31 13:35:00'
     ORDER BY co.created_at ASC`
  );

  console.log(`Found ${opps.length} opportunities in that time window.`);

  if (opps.length !== 39) {
    // Check wider window
    const wider = await db.many<any>(
      `SELECT count(*) as cnt FROM canonical_opportunities WHERE created_at LIKE '2026-08-31 13:%'`
    );
    console.log(`Opportunities in 13:xx: ${wider[0].cnt}`);

    const allToday = await db.many<any>(
      `SELECT co.id, co.created_at, co.source, ov.job_title 
       FROM canonical_opportunities co 
       JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
       WHERE co.created_at >= '2026-08-31 13:00:00'
       ORDER BY co.created_at DESC`
    );
    console.log(`All created >= 13:00 today: ${allToday.length}`);
    for (const o of allToday.slice(0, 10)) {
      console.log(`- ${o.created_at} [${o.source}] ${o.job_title}`);
    }
  }

  // Also check scraper run directory for run-1788182498220
  const scraperArtifactsDir = path.resolve(process.cwd(), ".scraper-artifacts");
  if (fs.existsSync(scraperArtifactsDir)) {
    console.log("Artifacts dir exists. Scanning...");
  }
}

find39Opportunities().catch(console.error);
