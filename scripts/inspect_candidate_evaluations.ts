import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectCandidateEvaluations() {
  const db = getDatabaseAdapter();
  const allEvals = await db.many<any>("SELECT person_id, job_hash, engine_verdict, quality_score FROM candidate_evaluations");

  const counts: Record<string, number> = {
    total: allEvals.length,
    testMocks: 0,
    naukri: 0,
    indeed: 0,
    linkedin: 0,
    jPrefix: 0,
    other: 0,
  };

  for (const e of allEvals) {
    if (e.job_hash.startsWith("job_") || e.job_hash.startsWith("j-mock")) {
      counts.testMocks++;
    } else if (e.job_hash.startsWith("naukri:")) {
      counts.naukri++;
    } else if (e.job_hash.startsWith("indeed:")) {
      counts.indeed++;
    } else if (e.job_hash.startsWith("linkedin:")) {
      counts.linkedin++;
    } else if (e.job_hash.startsWith("j-")) {
      counts.jPrefix++;
    } else {
      counts.other++;
    }
  }

  console.log("Candidate Evaluations breakdown:", counts);

  // Check how many of these match canonical opportunities
  const canonicals = await db.many<any>("SELECT id, source, source_job_id FROM canonical_opportunities");
  const bySourceJobId = new Map<string, string>();
  const byPrefixedSourceJobId = new Map<string, string>();
  for (const c of canonicals) {
    bySourceJobId.set(c.source_job_id, c.id);
    byPrefixedSourceJobId.set(`${c.source}:${c.source_job_id}`, c.id);
  }

  let matchedNonTest = 0;
  let unmatchedNonTest = 0;
  const unmatchedSamples = [];
  for (const e of allEvals) {
    if (e.job_hash.startsWith("job_") || e.job_hash.startsWith("j-mock")) continue;
    const canId = bySourceJobId.get(e.job_hash) || byPrefixedSourceJobId.get(e.job_hash);
    if (canId) {
      matchedNonTest++;
    } else {
      unmatchedNonTest++;
      if (unmatchedSamples.length < 10) {
        unmatchedSamples.push(e);
      }
    }
  }

  console.log({
    nonTestEvaluations: allEvals.length - counts.testMocks,
    matchedNonTest,
    unmatchedNonTest,
    unmatchedSamples
  });
}

inspectCandidateEvaluations().catch(console.error);
