// scripts/verify_assessments.ts

import { CandidateProjectionBuilder } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { LifestyleAssessmentEngine } from "../src/lib/intelligence/engines/LifestyleAssessmentEngine";
import { candidateProfile } from "../src/data/candidate-profile";
import { rawOpportunities } from "../src/data/opportunity-fixtures";
import liveScraped from "../src/data/live-scraped.json";

console.log("==================================================");
console.log("RADAR PHASE 3: ISOLATED ASSESSMENT ENGINES VERIFICATION RUNNER");
console.log("==================================================");

// 1. Build Projections
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

    // Run the isolated assessments
    const capability = CapabilityAssessmentEngine.evaluate(candidateProj, jobProj);
    const opportunity = OpportunityAssessmentEngine.evaluate(candidateProj, jobProj);
    const career = CareerAssessmentEngine.evaluate(candidateProj, jobProj);
    const lifestyle = LifestyleAssessmentEngine.evaluate(candidateProj, jobProj);

    console.log(`EVALUATIONS FOR "${label}":`);
    console.log(`  Role:                 "${jobProj.role}"`);
    console.log(`  Company:              "${jobProj.company}"`);
    console.log("");
    console.log(`  [CAPABILITY ASSESSMENT]`);
    console.log(`    Overall Fit Score:  ${(capability.overallFit * 100).toFixed(1)}%`);
    console.log(`    Matched Count:      ${capability.matchedCapabilities.length}`);
    console.log(`    Missing Count:      ${capability.missingCapabilities.length}`);
    console.log(`    Missing Items:      ${JSON.stringify(capability.missingCapabilities)}`);
    console.log("");
    console.log(`  [OPPORTUNITY ASSESSMENT]`);
    console.log(`    Operating Level:    ${opportunity.operatingLevelAssessment}`);
    console.log(`    Work Nature:        ${opportunity.workNatureAssessment}`);
    console.log(`    Commercial Scope:   ${opportunity.scopeAssessment}`);
    console.log("");
    console.log(`  [CAREER ASSESSMENT]`);
    console.log(`    Trajectory:         ${career.trajectory}`);
    console.log(`    Growth Potential:   ${career.growthPotential}`);
    console.log(`    Regression Score:   ${career.regressionScore} (out of 100)`);
    console.log("");
    console.log(`  [LIFESTYLE ASSESSMENT]`);
    console.log(`    Location Fit:       ${lifestyle.locationFit}`);
    console.log(`    Travel Fit:         ${lifestyle.travelFit}`);
    console.log(`    Schedule Fit:       ${lifestyle.scheduleFit}`);
    console.log(`    Compensation Fit:   ${lifestyle.compensationFit}`);
    console.log("\n--------------------------------------------------\n");
  } else {
    console.log(`Could not find target opportunity for matching "${label}"`);
  }
});

console.log("==================================================");
console.log("PHASE 3 ENGINES VERIFICATION RUNNER COMPLETED SUCCESSFULLY!");
console.log("==================================================");
