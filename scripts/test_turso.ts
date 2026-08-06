import { createClient } from "@libsql/client";
import fs from "node:fs";

// Simple .env parser
const envContent = fs.readFileSync("/home/ubuntu/radar-local-v2/.env", "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = val;
  }
}

console.log("Parsed TURSO_CONNECTION_URL:");
console.log(JSON.stringify(process.env.TURSO_CONNECTION_URL));

if (!process.env.TURSO_CONNECTION_URL) {
  console.error("TURSO_CONNECTION_URL is missing!");
  process.exit(1);
}

const client = createClient({
  url: process.env.TURSO_CONNECTION_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function main() {
  const res = await client.execute("SELECT 1 AS test");
  console.log("--- EMPIRICAL TURSO CONNECTION SUCCESS ---");
  console.log("QueryResult:", res.rows);
}

main().catch((err) => {
  console.error("--- EMPIRICAL TURSO CONNECTION FAILURE ---", err);
  process.exit(1);
});
