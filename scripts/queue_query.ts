import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), ".radar", "queue.db");
const db = new Database(dbPath);
const counts = db.prepare("SELECT status, COUNT(*) as c FROM enrichment_jobs GROUP BY status").all();
let totalLeft = 0;
console.log("Enrichment Queue Status:");
counts.forEach((row: any) => {
  console.log(`- ${row.status}: ${row.c}`);
  if (row.status !== "COMPLETE" && row.status !== "FAILED") {
    totalLeft += row.c;
  }
});
console.log(`\nTotal left to enrich: ${totalLeft}`);
