import { getDatabaseAdapter } from "../src/data/database/index.js";
import { runEngineSingle } from "../src/lib/intelligence/engine.js";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder.js";
import { candidateProfile } from "../src/data/candidate-profile.js";

async function debugStack() {
  const db = getDatabaseAdapter();
  const canonicalJobId = "24344096057a1fae134629ae9998e3b381ec80277f9859f518e385e05c87a556";
  const versionRow = await db.one<any>(
    "SELECT raw_content, job_title, company_name, location FROM opportunity_versions WHERE canonical_job_id = ?",
    [canonicalJobId]
  );

  const oppSource = {
    jobHash: canonicalJobId,
    role: versionRow.job_title,
    company: versionRow.company_name,
    location: versionRow.location,
    rawDescription: versionRow.raw_content,
    rawText: versionRow.raw_content,
  };

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  try {
    const res = runEngineSingle(canonicalJobId, projection, 0, [oppSource as any]);
    console.log("Success:", res?.record?.verb);
  } catch (err: any) {
    console.error("Stack trace:", err.stack);
  }
}

debugStack().catch(console.error);
