import { rawOpportunities, Opportunity } from "../src/data/opportunity-fixtures";
import { candidateProfile } from "../src/data/candidate-profile";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";

async function runCapabilityEvidenceStateTest() {
  console.log("=================================================================");
  console.log("   THREE-STATE CAPABILITY EVIDENCE EXPERIMENT (TEST A / B / C)");
  console.log("=================================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const candidateProj = builder.fromProfile(candidateProfile);

  // Pick BMW CMO (Prime target)
  const bmwOpp: Opportunity = {
    jobHash: "bmw-cmo-test",
    role: "Chief Marketing Officer (CMO)",
    company: "BMW India",
    location: "Gurugram / Remote",
    decision: "CONSIDER",
    recommendation: "Prime CMO Opportunity",
    positioning: ["Executive Lead"],
    headspace: [],
    hiringRisk: "Standard",
    scrapedFrom: "LinkedIn",
    rawText: "BMW India is looking for a Chief Marketing Officer to drive brand strategy, commercial growth, and luxury market expansion across India."
  };

  // Pick Orthogonal Medical/Clinical Role (Proven Mismatch)
  const medicalOpp: Opportunity = {
    jobHash: "medical-director-test",
    role: "Chief Medical Officer",
    company: "Capital Hospital",
    location: "Delhi",
    decision: "PASS",
    recommendation: "Medical Mismatch",
    positioning: ["Medical Lead"],
    headspace: [],
    hiringRisk: "High",
    scrapedFrom: "LinkedIn",
    rawText: "Capital Hospital requires a Chief Medical Officer with MBBS / MD and 15 years clinical surgical experience."
  };

  const bmwJobProj = JobProjectionBuilder.build(bmwOpp);
  const medicalJobProj = JobProjectionBuilder.build(medicalOpp);

  const rawOppAssessment = OpportunityAssessmentEngine.evaluate(candidateProj, bmwJobProj);
  const oppAssessment = { 
    ...rawOppAssessment, 
    status: "COMPLETE" as const, 
    sufficiency: "SUFFICIENT" as const,
    mandateSeniority: "QUALIFIED" as const 
  };
  const rawCareer = CareerAssessmentEngine.evaluate(candidateProj, bmwJobProj);
  const careerEval = { ...rawCareer, status: "COMPLETE" as const, sufficiency: "SUFFICIENT" as const };

  const identityAssessment = { 
    status: "COMPLETE" as const, 
    sufficiency: "SUFFICIENT" as const, 
    evidenceCount: 1, 
    evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 }, 
    coverage: 1.0, matchedThemes: [], missingThemes: [], verdict: "MATCH" as const 
  };

  // TEST A: Evidence Unavailable, overallFit = 0.0 (Current System Behavior - Penalized)
  const capEvalA = {
    status: "COMPLETE" as const,
    sufficiency: "INSUFFICIENT" as const,
    evidenceState: "UNAVAILABLE" as const,
    evidenceCount: 0,
    overallFit: 0.0,
    matchedCapabilities: [],
    missingCapabilities: ["Brand Strategy"],
    evidenceSummary: { extractedSignals: 0, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 }
  };

  const resA = DecisionPolicyEngine.evaluate(
    identityAssessment, capEvalA, oppAssessment, careerEval,
    { status: "COMPLETE", sufficiency: "SUFFICIENT", evidenceCount: 1, evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 } },
    bmwJobProj.executiveIdentity.value, candidateProj.executiveThemes[0], bmwOpp.company + " " + bmwOpp.role
  );

  // TEST B: Evidence Unavailable, evidenceState = "UNAVAILABLE" (Neutral Uncertainty ~0.50)
  // In scoring: capabilityScore = 50
  const capEvalB = {
    ...capEvalA,
    overallFit: 0.50,
    evidenceState: "UNAVAILABLE" as const
  };

  const resB = DecisionPolicyEngine.evaluate(
    identityAssessment, capEvalB, oppAssessment, careerEval,
    { status: "COMPLETE", sufficiency: "SUFFICIENT", evidenceCount: 1, evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 } },
    bmwJobProj.executiveIdentity.value, candidateProj.executiveThemes[0], bmwOpp.company + " " + bmwOpp.role
  );

  // TEST C: Proven Mismatch, evidenceState = "SUFFICIENT", overallFit = 0.0
  const capEvalC = {
    status: "COMPLETE" as const,
    sufficiency: "SUFFICIENT" as const,
    evidenceState: "SUFFICIENT" as const,
    evidenceCount: 5,
    overallFit: 0.0,
    matchedCapabilities: [],
    missingCapabilities: ["MBBS / Surgical MD", "Clinical Operations"],
    evidenceSummary: { extractedSignals: 5, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 }
  };

  const resC = DecisionPolicyEngine.evaluate(
    identityAssessment, capEvalC, oppAssessment, careerEval,
    { status: "COMPLETE", sufficiency: "SUFFICIENT", evidenceCount: 1, evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 } },
    medicalJobProj.executiveIdentity.value, candidateProj.executiveThemes[0], medicalOpp.company + " " + medicalOpp.role
  );

  console.log("--- EXPERIMENT RESULTS ---");
  console.log(`TEST A (Current 0.0 Penalized) : BMW CMO Score = ${resA.priorityScore} [Verdict: ${resA.verdict}]`);
  console.log(`TEST B (Neutral Uncertainty)  : BMW CMO Score = ${resB.priorityScore} [Verdict: ${resB.verdict}]`);
  console.log(`TEST C (Proven Mismatch 0.0)  : Medical CMO Score = ${resC.priorityScore} [Verdict: ${resC.verdict}]\n`);

  console.log("--- VERIFICATION OF RELATIONSHIPS ---");
  console.log(`• Test B (${resB.priorityScore}) cleanly elevates above Test A (${resA.priorityScore})? : ${resB.priorityScore > resA.priorityScore ? 'YES (PASSED)' : 'NO'}`);
  console.log(`• Test C (${resC.priorityScore}) remains heavily penalized (Score < 60)?          : ${resC.priorityScore < 60 ? 'YES (PASSED)' : 'NO'}`);
  console.log("=================================================================\n");
}

runCapabilityEvidenceStateTest().catch(console.error);
