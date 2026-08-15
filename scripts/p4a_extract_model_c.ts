import fs from "fs";
import path from "path";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import type { OpportunitySource } from "../src/data/opportunity-fixtures";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { IdentityAssessmentEngine } from "../src/lib/intelligence/engines/IdentityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { LifestyleAssessmentEngine } from "../src/lib/intelligence/engines/LifestyleAssessmentEngine";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";

async function main() {
  const dataPath = path.resolve(process.cwd(), "src/data/live-scraped.json");
  const jobs = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as OpportunitySource[];
  const candBuilder = new CandidateProjectionBuilderImpl();
  const candProj = candBuilder.fromProfile(candidateProfile);
  
  const records: any[] = [];
  
  const weightCareer = 0.30;
  const weightOpp = 0.20;
  const weightCap = 0.15;
  const sumWeights = weightCareer + weightOpp + weightCap; // 0.65
  const normCareer = weightCareer / sumWeights;
  const normOpp = weightOpp / sumWeights;
  const normCap = weightCap / sumWeights;
  
  for (const jobSrc of jobs) {
    const jobProj = JobProjectionBuilder.build(jobSrc, candProj);
    const idAssessment = IdentityAssessmentEngine.evaluate(candProj, jobProj);
    const capAssessment = CapabilityAssessmentEngine.evaluate(candProj, jobProj);
    const oppAssessment = OpportunityAssessmentEngine.evaluate(candProj, jobProj);
    const carAssessment = CareerAssessmentEngine.evaluate(candProj, jobProj, oppAssessment);
    const lifeAssessment = LifestyleAssessmentEngine.evaluate(candProj, jobProj);
    
    // Original production evaluation
    const dpe = DecisionPolicyEngine.evaluate(
      idAssessment, capAssessment, oppAssessment, carAssessment, lifeAssessment,
      jobProj.executiveIdentity?.value, candProj.executiveThemes?.[0],
      (jobProj.role || "") + " " + (jobProj.originalOpportunity?.description || ""),
      false, undefined, undefined, 80
    );
    
    const idScore = Math.round(idAssessment.coverage * 100);
    const capScore = (capAssessment as any).evidenceState === "UNAVAILABLE" || capAssessment.sufficiency === "INSUFFICIENT" || capAssessment.overallFit === null ? 50 : Math.round((capAssessment.overallFit || 0) * 100);
    const oppScore = (oppAssessment as any).opportunityScore !== undefined ? (oppAssessment as any).opportunityScore : 80;
    const carScore = (carAssessment as any).careerScore || Math.max(0, 80 - (carAssessment.regressionScore || 0));
    const fricScore = (lifeAssessment as any).locationFrictionPenalty || 0;
    const spScore = (dpe as any).shortlistingPotential || 0;
    
    // Identity ineligible check (veto on domain)
    // Looking closely at IdentityAssessmentEngine, if coverage is very low (distance >= 0.8), it's identity ineligible
    // Or we can just check if dpe.vetoReason includes "Domain" or "Identity"
    const isIdentityIneligible = dpe.vetoed && dpe.vetoReason && (dpe.vetoReason.includes("Domain") || dpe.vetoReason.toLowerCase().includes("identity"));
    
    const qualityScore = (normCareer * carScore) + (normCap * capScore) + (normOpp * oppScore);

    records.push({
      jobHash: jobSrc.jobHash,
      role: jobProj.role,
      company: jobProj.company?.name || "Unknown",
      decision: dpe.verdict,
      vetoed: dpe.vetoed,
      vetoReason: dpe.vetoReason,
      isIdentityIneligible,
      currentRawScore: dpe.rawScore,
      currentPriorityScore: dpe.priorityScore,
      careerValue: carScore,
      capabilityFit: capScore,
      opportunityScore: oppScore,
      identityScore: idScore,
      pursuitFriction: fricScore,
      shortlistingPotential: spScore,
      modelC_qualityScore: isIdentityIneligible ? null : qualityScore
    });
  }
  
  fs.writeFileSync(path.resolve(process.cwd(), "scratch/model_c_records.json"), JSON.stringify(records, null, 2));

  console.log(`Weights Renormalized:`);
  console.log(`Career: ${(normCareer * 100).toFixed(2)}%`);
  console.log(`Capability: ${(normCap * 100).toFixed(2)}%`);
  console.log(`Opportunity: ${(normOpp * 100).toFixed(2)}%`);
  console.log("Extraction complete.");
}
main();
