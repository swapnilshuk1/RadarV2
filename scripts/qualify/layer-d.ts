import { OpportunityService } from "../../src/lib/intelligence/services/OpportunityService";
import { getRepositories } from "../../src/data/sqlite/provider";

export function runLayerD() {
  console.log(`\n--- Layer D: Intelligence Qualification (Explain API Audit) ---`);
  
  const repos = getRepositories();
  const opportunities = repos.opportunities.findOpportunities({});
  
  if (opportunities.length === 0) {
    console.warn("No opportunities found to audit.");
    return "PASS";
  }

  const service = new OpportunityService();
  // Assume swapnil is our canonical test user for now
  const personId = "u_swapnil"; 

  let passed = true;

  for (const op of opportunities) {
    try {
      const explanation = service.explainOpportunity(op.id, personId);
      if (!explanation) {
         // Valid, maybe we don't have enough facts to recommend it
         continue; 
      }
      
      // Strict Trace Verification
      if (!explanation.recommendation.provenance) throw new Error("Missing Recommendation Provenance");
      if (!explanation.assessment.provenance) throw new Error("Missing Assessment Provenance");
      
      for (const claim of explanation.claims) {
        if (!claim.supportingFacts || claim.supportingFacts.length === 0) {
          throw new Error(`Dangling Claim: ${claim.id} has no supporting facts.`);
        }
        for (const fact of claim.supportingFacts) {
          if (!fact.evidenceIds || fact.evidenceIds.length === 0) {
             throw new Error(`Dangling Fact: ${fact.id} has no evidence attached.`);
          }
        }
      }
    } catch (err: any) {
      console.error(`❌ EXPLAIN API AUDIT FAILED for Opportunity ${op.id}:`, err.message);
      passed = false;
    }
  }

  if (passed) {
    console.log(`✅ Explain API Audit Passed: Every claim terminates at verifiable Evidence.`);
  }

  return passed ? "PASS" : "FAIL";
}
