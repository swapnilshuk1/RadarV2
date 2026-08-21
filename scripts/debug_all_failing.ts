import { getDatabaseAdapter } from "../src/data/database/index.js";
import { runEngineSingle } from "../src/lib/intelligence/engine.js";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder.js";
import { candidateProfile } from "../src/data/candidate-profile.js";

async function debugAllFailing() {
  const db = getDatabaseAdapter();

  const jobs = await db.many<any>("SELECT id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, attempts, last_error FROM evaluation_jobs WHERE last_error IS NOT NULL OR status = 'pending'");
  console.log(`Found ${jobs.length} failing/pending jobs:`);

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  for (const job of jobs) {
    console.log(`\nTesting job: ${job.id} (canonical_job_id: ${job.canonical_job_id})`);
    const versionRow = await db.one<any>(
      "SELECT raw_content, job_title, company_name, location FROM opportunity_versions WHERE canonical_job_id = ? AND id = ?",
      [job.canonical_job_id, job.opportunity_version]
    );

    if (!versionRow) {
      console.log(`Version row missing for ${job.canonical_job_id} / ${job.opportunity_version}`);
      continue;
    }

    let oppSource: any;
    try {
      oppSource = JSON.parse(versionRow.raw_content);
    } catch {
      oppSource = {
        jobHash: job.canonical_job_id,
        role: versionRow.job_title,
        company: versionRow.company_name,
        location: versionRow.location,
        rawDescription: versionRow.raw_content,
      };
    }

    try {
      const res = runEngineSingle(oppSource.jobHash || job.canonical_job_id, projection, 0, [oppSource]);
      console.log(`Success: ${res?.record?.verb}`);
    } catch (err: any) {
      console.error(`Error for job ${job.id}:`, err.stack);
    }
  }
}

debugAllFailing().catch(console.error);
