import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

function loadEnvFile(fileBasename: string) {
  const envPath = path.resolve(process.cwd(), fileBasename);
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

// Load env files
loadEnvFile(".env");
loadEnvFile(".env.local");
loadEnvFile("gemini.env");
loadEnvFile("groq.env");

const url = process.env.TURSO_CONNECTION_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("❌ Error: Missing TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN environment variables.");
  console.error("Please ensure they are defined in your .env file.");
  process.exit(1);
}

const sqlitePath = path.resolve(process.cwd(), "radar.sqlite");
if (!fs.existsSync(sqlitePath)) {
  console.error(`❌ Error: Local database file not found at ${sqlitePath}`);
  process.exit(1);
}

console.log("🚀 Starting database sync to Turso Cloud...");
console.log(`- Source: ${sqlitePath}`);
console.log(`- Target Turso URL: ${url}`);

const localDb = new Database(sqlitePath, { readonly: true });
const turso = createClient({ url, authToken });

async function sync() {
  try {
    // 1. Get all tables in local database
    const tables = localDb
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string; sql: string }[];

    console.log(`\n📋 Found ${tables.length} tables to sync: ${tables.map(t => t.name).join(", ")}`);

    // 2. Execute table schemas in Turso
    for (const table of tables) {
      if (table.sql) {
        console.log(`  └─ Ensuring schema for table: ${table.name}`);
        const safeSql = table.sql.replace(/^CREATE TABLE /i, "CREATE TABLE IF NOT EXISTS ");
        await turso.execute(safeSql);
      }
    }

    // 3. Sync table rows
    for (const table of tables) {
      const rows = localDb.prepare(`SELECT * FROM "${table.name}"`).all() as Record<string, any>[];
      if (rows.length === 0) {
        console.log(`  └─ Table ${table.name}: 0 rows (skipped)`);
        continue;
      }

      console.log(`  └─ Syncing ${rows.length} rows for table: ${table.name}...`);

      // Batch insert rows in chunks of 50
      const chunkSize = 50;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const stmts = chunk.map(row => {
          const keys = Object.keys(row);
          const cols = keys.map(k => `"${k}"`).join(", ");
          const placeholders = keys.map(() => "?").join(", ");
          const args = keys.map(k => row[k]);
          return {
            sql: `INSERT OR REPLACE INTO "${table.name}" (${cols}) VALUES (${placeholders})`,
            args
          };
        });

        await turso.batch(stmts, "write");
      }
      console.log(`     ✅ ${rows.length} rows synced for ${table.name}`);
    }

    console.log("\n🎉 Database sync completed successfully!");
  } catch (err: any) {
    console.error("\n❌ Database sync failed:", err.message);
  } finally {
    localDb.close();
  }
}

sync();
