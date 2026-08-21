import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectCandidateProfileDB() {
  const db = getDatabaseAdapter();

  const people = await db.many<any>("SELECT * FROM people");
  console.log("People:", people);

  const candidateProfiles = await db.many<any>("SELECT id, person_id, tenant_id FROM candidate_profiles");
  console.log("Candidate Profiles:", candidateProfiles);
}

inspectCandidateProfileDB().catch(console.error);
