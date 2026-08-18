import { syncCanonicalCandidateProjection } from "../src/lib/intelligence/candidate-sync";
import { getRepositories } from "../src/data/sqlite/provider";
import { validateCandidateProjection } from "../src/lib/domain/candidate_projection";

async function main() {
  const personId = process.argv[2] || "swapnil-shukla";
  console.log(`[sync-candidate-projection] Synchronizing canonical candidate projection for: ${personId}...`);

  const projection = await syncCanonicalCandidateProjection(personId);
  console.log(`[sync-candidate-projection] Saved canonical projection to database for ${personId}.`);
  console.log(`  - operatingLevel:`, projection.operatingLevel);
  console.log(`  - candidateSeniorityLevel:`, projection.candidateSeniorityLevel);
  console.log(`  - workNature:`, projection.workNature);
  console.log(`  - decisionAuthority:`, projection.decisionAuthority);
  console.log(`  - commercialScope:`, projection.commercialScope);
  console.log(`  - yearsOfExperience:`, projection.yearsOfExperience);
  console.log(`  - coreCapabilities:`, projection.coreCapabilities.length, "capabilities");
  console.log(`  - preferredLocations:`, projection.preferredLocations);
  console.log(`  - preferredWorkModel:`, projection.preferredWorkModel);

  const repos = getRepositories();
  const retrieved = await repos.people.getLatestProjection(personId);
  const validation = validateCandidateProjection(retrieved);
  if (!validation.valid || !retrieved) {
    console.error(`[sync-candidate-projection] Verification FAILED: retrieved projection is invalid: missing [${validation.missingFields.join(", ")}]`);
    process.exit(1);
  }

  console.log(`[sync-candidate-projection] Verification SUCCESS: ${personId} has verified canonical projection in Turso DB.`);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
