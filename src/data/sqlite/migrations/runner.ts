import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function getReq() {
  if (typeof window !== "undefined") return null;
  try {
    const mod = eval('require("module")');
    return mod && mod.createRequire ? mod.createRequire(import.meta.url) : null;
  } catch {
    return null;
  }
}

export function runMigrations(dbPath: string) {
  if (typeof window !== "undefined") return;

  try {
    let DatabaseConstructor: any;
    const req = getReq();
    if (!req) return;
    try {
      DatabaseConstructor = req("better-sqlite3");
    } catch {
      return;
    }

    if (!DatabaseConstructor) return;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const db = new DatabaseConstructor(dbPath);

    // Ensure the migrations table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const appliedMigrations = db.prepare("SELECT migration_name FROM _migrations").all() as { migration_name: string }[];
    const appliedSet = new Set(appliedMigrations.map((m: any) => m.migration_name));

    const files = fs
      .readdirSync(__dirname)
      .filter((f: string) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
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
  } catch (err) {
    console.error("[Database] Migration execution failed:", err);
  }
}
