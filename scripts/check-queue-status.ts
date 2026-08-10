import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

function checkStatus() {
  const queueDbPath = path.join(process.cwd(), ".radar", "queue.db");
  const mainDbPath = path.join(process.cwd(), "radar.sqlite");

  console.log("================================================================================");
  console.log("            RADAR v2 PENDING ENRICHMENT STATUS AUDIT");
  console.log("================================================================================\n");

  if (fs.existsSync(queueDbPath)) {
    const queueDb = new Database(queueDbPath);
    const counts = queueDb.prepare(`
      SELECT status, COUNT(*) as count 
      FROM enrichment_jobs 
      GROUP BY status
    `).all() as { status: string; count: number }[];

    console.log("--- 1. Enrichment Queue (.radar/queue.db) Status Breakdown ---");
    let totalPending = 0;
    let totalComplete = 0;
    let totalRunning = 0;
    let totalFailed = 0;
    let totalRetry = 0;

    for (const row of counts) {
      console.log(`  - ${row.status.padEnd(12)} : ${row.count}`);
      if (row.status === "PENDING") totalPending += row.count;
      if (row.status === "COMPLETE") totalComplete += row.count;
      if (row.status === "RUNNING" || row.status === "LEASED") totalRunning += row.count;
      if (row.status === "FAILED") totalFailed += row.count;
      if (row.status === "RETRY") totalRetry += row.count;
    }

    const totalToProcess = totalPending + totalRetry + totalRunning;
    console.log(`\n  👉 Total Active/Pending Jobs to Process: ${totalToProcess}`);
    console.log(`  👉 Total Complete Jobs:                  ${totalComplete}`);
    console.log(`  👉 Total Failed Jobs:                    ${totalFailed}`);

    // Calculate time estimate
    // Our Gemini serial queue enforces a 4.2-second gap per job to guarantee 0 HTTP 429 errors.
    const timePerJobSec = 4.2;
    const totalSecRemaining = totalToProcess * timePerJobSec;
    const minutesRemaining = Math.floor(totalSecRemaining / 60);
    const secondsRemaining = Math.round(totalSecRemaining % 60);
    const hoursRemaining = (totalSecRemaining / 3600).toFixed(1);

    console.log("\n--- 2. Estimated Completion Time (At 4.2s Serial Queue Spacing) ---");
    console.log(`  - Time per job : ~${timePerJobSec} seconds (Strict rate-limit safety gap)`);
    console.log(`  - Estimated Time: ${minutesRemaining}m ${secondsRemaining}s (~${hoursRemaining} hours)\n`);
  } else {
    console.log("  ⚠️ Queue database (.radar/queue.db) not found.");
  }

  if (fs.existsSync(mainDbPath)) {
    const mainDb = new Database(mainDbPath);
    try {
      const oppCount = mainDb.prepare(`SELECT COUNT(*) as count FROM opportunities`).get() as { count: number };
      const docCount = mainDb.prepare(`SELECT COUNT(*) as count FROM documents`).get() as { count: number };
      console.log("--- 3. Main Database (radar.sqlite) Totals ---");
      console.log(`  - Total Opportunities in SQLite: ${oppCount.count}`);
      console.log(`  - Total Documents in SQLite:     ${docCount.count}`);
    } catch (e: any) {
      console.log(`  - SQLite Main DB inspect notice: ${e.message}`);
    }
  }

  console.log("\n================================================================================");
}

checkStatus();
