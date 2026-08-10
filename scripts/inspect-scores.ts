import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { runEngine } from "../src/lib/intelligence/engine";

const builder = new CandidateProjectionBuilderImpl();
const candidateProj = builder.fromProfile(candidateProfile);
const { presented } = runEngine(candidateProj);

console.log("===============================================================================");
console.log("LIVE SHORTLIST OPPORTUNITY SCORES:");
console.log("===============================================================================");
presented.forEach((p, idx) => {
  const score = p.opportunity?.recommendationResult?.score;
  const decision = p.opportunity?.decision;
  const role = p.opportunity?.role;
  const company = p.opportunity?.company;
  console.log(`${(idx + 1).toString().padStart(2, "0")}. [Score: ${score}] [Verdict: ${decision}] ${role} @ ${company}`);
});
console.log("===============================================================================");
