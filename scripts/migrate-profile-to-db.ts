import fs from "fs";
import path from "path";
import { getRepositories } from "../src/data/sqlite/provider";
import type { CandidateProfile } from "../src/domain/candidate";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";

async function main() {
  const repos = getRepositories();
  const profilePath = path.join(process.cwd(), "src/data/candidate-profile.json");
  
  if (!fs.existsSync(profilePath)) {
    console.error(`Profile file not found at ${profilePath}`);
    process.exit(1);
  }
  
  console.log(`Loading profile from ${profilePath}...`);
  const profileContent = fs.readFileSync(profilePath, "utf-8");
  const profile: CandidateProfile = JSON.parse(profileContent);
  
  const emailToMigrate = "swapnilshuk@gmail.com";
  const person = await repos.people.getPersonByEmail(emailToMigrate);
  
  if (!person) {
    console.error(`User with email ${emailToMigrate} not found in DB! Please log in first to create the account.`);
    process.exit(1);
  }
  
  // Assign the actual DB person ID to the profile
  profile.userId = person.id;
  
  console.log("Building CandidateProjection...");
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(profile);

  console.log(`Saving projection to database for user: ${profile.userId}...`);
  await repos.people.saveProjection(person.id, projection);
  
  console.log("Profile migration to database complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
