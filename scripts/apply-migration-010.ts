import { getDatabaseAdapter } from "../src/data/database";
import fs from "fs";
import path from "path";

async function applyMigration() {
  console.log("Applying 010_candidate_documents_and_evidence.sql to active database...");
  const db = getDatabaseAdapter();

  const migrationPath = path.resolve(process.cwd(), "src/data/sqlite/migrations/010_candidate_documents_and_evidence.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  // Split migration statements by semicolon
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    console.log(`Executing: ${stmt.slice(0, 60)}...`);
    await db.execute(stmt);
  }

  console.log("Migration 010 applied successfully!");
}

applyMigration().catch((err) => {
  console.error("Migration 010 failed:", err);
  process.exit(1);
});
