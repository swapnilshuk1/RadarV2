import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

function auditDatabaseBreakup() {
  const mainDbPath = path.join(process.cwd(), "radar.sqlite");
  const queueDbPath = path.join(process.cwd(), ".radar", "queue.db");

  console.log("================================================================================");
  console.log("            RADAR v2 DATABASE & OPPORTUNITIES BREAKUP AUDIT");
  console.log("================================================================================\n");

  if (fs.existsSync(mainDbPath)) {
    const mainDb = new Database(mainDbPath);

    // Get column names for opportunities table
    const oppCols = mainDb.prepare(`PRAGMA table_info(opportunities)`).all() as { name: string }[];
    const oppColNames = oppCols.map(c => c.name);

    // 1. Total Opportunities Count
    const totalOpp = mainDb.prepare(`SELECT COUNT(*) as count FROM opportunities`).get() as { count: number };
    console.log(`📊 TOTAL CANONICAL OPPORTUNITIES IN DB: ${totalOpp.count}\n`);

    // 2. Breakup by Source Portal from documents or opportunities
    console.log("--- 1. Opportunities Breakup by Portal ---");
    try {
      if (oppColNames.includes("source_portal")) {
        const portalRows = mainDb.prepare(`
          SELECT source_portal as portal, COUNT(*) as count 
          FROM opportunities 
          GROUP BY source_portal 
          ORDER BY count DESC
        `).all() as { portal: string; count: number }[];
        for (const row of portalRows) {
          console.log(`  - ${(row.portal || 'Unknown').padEnd(15)} : ${row.count}`);
        }
      } else {
        const portalRows = mainDb.prepare(`
          SELECT 
            CASE 
              WHEN raw_url LIKE '%naukri.com%' THEN 'Naukri'
              WHEN raw_url LIKE '%linkedin.com%' THEN 'LinkedIn'
              WHEN raw_url LIKE '%indeed.com%' THEN 'Indeed'
              ELSE 'Other / Direct'
            END as portal,
            COUNT(*) as count
          FROM documents
          GROUP BY portal
          ORDER BY count DESC
        `).all() as { portal: string; count: number }[];
        for (const row of portalRows) {
          console.log(`  - ${row.portal.padEnd(15)} : ${row.count}`);
        }
      }
    } catch (e: any) {
      console.log(`  Query notice: ${e.message}`);
    }

    // 3. Breakup by Executive Decision Action
    console.log("\n--- 2. Executive Decision Status Breakup ---");
    try {
      const decisionRows = mainDb.prepare(`
        SELECT COALESCE(action, 'UNDECIDED') as action, COUNT(*) as count 
        FROM opportunities o
        LEFT JOIN decisions d ON o.id = d.opportunity_id
        GROUP BY d.action
        ORDER BY count DESC
      `).all() as { action: string; count: number }[];

      for (const row of decisionRows) {
        console.log(`  - ${row.action.padEnd(15)} : ${row.count}`);
      }
    } catch (e: any) {
      console.log(`  Query notice: ${e.message}`);
    }

    // 4. Top Target Companies
    console.log("\n--- 3. Top 10 Target Companies in Database ---");
    try {
      const companyRows = mainDb.prepare(`
        SELECT c.name, COUNT(o.id) as count
        FROM opportunities o
        JOIN companies c ON o.company_id = c.id
        GROUP BY c.name
        ORDER BY count DESC
        LIMIT 10
      `).all() as { name: string; count: number }[];

      for (const row of companyRows) {
        console.log(`  - ${row.name.padEnd(32)} : ${row.count} opportunities`);
      }
    } catch (e: any) {
      console.log(`  Query notice: ${e.message}`);
    }

    // 5. Documents & Fact Nodes
    console.log("\n--- 4. Documents & Knowledge Fact Nodes ---");
    try {
      const docTotal = mainDb.prepare(`SELECT COUNT(*) as count FROM documents`).get() as { count: number };
      console.log(`  - Total JDs / Snapshots (documents) : ${docTotal.count}`);

      const factTotal = mainDb.prepare(`SELECT COUNT(*) as count FROM facts`).get() as { count: number };
      console.log(`  - Total Evidence Fact Nodes         : ${factTotal.count}`);
    } catch (e: any) {
      console.log(`  Documents/Facts notice: ${e.message}`);
    }
  }

  if (fs.existsSync(queueDbPath)) {
    const queueDb = new Database(queueDbPath);
    console.log("\n--- 5. Enrichment Queue Pipeline (.radar/queue.db) ---");
    const qStatus = queueDb.prepare(`
      SELECT status, COUNT(*) as count 
      FROM enrichment_jobs 
      GROUP BY status
    `).all() as { status: string; count: number }[];

    let queueTotal = 0;
    for (const row of qStatus) {
      console.log(`  - ${row.status.padEnd(12)} : ${row.count}`);
      queueTotal += row.count;
    }
    console.log(`  👉 Total Ingested Scraped Jobs in Queue: ${queueTotal}`);
  }

  console.log("\n================================================================================");
}

auditDatabaseBreakup();
