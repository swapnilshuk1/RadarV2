import Database from "better-sqlite3";
import path from "path";
import { CrawlPlanner } from "./scraper/run/planner";

const DB_PATH = path.join(process.cwd(), ".radar", "acquisition.db");
const db = new Database(DB_PATH);

async function main() {
  const definitions = db.prepare(`SELECT * FROM search_definitions WHERE status = 'ACTIVE'`).all().map((row: any) => ({
    id: row.id,
    intentId: row.intent_id,
    portal: row.portal,
    location: row.location,
    industry: row.industry,
    isRemote: row.is_remote === 1,
    query: row.raw_query,
    status: row.status,
    priority: row.priority
  }));
  
  const strategy = { id: "strat-123", name: "Global Executive Search" };
  const budget = { id: "budget-1", maxPages: 1000, maxMinutes: 120, maxLLMTokens: 500000 };
  
  const planner = new CrawlPlanner();
  planner.generateOfflinePlan(strategy as any, "v1.0", budget as any, definitions);
}

main().catch(console.error);
