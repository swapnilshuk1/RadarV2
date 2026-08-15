import { runEngine } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import type { 
  IdentityAssessment, 
  CapabilityAssessment, 
  OpportunityAssessment, 
  CareerAssessment, 
  LifestyleAssessment 
} from "../src/domain/semantic";

async function verifyEasyTrap() {
  console.log("\n=======================================================");
  console.log("2. VERIFY EASY TRAP STATUS FORENSICS");
  console.log("=======================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection);

  let satisfiedConditionA = 0;
  let wouldBeInitialPursueB = 0;
  let actuallyTriggeredC = 0;

  const satisfiedRecords: any[] = [];

  for (const r of records) {
    const cv = r.decisionSummary.careerValue ?? 0;
    const sp = r.decisionSummary.shortlistingPotential ?? 0;
    const friction = r.decisionSummary.pursuitFriction ?? 0;
    const quality = r.qualityScore;

    // Condition A: CV < 50, SP >= 80, Friction < 10
    if (cv < 50 && sp >= 80 && friction < 10) {
      satisfiedConditionA++;
      
      // Check initial decision (before Easy Trap check, would it be PURSUE?)
      // PURSUE threshold in current engine is qualityScore >= 70 (or priorityScore >= 70) and non-vetoed
      const isVetoed = r.vetoed ?? false;
      const initialPursue = quality !== null && quality >= 70 && !isVetoed;

      if (initialPursue) {
        wouldBeInitialPursueB++;
      }

      const triggered = (r.trace?.trace?.pipeline as any[])?.some((p: any) => p.ruleId === "R-CONSIDER-CAREER-VALUE-PROTECTION") ?? false;
      if (triggered) {
        actuallyTriggeredC++;
      }

      satisfiedRecords.push({
        jobHash: r.jobHash,
        cv,
        sp,
        friction,
        quality,
        verb: r.verb,
        vetoed: r.vetoed,
        vetoReason: r.vetoReason,
        initialPursue,
        triggered
      });
    }
  }

  console.log(`A. Opportunities satisfying CV < 50, SP >= 80, Friction < 10: ${satisfiedConditionA}`);
  console.log(`B. Of those, would produce INITIAL PURSUE before Easy Trap: ${wouldBeInitialPursueB}`);
  console.log(`C. Of those, actually triggered R-CONSIDER-CAREER-VALUE-PROTECTION: ${actuallyTriggeredC}`);

  if (satisfiedRecords.length > 0) {
    console.log("\nDetails of records satisfying Condition A:");
    for (const s of satisfiedRecords) {
      console.log(`  JobHash: ${s.jobHash}, CV: ${s.cv}, SP: ${s.sp}, Friction: ${s.friction}, Quality: ${s.quality}, Verb: ${s.verb}, Vetoed: ${s.vetoed}, VetoReason: ${s.vetoReason}, InitialPursue: ${s.initialPursue}, Triggered: ${s.triggered}`);
    }
  }

  if (actuallyTriggeredC === 0) {
    console.log("\n[D. Statement]: The Easy Trap protection rule (R-CONSIDER-CAREER-VALUE-PROTECTION) is currently dormant under the reference corpus and Model C quality score distribution.");
  }

  // E. Synthetic Fixture Case Test
  console.log("\nE. Verifying synthetic fixture case exercising Easy Trap:");
  
  const dummyIdentity: IdentityAssessment = {
    status: "EVALUATED",
    verdict: "MATCH",
    coverage: 0.95,
    vectorSimilarity: 0.95,
    evidenceCount: 5
  };
  const dummyCapability: CapabilityAssessment = {
    status: "EVALUATED",
    sufficiency: "SUFFICIENT",
    overallFit: 0.90, // Cap = 90
    matchingConfidence: 0.90,
    evidenceCount: 6,
    matchedCapabilities: ["P&L"],
    missingCapabilities: []
  };
  const dummyOpportunity: OpportunityAssessment = {
    status: "EVALUATED",
    mandateSeniority: "EXECUTIVE",
    opportunityScore: 90 // Opp = 90
  };
  const easyTrapCareer: CareerAssessment = {
    status: "EVALUATED",
    trajectory: "FORWARD",
    careerScore: 40, // CV = 40 (< 50)
    regressionScore: 10
  };
  const dummyLifestyle: LifestyleAssessment = {
    status: "EVALUATED",
    locationFrictionPenalty: 2 // Friction = 2 (< 10)
  };
  // Model C Quality Score = (6/13)*40 + (3/13)*90 + (4/13)*90 = 18.46 + 20.77 + 27.69 = 66.92 -> 67
  // Note: if Cap=95, Opp=95, Quality = (6/13)*40 + (3/13)*95 + (4/13)*95 = 18.46 + 21.92 + 29.23 = 69.6 -> 70 (Initial PURSUE threshold)

  const syntheticRes = DecisionPolicyEngine.evaluate(
    dummyIdentity,
    { ...dummyCapability, overallFit: 0.95 },
    { ...dummyOpportunity, opportunityScore: 95 },
    easyTrapCareer,
    { locationFrictionPenalty: 2 },
    "Commercial Leadership",
    "Commercial Leadership",
    "A comprehensive executive leadership posting for Vice President of Commercial Growth overseeing P&L scale and team expansion.",
    true,
    undefined,
    undefined,
    85 // shortlistingPotential = 85 (>= 80)
  );

  console.log(`  Synthetic Case Result:`);
  console.log(`    Quality Score: ${syntheticRes.qualityScore}`);
  console.log(`    Verdict: ${syntheticRes.verdict}`);
  console.log(`    Triggered Rules: ${syntheticRes.triggeredRuleIds.join(", ")}`);
  
  const syntheticPass = syntheticRes.verdict === "CONSIDER" && syntheticRes.triggeredRuleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION");
  console.log(`  Synthetic Easy Trap Verification: ${syntheticPass ? "PASSED (produces CONSIDER)" : "FAILED"}`);
}

verifyEasyTrap().catch(console.error);
