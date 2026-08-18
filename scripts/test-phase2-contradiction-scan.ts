import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import { getCorpus } from "../src/data/opportunity-fixtures";

async function run() {
  const corpus = getCorpus();
  const engine = new BriefCompositionEngine();
  
  let mismatches = 0;
  for (const opp of corpus) {
    if (opp.decision === "NOT_EVALUABLE" || opp.decision === "SPARSE_SPEC") continue;
    
    // Default to the opportunity's decision as the fallback for older fixtures
    const policyVerdict = opp.engineRecommendation?.engineVerdict ?? opp.decision;
    const res = BriefCompositionEngine.compose(opp);
    const editorialRecommendation = res.memory.decision;
    
    if (policyVerdict !== editorialRecommendation) {
      mismatches++;
      console.log(`Mismatch found! Job: ${opp.role} @ ${opp.company}`);
      console.log(`  Policy Verdict: ${policyVerdict}`);
      console.log(`  Editorial Rec : ${editorialRecommendation}`);
      console.log(`  Score         : ${opp.recommendationResult?.score}`);
    }
  }
  
  if (mismatches === 0) {
    console.log("No mismatches found between policy and editorial layer!");
  } else {
    console.log(`Total mismatches: ${mismatches}`);
  }
}

run().catch(console.error);
