import { runEngine, readOpportunities, clearInjectedRecords, invalidateEngineCache } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "@/data/candidate-profile";
import { present } from "@/lib/intelligence/present";

invalidateEngineCache();
clearInjectedRecords();

const builder = new CandidateProjectionBuilderImpl();
const projection = builder.fromProfile(candidateProfile);
const { records } = runEngine(projection, 0);

records.forEach(r => {
  if (r.verb === "PURSUE") {
    const matchingSource = readOpportunities().find(o => o.jobHash === r.jobHash);
    if (matchingSource) {
      const p = present(matchingSource, r, projection).opportunity;
      console.log('--- PURSUE ROLE ---');
      console.log('Hash:', r.jobHash);
      console.log('Role:', matchingSource.role);
      console.log('Company:', matchingSource.company);
      console.log('Rec:', p.recommendation);
    }
  }
});
