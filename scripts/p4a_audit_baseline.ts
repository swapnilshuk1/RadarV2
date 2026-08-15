import fs from "fs";
import path from "path";
import type { RecommendationRecord } from "../src/lib/intelligence/record";
import { runEngine, injectFixtureRecords } from "../src/lib/intelligence/engine";
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
  const p = path.resolve(process.cwd(), "scratch/audit_records.json");
  const records: RecommendationRecord[] = JSON.parse(fs.readFileSync(p, "utf-8"));
  
  // Rerun engine for detailed extraction just to be safe or parse the existing records
  // We can just parse the existing records since `trace` contains the pipelines
  
  console.log("=========================================");
  console.log("1. OPPORTUNITY SCORE");
  console.log("=========================================\n");
  
  let oppScorePresent = 0;
  let oppScoreFallback = 0;
  let oppScoreDistribution = new Array(11).fill(0);
  
  for (const r of records) {
    const trace = r.trace as any;
    // DecisionPolicyEngine accesses `opportunityScore` via `opportunity.opportunityScore`
    // However, the `opportunity` passed is an `OpportunityAssessment`.
    // Let's see what is logged in the pipeline
    // Wait, the pipeline logs Identity, Capability, Career, Lifestyle, and Ranking.
    // It doesn't explicitly log Opportunity. 
    // Let's check `trace.factors` if it contains opportunityScore
    // Actually, `OpportunityAssessmentEngine` outputs `opportunityScore`.
  }
  
  // Instead of parsing records, let's run the engine and intercept the call to DecisionPolicyEngine
  // Wait, I can't easily intercept without changing code.
  // I can just re-evaluate OpportunityAssessmentEngine on all jobs directly.
  
  console.log("Loading live-scraped.json...");
  const dataPath = path.resolve(process.cwd(), "src/data/live-scraped.json");
  const jobs = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as OpportunitySource[];
  const candBuilder = new CandidateProjectionBuilderImpl();
  const candProj = candBuilder.fromProfile(candidateProfile);
  
  let oppScores: number[] = [];
  let fallbackCount = 0;
  let trueOppScoreCount = 0;
  
  let idDistances: number[] = [];
  let idCoverages: number[] = [];
  let idScores: number[] = [];
  let idScoresNonVetoed: number[] = [];
  let nonVetoedTotal = 0;
  let countIdentity100NonVetoed = 0;
  
  let representativeSamples: any[] = [];

  for (const jobSrc of jobs) {
    const jobProj = JobProjectionBuilder.build(jobSrc, candProj);
    
    // Identity
    const idAssessment = IdentityAssessmentEngine.evaluate(candProj, jobProj);
    const idDistance = 1.0 - idAssessment.coverage; // IdentityDistanceCalculator.calculate returns distance, coverage is 1 - distance
    idDistances.push(Number(idDistance.toFixed(2)));
    idCoverages.push(idAssessment.coverage);
    const idScore = Math.round(idAssessment.coverage * 100);
    idScores.push(idScore);
    
    // Capability
    const capAssessment = CapabilityAssessmentEngine.evaluate(candProj, jobProj);
    
    // Opportunity
    const oppAssessment = OpportunityAssessmentEngine.evaluate(candProj, jobProj);
    const oppObj = oppAssessment as any;
    
    if (oppObj.opportunityScore !== undefined) {
      trueOppScoreCount++;
      oppScores.push(oppObj.opportunityScore);
    } else {
      fallbackCount++;
      oppScores.push(80); // Default
    }
    
    // Career
    const carAssessment = CareerAssessmentEngine.evaluate(candProj, jobProj, oppAssessment);
    
    // Lifestyle
    const lifeAssessment = LifestyleAssessmentEngine.evaluate(candProj, jobProj);
    
    // Run DecisionPolicyEngine to get full score
    const dpe = DecisionPolicyEngine.evaluate(
      idAssessment,
      capAssessment,
      oppAssessment,
      carAssessment,
      lifeAssessment,
      jobProj.executiveIdentity?.value,
      candProj.executiveThemes?.[0],
      (jobProj.role || "") + " " + (jobProj.originalOpportunity?.description || ""),
      false, // hasStructuredEvidence
      undefined,
      undefined,
      80 // Mock SP
    );
    
    if (!dpe.vetoed) {
      nonVetoedTotal++;
      idScoresNonVetoed.push(idScore);
      if (idScore === 100) countIdentity100NonVetoed++;
      
      if (representativeSamples.length < 20) {
        representativeSamples.push({
          jobHash: jobSrc.jobHash,
          idScore,
          capScore: (capAssessment as any).evidenceState === "UNAVAILABLE" || capAssessment.sufficiency === "INSUFFICIENT" || capAssessment.overallFit === null ? 50 : Math.round((capAssessment.overallFit || 0) * 100),
          oppScore: oppObj.opportunityScore !== undefined ? oppObj.opportunityScore : 80,
          carScore: (carAssessment as any).careerScore || Math.max(0, 80 - (carAssessment.regressionScore || 0)),
          fricScore: (lifeAssessment as any).locationFrictionPenalty || 0,
          idDistance: idDistance,
          rawScore: dpe.rawScore,
          priorityScore: dpe.priorityScore
        });
      }
    }
  }
  
  let oppDistribution = new Array(11).fill(0);
  for (const s of oppScores) {
    let b = Math.floor(s / 10);
    if (b > 10) b = 10;
    if (s === 100) b = 10;
    oppDistribution[b]++;
  }
  
  console.log(`What object is passed into DecisionPolicyEngine as opportunity? -> The return value of OpportunityAssessmentEngine.evaluate()`);
  console.log(`Does it contain opportunityScore? -> Yes, OpportunityAssessmentEngine explicitly returns it.`);
  console.log(`How many records have a real opportunityScore? -> ${trueOppScoreCount}`);
  console.log(`How many invoke the || 80 fallback? -> ${fallbackCount}`);
  console.log(`Distribution of opportunity scores:`);
  for (let i = 0; i < 11; i++) {
    const label = i === 10 ? "100" : `${i * 10}-${i * 10 + 9}`;
    console.log(`  ${label.padEnd(7)}: ${oppDistribution[i]}`);
  }
  
  console.log("\n=========================================");
  console.log("2. IDENTITY SCORE");
  console.log("=========================================\n");
  
  console.log(`Identity distance distribution sample: ${idDistances.slice(0, 15).join(', ')}`);
  console.log(`Identity coverage distribution sample: ${idCoverages.slice(0, 15).join(', ')}`);
  console.log(`Identity score distribution sample (All): ${idScores.slice(0, 15).join(', ')}`);
  
  const vetoedIdScores = idScores.filter((_, i) => idScores[i] !== idScoresNonVetoed[i]); // rough proxy for vetoed
  console.log(`Identity score distinct values (All): ${Array.from(new Set(idScores)).sort((a,b)=>a-b).join(', ')}`);
  console.log(`Identity score distinct values (Non-Vetoed): ${Array.from(new Set(idScoresNonVetoed)).sort((a,b)=>a-b).join(', ')}`);
  
  console.log(`Non-vetoed total: ${nonVetoedTotal}`);
  console.log(`Non-vetoed Identity 100 count: ${countIdentity100NonVetoed} (${(countIdentity100NonVetoed/nonVetoedTotal*100).toFixed(2)}%)`);
  
  console.log("\n=========================================");
  console.log("3. RAW SCORE BASELINE");
  console.log("=========================================\n");
  
  for (const s of representativeSamples) {
    const idContrib = (0.35 * s.idScore);
    
    const capInteractionMultiplier = Math.max(0.20, 1.0 - 0.70 * s.idDistance);
    const carInteractionMultiplier = Math.max(0.30, 1.0 - 0.50 * s.idDistance);
    const effectiveCapWeight = 0.15 * capInteractionMultiplier;
    const effectiveCareerWeight = 0.30 * carInteractionMultiplier;
    
    const capContrib = effectiveCapWeight * s.capScore;
    const carContrib = effectiveCareerWeight * s.carScore;
    const oppContrib = 0.20 * s.oppScore;
    
    const rawTotal = idContrib + carContrib + oppContrib + capContrib - s.fricScore;
    
    console.log(`Job: ${s.jobHash} | Raw: ${s.rawScore} | Pri: ${s.priorityScore}`);
    console.log(`  Id: ${idContrib.toFixed(2)} (${s.idScore}*0.35) + Car: ${carContrib.toFixed(2)} (${s.carScore}*${effectiveCareerWeight.toFixed(2)}) + Opp: ${oppContrib.toFixed(2)} (${s.oppScore}*0.2) + Cap: ${capContrib.toFixed(2)} (${s.capScore}*${effectiveCapWeight.toFixed(2)}) - Fric: ${s.fricScore} = ${rawTotal.toFixed(2)}`);
  }
}

main();
