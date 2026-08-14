/**
 * P3-A Full Corpus Analysis
 * 
 * Runs the complete 1,514-opportunity corpus through the production engine
 * and analyzes Easy Trap behavior.
 */

import { runEngine } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import * as fs from "fs";

const TARGET_CASES = [
  "j-cc222b05ee62",
  "j-63144d98a1bd", 
  "j-f5873c10d6cd",
  "j-46089844ba17",
  "j-2016c3f385e0",
  "j-726da9900c1d",
  "j-87a0a5fabc3a",
  "j-2689dce59aae"
];

async function runFullCorpusAnalysis() {
  console.log("=".repeat(120));
  console.log("P3-A FULL CORPUS ANALYSIS");
  console.log("=".repeat(120));
  console.log();
  
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  
  console.log("Running engine on full corpus...");
  const startTime = Date.now();
  
  const { records } = await runEngine(projection, 0);
  
  const duration = Date.now() - startTime;
  console.log(`  Completed in ${duration}ms`);
  console.log(`  Total records: ${records.length}`);
  console.log();
  
  // Analysis 1: Decision distribution
  const distribution = {
    PURSUE: 0,
    CONSIDER: 0,
    PASS: 0,
    SPARSE_SPEC: 0
  };
  
  for (const r of records) {
    const verb = r.verb;
    if (verb in distribution) {
      distribution[verb as keyof typeof distribution]++;
    }
  }
  
  console.log("=".repeat(120));
  console.log("DECISION DISTRIBUTION");
  console.log("=".repeat(120));
  console.log();
  console.log(`PURSUE:      ${distribution.PURSUE}`);
  console.log(`CONSIDER:    ${distribution.CONSIDER}`);
  console.log(`PASS:        ${distribution.PASS}`);
  console.log(`SPARSE_SPEC: ${distribution.SPARSE_SPEC}`);
  console.log();
  
  // Analysis 2: Easy Trap conditions
  console.log("=".repeat(120));
  console.log("EASY TRAP ANALYSIS");
  console.log("=".repeat(120));
  console.log();
  console.log("Conditions: CV < 50 AND SP >= 80 AND Friction < 10 AND Initial = PURSUE");
  console.log();
  
  const easyTrapCandidates = records.filter(r => {
    const cv = r.decisionSummary?.careerValue ?? 0;
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    const friction = r.decisionSummary?.pursuitFriction ?? 0;
    
    // Check if it would be a PURSUE without Easy Trap rule
    // (we need to check if rawScore >= PURSUE threshold)
    const rawScore = r.rawScore ?? 0;
    const wouldBePursue = rawScore >= 65; // Approximate PURSUE threshold
    
    return cv < 50 && sp >= 80 && friction < 10 && wouldBePursue;
  });
  
  console.log(`Found ${easyTrapCandidates.length} opportunities matching Easy Trap pattern`);
  console.log();
  
  // Analysis 3: Easy Trap outcomes
  const downgraded = easyTrapCandidates.filter(r => r.verb === "CONSIDER");
  const notDowngraded = easyTrapCandidates.filter(r => r.verb !== "CONSIDER");
  
  console.log(`  Downgraded to CONSIDER: ${downgraded.length}`);
  console.log(`  Not downgraded: ${notDowngraded.length}`);
  console.log();
  
  if (downgraded.length > 0) {
    console.log("Downgraded cases:");
    for (const r of downgraded.slice(0, 10)) {
      console.log(`  ${r.jobHash}: CV=${r.decisionSummary?.careerValue}, SP=${r.decisionSummary?.shortlistingPotential}, Friction=${r.decisionSummary?.pursuitFriction}, RawScore=${r.rawScore}`);
    }
    if (downgraded.length > 10) {
      console.log(`  ... and ${downgraded.length - 10} more`);
    }
  }
  console.log();
  
  // Analysis 4: Target cases inspection
  console.log("=".repeat(120));
  console.log("TARGET CASES INSPECTION");
  console.log("=".repeat(120));
  console.log();
  
  for (const jobHash of TARGET_CASES) {
    const record = records.find(r => r.jobHash === jobHash);
    if (record) {
      console.log(`${jobHash}:`);
      console.log(`  Decision: ${record.verb}`);
      console.log(`  Raw Score: ${record.rawScore}`);
      console.log(`  CV: ${record.decisionSummary?.careerValue}`);
      console.log(`  SP: ${record.decisionSummary?.shortlistingPotential}`);
      console.log(`  Friction: ${record.decisionSummary?.pursuitFriction}`);
      console.log(`  Trajectory: ${record.trace?.careerValueBreakdown?.trajectory}`);
      
      // Check Easy Trap conditions
      const cv = record.decisionSummary?.careerValue ?? 0;
      const sp = record.decisionSummary?.shortlistingPotential ?? 0;
      const friction = record.decisionSummary?.pursuitFriction ?? 0;
      const rawScore = record.rawScore ?? 0;
      
      const isEasyTrap = cv < 50 && sp >= 80 && friction < 10 && rawScore >= 65;
      console.log(`  Is Easy Trap: ${isEasyTrap}`);
      
      // Check if pipeline has CareerValueProtection stage
      const hasProtection = record.trace?.pipeline?.some((p: any) => 
        p.stage === "CareerValueProtection"
      );
      console.log(`  CareerValueProtection stage: ${hasProtection ? 'YES' : 'NO'}`);
      console.log();
    } else {
      console.log(`${jobHash}: NOT FOUND in corpus`);
      console.log();
    }
  }
  
  // Analysis 5: Verify invariants
  console.log("=".repeat(120));
  console.log("INVARIANT VERIFICATION");
  console.log("=".repeat(120));
  console.log();
  
  // 5a: High CV / zero-SP PASS cases
  const highCvZeroSp = records.filter(r => {
    const cv = r.decisionSummary?.careerValue ?? 0;
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    return cv >= 70 && sp <= 10;
  });
  
  console.log(`High CV / zero-SP cases: ${highCvZeroSp.length}`);
  const highCvZeroSpPass = highCvZeroSp.filter(r => r.verb === "PASS");
  console.log(`  Still PASS: ${highCvZeroSpPass.length}/${highCvZeroSp.length}`);
  console.log();
  
  // 5b: High CV / high-friction cases
  const highCvHighFriction = records.filter(r => {
    const cv = r.decisionSummary?.careerValue ?? 0;
    const friction = r.decisionSummary?.pursuitFriction ?? 0;
    return cv >= 70 && friction >= 20;
  });
  
  console.log(`High CV / high-friction cases: ${highCvHighFriction.length}`);
  const notPass = highCvHighFriction.filter(r => r.verb !== "PASS");
  console.log(`  Not PASS (as expected): ${notPass.length}/${highCvHighFriction.length}`);
  console.log();
  
  // Analysis 6: SP consistency
  console.log("=".repeat(120));
  console.log("SP CONSISTENCY CHECK");
  console.log("=".repeat(120));
  console.log();
  
  let consistent = 0;
  let inconsistent = 0;
  
  for (const r of records) {
    const summarySP = r.decisionSummary?.shortlistingPotential;
    const traceSP = r.trace?.factors?.shortlistingPotential;
    
    if (summarySP !== undefined && traceSP !== undefined) {
      if (summarySP === traceSP) {
        consistent++;
      } else {
        inconsistent++;
        if (inconsistent <= 5) {
          console.log(`  INCONSISTENT: ${r.jobHash} - summary=${summarySP}, trace=${traceSP}`);
        }
      }
    }
  }
  
  console.log();
  console.log(`Consistent: ${consistent}`);
  console.log(`Inconsistent: ${inconsistent}`);
  console.log();
  
  // Analysis 7: Changed decisions
  console.log("=".repeat(120));
  console.log("DECISION CHANGES ANALYSIS");
  console.log("=".repeat(120));
  console.log();
  console.log("(This requires a baseline comparison - showing current state only)");
  console.log();
  
  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    totalRecords: records.length,
    distribution,
    easyTrap: {
      totalCandidates: easyTrapCandidates.length,
      downgraded: downgraded.length,
      notDowngraded: notDowngraded.length
    },
    targetCases: TARGET_CASES.map(h => {
      const r = records.find(x => x.jobHash === h);
      return {
        jobHash: h,
        found: !!r,
        verb: r?.verb,
        cv: r?.decisionSummary?.careerValue,
        sp: r?.decisionSummary?.shortlistingPotential,
        friction: r?.decisionSummary?.pursuitFriction,
        isEasyTrap: r ? (r.decisionSummary?.careerValue ?? 0) < 50 && 
                         (r.decisionSummary?.shortlistingPotential ?? 0) >= 80 && 
                         (r.decisionSummary?.pursuitFriction ?? 0) < 10 && 
                         (r.rawScore ?? 0) >= 65 : null
      };
    }),
    invariants: {
      highCvZeroSp: {
        total: highCvZeroSp.length,
        pass: highCvZeroSpPass.length
      },
      highCvHighFriction: {
        total: highCvHighFriction.length,
        notPass: notPass.length
      },
      spConsistency: {
        consistent,
        inconsistent
      }
    }
  };
  
  fs.writeFileSync("p3a-corpus-results.json", JSON.stringify(results, null, 2));
  console.log("Results saved to p3a-corpus-results.json");
  console.log();
  
  console.log("=".repeat(120));
  console.log("ANALYSIS COMPLETE");
  console.log("=".repeat(120));
}

runFullCorpusAnalysis().catch(console.error);
