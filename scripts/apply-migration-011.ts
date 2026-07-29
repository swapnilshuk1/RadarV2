import { getDatabaseAdapter } from "../src/data/database";
import fs from "fs";
import path from "path";

async function applyMigration() {
  console.log("Applying 011_document_contents_and_intent.sql to active database...");
  const db = getDatabaseAdapter();

  const migrationPath = path.resolve(process.cwd(), "src/data/sqlite/migrations/011_document_contents_and_intent.sql");
  const sql = fs.readFileSync(migrationPath, "utf-8");

  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    console.log(`Executing: ${stmt.slice(0, 60)}...`);
    await db.execute(stmt);
  }

  console.log("Migration 011 applied successfully!");
}

applyMigration().catch((err) => {
  console.error("Migration 011 failed:", err);
  process.exit(1);
});
