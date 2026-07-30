import { runEngine } from "./engine";
import { candidateProfile } from "../../data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "./builders/CandidateProjectionBuilder";

const builder = new CandidateProjectionBuilderImpl();
const projection = builder.fromProfile(candidateProfile);
const { presented, records } = runEngine(projection);
console.log(`Scored ${records.length} opportunities. Here is the distribution of verdicts and scores:`);

const counts: Record<string, number> = { PURSUE: 0, CONSIDER: 0, PASS: 0, NOT_EVALUABLE: 0 };
const scores: Record<string, number[]> = { PURSUE: [], CONSIDER: [], PASS: [], NOT_EVALUABLE: [] };

for (const r of records) {
  counts[r.verb] = (counts[r.verb] || 0) + 1;
  scores[r.verb].push(r.priority);
}

console.log("\nVERDICT COUNTS:");
console.log(JSON.stringify(counts, null, 2));

console.log("\nSCORE STATS:");
for (const verb of ["PURSUE", "CONSIDER", "PASS", "NOT_EVALUABLE"]) {
  const sList = scores[verb] || [];
  if (sList.length === 0) {
    console.log(`${verb}: No jobs`);
    continue;
  }
  const min = Math.min(...sList);
  const max = Math.max(...sList);
  const avg = Math.round(sList.reduce((a, b) => a + b, 0) / sList.length * 10) / 10;
  console.log(`${verb}: count=${sList.length}, min=${min}, max=${max}, avg=${avg}`);
}

console.log("\nSAMPLE PURSUE JOBS:");
const pursueJobs = records.filter(r => r.verb === "PURSUE").slice(0, 10);
for (const r of pursueJobs) {
  console.log(`- ${r.jobHash}: ${r.priority} | ${r.verb} | careerValue=${r.decisionSummary.careerValue} | shortlistingPotential=${r.decisionSummary.shortlistingPotential}`);
}
