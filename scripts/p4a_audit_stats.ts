import fs from "fs";
import path from "path";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import type { OpportunitySource } from "../src/data/opportunity-fixtures";

async function main() {
  const dataPath = path.resolve(process.cwd(), "src/data/live-scraped.json");
  const jobs = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as OpportunitySource[];
  const candBuilder = new CandidateProjectionBuilderImpl();
  const candProj = candBuilder.fromProfile(candidateProfile);
  
  const { JobProjectionBuilder } = require("../src/lib/intelligence/builders/JobProjectionBuilder");
  const { OpportunityAssessmentEngine } = require("../src/lib/intelligence/engines/OpportunityAssessmentEngine");
  const { IdentityAssessmentEngine } = require("../src/lib/intelligence/engines/IdentityAssessmentEngine");
  const { CareerAssessmentEngine } = require("../src/lib/intelligence/engines/CareerAssessmentEngine");
  const { CapabilityAssessmentEngine } = require("../src/lib/intelligence/engines/CapabilityAssessmentEngine");
  const { LifestyleAssessmentEngine } = require("../src/lib/intelligence/engines/LifestyleAssessmentEngine");
  const { DecisionPolicyEngine } = require("../src/lib/intelligence/policy/DecisionPolicyEngine");
  
  let validRecords: any[] = [];
  
  for (const jobSrc of jobs) {
    const jobProj = JobProjectionBuilder.build(jobSrc, candProj);
    const idAssessment = IdentityAssessmentEngine.evaluate(candProj, jobProj);
    const capAssessment = CapabilityAssessmentEngine.evaluate(candProj, jobProj);
    const oppAssessment = OpportunityAssessmentEngine.evaluate(candProj, jobProj);
    const carAssessment = CareerAssessmentEngine.evaluate(candProj, jobProj, oppAssessment);
    const lifeAssessment = LifestyleAssessmentEngine.evaluate(candProj, jobProj);
    const dpe = DecisionPolicyEngine.evaluate(
      idAssessment, capAssessment, oppAssessment, carAssessment, lifeAssessment,
      jobProj.executiveIdentity?.value, candProj.executiveThemes?.[0],
      (jobProj.role || "") + " " + (jobProj.originalOpportunity?.description || ""),
      false, undefined, undefined, 80
    );
    
    if (!dpe.vetoed) {
      const idScore = Math.round(idAssessment.coverage * 100);
      const capScore = (capAssessment as any).evidenceState === "UNAVAILABLE" || capAssessment.sufficiency === "INSUFFICIENT" || capAssessment.overallFit === null ? 50 : Math.round((capAssessment.overallFit || 0) * 100);
      const oppScore = (oppAssessment as any).opportunityScore !== undefined ? (oppAssessment as any).opportunityScore : 80;
      const carScore = (carAssessment as any).careerScore || Math.max(0, 80 - (carAssessment.regressionScore || 0));
      const fricScore = (lifeAssessment as any).locationFrictionPenalty || 0;
      
      validRecords.push({
        idScore, capScore, oppScore, carScore, fricScore, rawScore: dpe.rawScore
      });
    }
  }
  
  const getStats = (arr: number[]) => {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / arr.length;
    return { min, max, avg: avg.toFixed(2), stddev: Math.sqrt(variance).toFixed(2) };
  };
  
  console.log("Valid Records:", validRecords.length);
  console.log("RawScore:", getStats(validRecords.map(r => r.rawScore)));
  console.log("IdentityScore:", getStats(validRecords.map(r => r.idScore)));
  console.log("CapabilityScore:", getStats(validRecords.map(r => r.capScore)));
  console.log("OpportunityScore:", getStats(validRecords.map(r => r.oppScore)));
  console.log("CareerScore:", getStats(validRecords.map(r => r.carScore)));
  console.log("FrictionScore:", getStats(validRecords.map(r => r.fricScore)));
  
}
main();
