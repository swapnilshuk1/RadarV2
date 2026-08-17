import fs from "fs";
import path from "path";
import { getRepositories } from "../src/data/sqlite/provider";
import { getDatabaseAdapter } from "../src/data/database";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function diagnose() {
  console.log("==========================================================");
  console.log("            RADAR V4 OPPORTUNITY COUNT DIAGNOSTIC         ");
  console.log("==========================================================\n");

  const repos = getRepositories();
  const db = getDatabaseAdapter();

  // 1. live-scraped.json count
  const liveScrapedPath = path.resolve(process.cwd(), "src/data/live-scraped.json");
  if (fs.existsSync(liveScrapedPath)) {
    const data = JSON.parse(fs.readFileSync(liveScrapedPath, "utf-8"));
    console.log(`1. 'src/data/live-scraped.json' count: ${Array.isArray(data) ? data.length : "Not an array"}`);
  } else {
    console.log(`1. 'src/data/live-scraped.json' NOT FOUND`);
  }

  // 2. Database Table Counts
  const oppCountRow = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunities");
  const docCountRow = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM documents");
  const evalCountRow = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM candidate_evaluations");

  console.log(`\n2. Database Table Counts:`);
  console.log(`   - 'opportunities' table row count : ${oppCountRow?.count ?? 0}`);
  console.log(`   - 'documents' table row count     : ${docCountRow?.count ?? 0}`);
  console.log(`   - 'candidate_evaluations' count   : ${evalCountRow?.count ?? 0}`);

  // 3. Distinct person_id in candidate_evaluations
  const evalPersons = await db.many<any>("SELECT person_id, COUNT(*) as eval_count FROM candidate_evaluations GROUP BY person_id");
  console.log(`\n3. Evaluations grouped by person_id:`);
  evalPersons.forEach(ep => console.log(`   - Person ID: ${ep.person_id} | Count: ${ep.eval_count}`));

  // 4. Test OpportunityService for each active person
  for (const ep of evalPersons) {
    if (ep.person_id.startsWith("test_")) continue;
    const evalsDefault = await repos.evaluations.listEvaluationsForUser(ep.person_id); // default limit 50
    const evals100 = await repos.evaluations.listEvaluationsForUser(ep.person_id, 100);
    const evalsAll = await repos.evaluations.listEvaluationsForUser(ep.person_id, 10000);
    const opps = await OpportunityService.listForUser(ep.person_id);
    console.log(`\n4. For Person ID '${ep.person_id}':`);
    console.log(`   - repos.evaluations.listEvaluationsForUser(..., default=50) : ${evalsDefault.length}`);
    console.log(`   - repos.evaluations.listEvaluationsForUser(..., 100)        : ${evals100.length}`);
    console.log(`   - repos.evaluations.listEvaluationsForUser(..., 10000)      : ${evalsAll.length}`);
    console.log(`   - OpportunityService.listForUser(...)                      : ${opps.length}`);
  }

  console.log("\n==========================================================");
}

diagnose().catch(console.error);
