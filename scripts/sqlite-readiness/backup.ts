import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const source = argument("source");
const out = argument("out");
if (!source || !out || !path.isAbsolute(source) || !path.isAbsolute(out)) {
  throw new Error("Usage: npm run sqlite:backup -- --source=<absolute.sqlite> --out=<absolute-backup.sqlite>");
}
if (!fs.existsSync(source)) throw new Error(`SQLite source does not exist: ${source}`);
if (fs.existsSync(out)) throw new Error(`SQLite backup destination already exists: ${out}`);
fs.mkdirSync(path.dirname(out), { recursive: true });

const db = new Database(source, { readonly: true, timeout: 10_000 });
try {
  // better-sqlite3 delegates this to SQLite's online backup API; it includes
  // committed WAL state without copying live database files by hand.
  const result = await db.backup(out);
  console.log(JSON.stringify({ source, out, result, bytes: fs.statSync(out).size }, null, 2));
} finally {
  db.close();
}
