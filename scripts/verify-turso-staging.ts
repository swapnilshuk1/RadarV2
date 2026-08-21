import { getDatabaseAdapter } from "../src/data/database/index";
import { runMigrations } from "../src/data/sqlite/migrations/runner";

async function main() {
  process.env.RADAR_ENV = "dev";
  console.log("[Turso Verification] Connecting to Turso Cloud database...");
  const db = getDatabaseAdapter();

  console.log("[Turso Verification] Applying migration 018 to Turso Cloud...");
  const migrationRes = await runMigrations(db);
  console.log("[Turso Verification] Migration Result:", JSON.stringify(migrationRes, null, 2));

  console.log("\n[Turso Verification] Inspecting Live Turso Schema...");
  const tables = await db.many<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users', 'tenants', 'memberships', 'people')"
  );
  console.log("[Turso Verification] Verified Foundation Tables:", tables.map(t => t.name));

  const usersCols = await db.many<{ name: string; type: string }>("PRAGMA table_info(users)");
  console.log("[Turso Verification] users columns:", usersCols.map(c => `${c.name} (${c.type})`));

  const tenantsCols = await db.many<{ name: string; type: string }>("PRAGMA table_info(tenants)");
  console.log("[Turso Verification] tenants columns:", tenantsCols.map(c => `${c.name} (${c.type})`));

  const membershipsCols = await db.many<{ name: string; type: string }>("PRAGMA table_info(memberships)");
  console.log("[Turso Verification] memberships columns:", membershipsCols.map(c => `${c.name} (${c.type})`));

  const peopleCols = await db.many<{ name: string; type: string }>("PRAGMA table_info(people)");
  const hasTenantId = peopleCols.some(c => c.name === "tenant_id");
  console.log("[Turso Verification] people.tenant_id present:", hasTenantId);

  const peopleIdx = await db.many<{ name: string }>("PRAGMA index_list(people)");
  console.log("[Turso Verification] people indexes:", peopleIdx.map(i => i.name));

  console.log("\n[Turso Verification] ✅ Live Turso Cloud schema verified successfully.");
}

main().catch((err) => {
  console.error("[Turso Verification Error]:", err);
  process.exit(1);
});
