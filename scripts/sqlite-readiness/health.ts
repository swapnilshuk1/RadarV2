import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function size(file: string): number {
  try { return fs.statSync(file).size; } catch { return 0; }
}

const dbPath = argument("db");
if (!dbPath || !path.isAbsolute(dbPath)) {
  throw new Error("Usage: npm run sqlite:health -- --db=<absolute-candidate.sqlite> [--checkpoint=passive|truncate]");
}
if (!fs.existsSync(dbPath)) throw new Error(`SQLite database does not exist: ${dbPath}`);

const checkpoint = argument("checkpoint")?.toUpperCase();
if (checkpoint && checkpoint !== "PASSIVE" && checkpoint !== "TRUNCATE") {
  throw new Error("checkpoint must be passive or truncate");
}

const db = new Database(dbPath, { readonly: !checkpoint, timeout: 10_000 });
try {
  const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  const foreignKeyViolations = db.pragma("foreign_key_check") as unknown[];
  const report = {
    dbPath,
    pragmas: {
      journalMode: db.pragma("journal_mode", { simple: true }),
      foreignKeys: db.pragma("foreign_keys", { simple: true }),
      busyTimeout: db.pragma("busy_timeout", { simple: true }),
      synchronous: db.pragma("synchronous", { simple: true }),
    },
    integrity: integrity.map((row) => row.integrity_check),
    foreignKeyViolationCount: foreignKeyViolations.length,
    sizes: { databaseBytes: size(dbPath), walBytes: size(`${dbPath}-wal`), shmBytes: size(`${dbPath}-shm`) },
    checkpoint: checkpoint ? db.pragma(`wal_checkpoint(${checkpoint})`) : null,
  };
  console.log(JSON.stringify(report, null, 2));
  if (report.integrity.length !== 1 || report.integrity[0] !== "ok" || report.foreignKeyViolationCount !== 0) {
    process.exitCode = 1;
  }
} finally {
  db.close();
}
