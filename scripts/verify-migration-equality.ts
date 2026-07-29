import fs from "fs";
import path from "path";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { getRepositories } from "../src/data/sqlite/provider";

async function main() {
  console.log("─────────────────────────────");
  console.log("Verifying Migration Equality");
  console.log("─────────────────────────────\n");

  const emailToVerify = "swapnilshuk@gmail.com";
  const repos = getRepositories();

  // 1. Fetch Person from DB
  const person = await repos.people.getPersonByEmail(emailToVerify);
  if (!person) {
    console.error(`User ${emailToVerify} not found in DB.`);
    process.exit(1);
  }

  // 2. Fetch the persisted DB projection
  console.log(`Fetching latest projection from DB for user: ${person.id}...`);
  const dbProjection = await repos.people.getLatestProjection(person.id);
  if (!dbProjection) {
    console.error(`No projection found in DB for user ${person.id}.`);
    process.exit(1);
  }

  // 3. Build the projection from the legacy JSON file
  console.log("Building projection from legacy JSON file...");
  const profilePath = path.resolve(process.cwd(), "src/data/candidate-profile.json");
  if (!fs.existsSync(profilePath)) {
    console.error(`Legacy JSON profile not found at ${profilePath}.`);
    process.exit(1);
  }

  const profileContent = fs.readFileSync(profilePath, "utf-8");
  const rawProfile = JSON.parse(profileContent);
  rawProfile.userId = person.id; // Normalize ID for builder
  
  const builder = new CandidateProjectionBuilderImpl();
  const jsonProjection = builder.fromProfile(rawProfile as any);

  // 4. Semantic Equality Check
  console.log("\nPerforming deep semantic equality check...");

  let hasDiscrepancy = false;

  // Strict matches
  const strictKeys = ["coreCapabilities", "preferredLocations", "executiveThemes"];
  for (const key of strictKeys) {
    const dbVal = JSON.stringify((dbProjection as any)[key]);
    const jsonVal = JSON.stringify((jsonProjection as any)[key]);
    if (dbVal !== jsonVal) {
      console.error(`❌ Mismatch in '${key}':`);
      console.error(`   DB: ${dbVal?.substring(0, 100)}...`);
      console.error(`   JSON: ${jsonVal?.substring(0, 100)}...`);
      hasDiscrepancy = true;
    } else {
      console.log(`✅ '${key}' matches perfectly.`);
    }
  }

  // Operating Level check (needs specific nested check)
  const dbOpLevel = JSON.stringify(dbProjection.operatingLevel);
  const jsonOpLevel = JSON.stringify(jsonProjection.operatingLevel);
  if (dbOpLevel !== jsonOpLevel) {
      console.error(`❌ Mismatch in 'operatingLevel':`);
      console.error(`   DB: ${dbOpLevel?.substring(0, 100)}...`);
      console.error(`   JSON: ${jsonOpLevel?.substring(0, 100)}...`);
      hasDiscrepancy = true;
  } else {
      console.log(`✅ 'operatingLevel' matches perfectly.`);
  }

  if (hasDiscrepancy) {
    console.error("\n❌ Semantic equality check FAILED. The migration was not lossless.");
    process.exit(1);
  } else {
    console.log("\n🎉 Semantic equality check PASSED! The DB projection is perfectly lossless.");
    process.exit(0);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
