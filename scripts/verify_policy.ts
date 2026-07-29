// scripts/verify_policy.ts

import { CandidateProjectionBuilder } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { LifestyleAssessmentEngine } from "../src/lib/intelligence/engines/LifestyleAssessmentEngine";
import { IdentityAssessmentEngine } from "../src/lib/intelligence/engines/IdentityAssessmentEngine";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import { candidateProfile } from "../src/data/candidate-profile";
import { rawOpportunities } from "../src/data/opportunity-fixtures";
import liveScraped from "../src/data/live-scraped.json";

console.log("==================================================");
console.log("RADAR PHASE 4: DECISION POLICY ENGINE VERIFICATION RUNNER");
console.log("==================================================");

// 1. Projections
const candidateProj = CandidateProjectionBuilder.build(candidateProfile);
const allOpportunities = [...rawOpportunities, ...liveScraped];

const targets = [
  { label: "Synchrony L10", match: "Synchrony" },
  { label: "BMW India CMO", match: "BMW" }
];

targets.forEach(({ label, match }) => {
  const found = allOpportunities.find(j => 
    j.company?.toLowerCase().includes(match.toLowerCase()) || 
    j.role?.toLowerCase().includes(match.toLowerCase())
  );

  if (found) {
    const jobProj = JobProjectionBuilder.build(found);

    // Assessments
    const identity = IdentityAssessmentEngine.evaluate(candidateProj, jobProj);
    const capability = CapabilityAssessmentEngine.evaluate(candidateProj, jobProj);
    const opportunity = OpportunityAssessmentEngine.evaluate(candidateProj, jobProj);
    const career = CareerAssessmentEngine.evaluate(candidateProj, jobProj);
    const lifestyle = LifestyleAssessmentEngine.evaluate(candidateProj, jobProj);

    // Policy Decision
    const policyResult = DecisionPolicyEngine.evaluate(identity, capability, opportunity, career, lifestyle);

    console.log(`POLICY DECISION FOR "${label}":`);
    console.log(`  Role:                 "${jobProj.role}"`);
    console.log(`  Company:              "${jobProj.company}"`);
    console.log("");
    console.log(`  [DECISION OUTCOME]`);
    console.log(`    FINAL VERDICT:       ${policyResult.verdict}`);
    console.log(`    Triggered Rules:     ${JSON.stringify(policyResult.triggeredRuleIds)}`);
    console.log(`    Rationales:`);
    policyResult.rationales.forEach((r, idx) => {
      console.log(`      - [${policyResult.triggeredRuleIds[idx]}]: ${r}`);
    });
    console.log(`    Confidence Adj:      ${policyResult.confidenceAdjustment}`);
    console.log("\n--------------------------------------------------\n");
  } else {
    console.log(`Could not find target opportunity for matching "${label}"`);
  }
});

console.log("==================================================");
console.log("PHASE 4 POLICY ENGINE VERIFICATION COMPLETED!");
console.log("==================================================");
