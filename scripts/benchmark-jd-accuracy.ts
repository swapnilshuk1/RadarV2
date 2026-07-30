import { rawOpportunities, Opportunity } from "../src/data/opportunity-fixtures";
import { candidateProfile } from "../src/data/candidate-profile";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";

async function runBenchmark() {
  console.log("=================================================================");
  console.log("   RADAR v2 PHASE 4: REAL JD ACCURACY & DASHBOARD BENCHMARK");
  console.log("=================================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const candidateProj = builder.fromProfile(candidateProfile);
  console.log(`CANDIDATE PROFILE: ${candidateProj.executiveThemes[0]}`);
  console.log(`Core Capabilities: ${candidateProj.coreCapabilities.slice(0, 5).join(", ")}\n`);

  let totalTested = 0;
  let pursueCount = 0;
  let considerCount = 0;
  let passCount = 0;

  for (const rawOpp of rawOpportunities) {
    totalTested++;
    const opp: Opportunity = {
      ...rawOpp,
      decision: "CONSIDER",
      recommendation: "Evaluation Pending",
      positioning: ["Executive Lead"],
      headspace: [{ action: "Apply", benefit: "Growth", effort: "Low" }],
      hiringRisk: "Standard Risk"
    };

    const jobProjection = JobProjectionBuilder.build(opp);
    const capabilityEval = CapabilityAssessmentEngine.evaluate(candidateProj, jobProjection);
    const careerEval = CareerAssessmentEngine.evaluate(candidateProj, jobProjection);

    const decisionResult = DecisionPolicyEngine.evaluate(
      { status: "COMPLETE", sufficiency: "SUFFICIENT", evidenceCount: 1, evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 }, coverage: 1.0, matchedThemes: [], missingThemes: [], verdict: "MATCH" },
      capabilityEval,
      { status: "COMPLETE", sufficiency: "SUFFICIENT", evidenceCount: 1, evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 } },
      careerEval,
      { status: "COMPLETE", sufficiency: "SUFFICIENT", evidenceCount: 1, evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 } },
      jobProjection.executiveIdentity.value,
      candidateProj.executiveThemes[0],
      opp.company + " " + opp.role
    );

    const brief = BriefCompositionEngine.compose({
      ...opp,
      decision: decisionResult.verdict,
      recommendationResult: { score: decisionResult.priorityScore } as any
    });

    if (decisionResult.verdict === "PURSUE") pursueCount++;
    if (decisionResult.verdict === "CONSIDER") considerCount++;
    if (decisionResult.verdict === "PASS") passCount++;

    console.log(`-----------------------------------------------------------------`);
    console.log(`CASE ${totalTested}: ${opp.role} @ ${opp.company}`);
    console.log(`  Location: ${opp.location || "N/A"}`);
    console.log(`  Identified Domain: ${jobProjection.executiveIdentity.value}`);
    console.log(`  Dashboard Decision Score: ${decisionResult.priorityScore}/100 [Verdict: ${decisionResult.verdict}]`);
    console.log(`  Graph Capability Fit: ${Math.round(capabilityEval.overallFit * 100)}% (${capabilityEval.matchedCapabilities.slice(0, 2).join(", ") || "None"})`);
    console.log(`  Net Career Value: ${careerEval.careerScore}/100 (Capital Gain: ${careerEval.careerCapitalGain} | Risk: ${careerEval.careerRisk})`);
    console.log(`  Editorial Dossier Memo: "${brief.memory.retentionSentence}"`);
    console.log(`  Recommended Dashboard Action: "${brief.memory.recommendedAction}"`);
  }

  console.log("\n=================================================================");
  console.log(` BENCHMARK SUMMARY (${totalTested} Real JDs Tested)`);
  console.log(`  PURSUE Roles  : ${pursueCount} (High Strategic Alignment)`);
  console.log(`  CONSIDER Roles: ${considerCount} (Transferable / Verification Required)`);
  console.log(`  PASS Roles    : ${passCount} (Domain Incompatible or Major Regression)`);
  console.log("=================================================================\n");
}

runBenchmark().catch(console.error);

