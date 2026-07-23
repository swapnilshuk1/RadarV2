// scripts/verify_projections.ts

import { CandidateProjectionBuilder } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { rawOpportunities } from "../src/data/opportunity-fixtures";
import liveScraped from "../src/data/live-scraped.json";

console.log("==================================================");
console.log("RADAR PHASE 2: CANONICAL PROJECTION VERIFICATION RUNNER");
console.log("==================================================");

// 1. Build Candidate Projection
const candidateProj = CandidateProjectionBuilder.build(candidateProfile);
console.log("CANDIDATE PROJECTION:");
console.log(`  Name:             "${candidateProfile.identity.name}"`);
console.log(`  Operating Level:  ${candidateProj.operatingLevel.value} (Confidence: ${candidateProj.operatingLevel.confidence})`);
console.log(`  Work Nature:      ${candidateProj.workNature.value} (Confidence: ${candidateProj.workNature.confidence})`);
console.log(`  Decision Auth:    ${candidateProj.decisionAuthority.value} (Confidence: ${candidateProj.decisionAuthority.confidence})`);
console.log(`  Commercial Scope: ${candidateProj.commercialScope.value} (Confidence: ${candidateProj.commercialScope.confidence})`);
console.log(`  Years of Exp:     ${candidateProj.yearsOfExperience}`);
console.log(`  Locations Count:  ${candidateProj.preferredLocations.length} locations`);
console.log(`  Work Model:       ${candidateProj.preferredWorkModel}`);
console.log(`  Evidence Count:   ${candidateProj.operatingLevel.evidenceIds.length} points`);
console.log("");

// 2. Build Job Projections
const allOpportunities = [
  ...rawOpportunities,
  ...liveScraped
];

const targetJobs = [
  { label: "Synchrony L10", match: "Synchrony" },
  { label: "BMW India CMO", match: "BMW" }
];

targetJobs.forEach(({ label, match }) => {
  const found = allOpportunities.find(j => 
    j.company?.toLowerCase().includes(match.toLowerCase()) || 
    j.role?.toLowerCase().includes(match.toLowerCase())
  );

  if (found) {
    const jobProj = JobProjectionBuilder.build(found);
    console.log(`JOB PROJECTION FOR "${label}":`);
    console.log(`  Role:             "${jobProj.role}"`);
    console.log(`  Company:          "${jobProj.company}"`);
    console.log(`  Operating Level:  ${jobProj.operatingLevel.value} (Confidence: ${jobProj.operatingLevel.confidence})`);
    console.log(`  Work Nature:      ${jobProj.workNature.value} (Confidence: ${jobProj.workNature.confidence})`);
    console.log(`  Decision Auth:    ${jobProj.decisionAuthority.value} (Confidence: ${jobProj.decisionAuthority.confidence})`);
    console.log(`  Commercial Scope: ${jobProj.commercialScope.value} (Confidence: ${jobProj.commercialScope.confidence})`);
    console.log(`  Capabilities Cnt: ${jobProj.requiredCapabilities.length}`);
    console.log(`  Location:         "${jobProj.location}"`);
    console.log(`  Work Model:       ${jobProj.workModel}`);
    console.log(`  Evidence Count:   ${jobProj.operatingLevel.evidenceIds.length} points`);
    console.log("");
  } else {
    console.log(`Could not find job matching "${label}"`);
  }
});

console.log("==================================================");
console.log("PHASE 2 CANONICAL PROJECTION COMPLETED SUCCESSFULLY!");
console.log("==================================================");
