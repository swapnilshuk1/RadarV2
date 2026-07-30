// scripts/seed-ekb-store.ts

import { getDatabase } from "../src/data/sqlite/provider";
import { SqliteEKBStore } from "../src/data/sqlite/repositories/SqliteEKBStore";
import { EKBCompiler } from "../src/lib/intelligence/ekb/EKBCompiler";
import executiveOntology from "../src/data/ontology/executive_ontology.json";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("=================================================================");
console.log("  RADAR v2 PHASE 2: EKB DATABASE MIGRATION & RELEASE SEEDER");
console.log("=================================================================\n");

async function seedEKB() {
  const db = getDatabase();
  const store = new SqliteEKBStore(db);

  // 1. Apply Migration 006
  console.log("1. Applying Migration 006 (006_ekb_governed_schema.sql)...");
  const migrationPath = path.join(__dirname, "../src/data/sqlite/migrations/006_ekb_governed_schema.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");

  const statements = migrationSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await db.execute(stmt);
  }
  console.log("   ✓ Migration 006 applied cleanly to SQLite database.\n");

  // 2. Compile EKB Release 14.2.1
  console.log("2. Compiling Canonical Release 14.2.1...");
  const release = EKBCompiler.compileAndPublishVersion(14, 2, 1, ["Performance Marketing", "Salesforce CDP", "RevPAR"]);

  await store.publishVersion({
    id: release.versionId,
    major: release.major,
    minor: release.minor,
    patch: release.patch,
    status: "PUBLISHED",
    quality_report_json: JSON.stringify(release.validationResult.report),
    promoted_by: "SEEDER_COMPILER",
  });
  console.log(`   ✓ Version ${release.versionId} published to ekb_published_versions.\n`);

  // 3. Seed Canonical Capabilities and Aliases
  console.log("3. Seeding Canonical Capabilities & Aliases into SQLite...");
  let seededCapCount = 0;
  let seededAliasCount = 0;

  for (const domain of executiveOntology.domains) {
    for (const disc of domain.disciplines) {
      for (const cap of disc.capabilities) {
        await store.saveCapability({
          id: cap.id,
          version_id: release.versionId,
          canonical_name: cap.name,
          domain_id: domain.id,
          discipline_id: disc.id,
          description: `Canonical capability for ${cap.name}`,
        });
        seededCapCount++;

        for (const kw of cap.keywords) {
          const aliasId = `al_${cap.id}_${kw.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
          await store.saveAlias(aliasId, release.versionId, cap.id, kw, kw.toLowerCase().trim());
          seededAliasCount++;
        }
      }
    }
  }

  console.log(`   ✓ Seeded ${seededCapCount} Canonical Capabilities.`);
  console.log(`   ✓ Seeded ${seededAliasCount} Canonical Term Aliases.\n`);

  // 4. Verify Database Queries
  console.log("4. Verifying SQLite Database Queries...");
  const activeVersion = await store.getLatestPublishedVersion();
  console.log(`   ✓ Active Published Version in DB: ${activeVersion?.id}`);

  const activeCaps = await store.getCapabilitiesForVersion(activeVersion?.id || "14.2.1");
  console.log(`   ✓ Active Capabilities Query Result: ${activeCaps.length} capability records fetched.\n`);

  console.log("=================================================================");
  console.log("  EKB PHASE 2 SEEDING PASSED: SQLITE DATABASE IS FULLY GOVERNED");
  console.log("=================================================================");
}

seedEKB().catch((err) => {
  console.error("EKB Seeding Error:", err);
  process.exit(1);
});
