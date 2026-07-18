import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations(dbPath: string) {
  const db = new Database(dbPath);
  
  // Ensure the migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const appliedMigrations = db.prepare("SELECT migration_name FROM _migrations").all() as { migration_name: string }[];
  const appliedSet = new Set(appliedMigrations.map(m => m.migration_name));

  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.sql') && !f.endsWith('_rollback.sql'))
    .sort();

  for (const file of files) {
    if (!appliedSet.has(file)) {
      console.log(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(__dirname, file), "utf-8");
      
      db.transaction(() => {
        db.exec(sql);
        db.prepare("INSERT INTO _migrations (migration_name) VALUES (?)").run(file);
      })();
      
      console.log(`Successfully applied ${file}`);
    }
  }
  
  console.log("Migrations up to date.");
  db.close();
}

// Allow running directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = path.resolve(process.cwd(), "radar.sqlite");
  console.log(`Running migrations against ${dbPath}`);
  runMigrations(dbPath);
}
