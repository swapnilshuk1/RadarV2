/**
 * Debug script to check why CV protection rule isn't triggering
 */

import { runEngine } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "@/data/candidate-profile";

const builder = new CandidateProjectionBuilderImpl();
const candidateProjection = builder.fromProfile(candidateProfile);

console.log("Running engine...");
const { records } = runEngine(candidateProjection, 0);
console.log(`Complete: ${records.length} records\n`);

// Find target cases
const targetCases = [
  "j-cc222b05ee62",
  "j-63144d98a1bd"
];

for (const hash of targetCases) {
  const record = records.find(r => r.jobHash === hash);
  if (!record) {
    console.log(`Case ${hash}: NOT FOUND`);
    continue;
  }

  console.log(`\n=== ${hash} ===`);
  console.log(`Decision: ${record.verb}`);
  console.log(`Priority Score: ${record.priority}`);
  console.log(`Raw Score: ${record.rawScore}`);
  console.log(`Career Value: ${record.decisionSummary?.careerValue}`);
  console.log(`Shortlisting Potential: ${record.decisionSummary?.shortlistingPotential}`);
  console.log(`Friction: ${record.decisionSummary?.pursuitFriction}`);
  console.log(`Trajectory: ${record.trace?.careerValueBreakdown?.trajectory || (record as any).careerTrajectory}`);
  console.log(`Regression Score: ${(record as any).regressionScore || (record.trace as any)?.regressionScore}`);

  // Check if rule would trigger
  const sp = record.decisionSummary?.shortlistingPotential || 0;
  const friction = record.decisionSummary?.pursuitFriction || 0;
  const cv = record.decisionSummary?.careerValue || 0;
  const trajectory = record.trace?.careerValueBreakdown?.trajectory || (record as any).careerTrajectory;

  // Check capability.overallFit (used in the actual rule)
  const capabilityOverallFit = (record as any).esi || 0; // esi = overallFit
  
  console.log(`\nRule conditions:`);
  console.log(`  SP >= 80: ${sp >= 80} (SP=${sp})`);
  console.log(`  Friction <= 10: ${friction <= 10} (Friction=${friction})`);
  console.log(`  Trajectory BACKWARD OR CV <= 35: ${trajectory === "BACKWARD" || cv <= 35} (Trajectory=${trajectory}, CV=${cv})`);
  console.log(`  CV <= 50: ${cv <= 50} (CV=${cv})`);
  console.log(`  capability.overallFit >= 0.80: ${capabilityOverallFit >= 0.80} (overallFit=${capabilityOverallFit})`);

  const wouldTrigger = sp >= 80 && friction <= 10 && (trajectory === "BACKWARD" || cv <= 35) && cv <= 50;
  console.log(`\nWould rule trigger (using SP)? ${wouldTrigger}`);
  
  const wouldTriggerActual = capabilityOverallFit >= 0.80 && friction <= 10 && (trajectory === "BACKWARD" || cv <= 35) && cv <= 50;
  console.log(`Would rule trigger (using overallFit)? ${wouldTriggerActual}`);
}

// Also find any cases where rule DID trigger
console.log("\n\n=== Cases with CareerValueProtection stage ===");
const protectedCases = records.filter(r =>
  r.trace?.pipeline?.some((p: any) => p.stage === "CareerValueProtection")
);

console.log(`Found ${protectedCases.length} cases with protection stage`);
for (const r of protectedCases.slice(0, 5)) {
  console.log(`  ${r.jobHash}: ${r.verb} (CV=${r.decisionSummary?.careerValue}, SP=${r.decisionSummary?.shortlistingPotential})`);
}
