import { getRepositories } from "../src/data/sqlite/provider";
import { CandidateEvidenceGraph } from "../src/lib/intelligence/execution/CandidateEvidenceGraph";
import { ExecutionEvidenceGate } from "../src/lib/intelligence/execution/ExecutionEvidenceGate";
import { ExecutionEngine } from "../src/lib/intelligence/engines/ExecutionEngine";
import candidateProfileData from "../src/data/candidate-profile.json";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("==========================================================================");
  console.log("RADAR V4 — 125-JD EXECUTION PROVENANCE & EVIDENCE FIREWALL AUDIT");
  console.log("==========================================================================");

  const evidenceGraph = new CandidateEvidenceGraph(candidateProfileData);
  const repos = getRepositories();
  const opportunities = await repos.opportunities.listActiveOpportunities();

  const targetOpportunities = opportunities.slice(0, 125);
  console.log(`Loaded ${opportunities.length} opportunities from SQLite/Turso database. Selected 125 JDs for provenance audit.`);

  let totalGeneratedUnsafe = 0;
  let totalInterceptedUnsafe = 0;
  let totalRenderedUnsafe = 0;

  const rejectedArtifacts: Array<{
    opportunityId: string;
    jobHash: string;
    company: string;
    role: string;
    packageType: string;
    rejectedClaims: any[];
  }> = [];

  for (const opp of targetOpportunities) {
    const jobInfo = {
      jobHash: opp.id,
      company: opp.company?.name || "Target Company",
      role: opp.title,
      trueExecutiveMandate: "EXECUTIVE_LEADERSHIP"
    };

    // Test 6 strategy execution package extractions
    const packages = [
      { type: "conditions", pkg: await ExecutionEngine.extractRecommendationConditions(jobInfo, evidenceGraph) },
      { type: "screening", pkg: await ExecutionEngine.extractScreeningQuestions(jobInfo, evidenceGraph) },
      { type: "gaps", pkg: await ExecutionEngine.analyzeResumeGaps(jobInfo, evidenceGraph) },
      { type: "linkedin", pkg: await ExecutionEngine.extractLinkedInStrategy(jobInfo, evidenceGraph) },
      { type: "prep", pkg: await ExecutionEngine.extractInterviewPrep(jobInfo, evidenceGraph) },
      { type: "validation", pkg: await ExecutionEngine.validateDecision(jobInfo, evidenceGraph) },
    ];

    for (const item of packages) {
      const gateResult = ExecutionEvidenceGate.validateAndEnforce(item.pkg, evidenceGraph, jobInfo);
      totalGeneratedUnsafe += gateResult.generatedUnsafeCount;
      totalInterceptedUnsafe += gateResult.interceptedUnsafeCount;
      totalRenderedUnsafe += gateResult.renderedUnsafeCount;

      if (gateResult.rejectedClaims && gateResult.rejectedClaims.length > 0) {
        rejectedArtifacts.push({
          opportunityId: opp.id,
          jobHash: opp.id,
          company: jobInfo.company,
          role: jobInfo.role,
          packageType: item.type,
          rejectedClaims: gateResult.rejectedClaims
        });
      }
    }
  }

  console.log("\n--------------------------------------------------------------------------");
  console.log("FINAL 125-JD AUDIT COUNTERS:");
  console.log("--------------------------------------------------------------------------");
  console.log(`GENERATED_UNSAFE_CLAIMS   : ${totalGeneratedUnsafe}`);
  console.log(`INTERCEPTED_UNSAFE_CLAIMS : ${totalInterceptedUnsafe}`);
  console.log(`RENDERED_UNSAFE_CLAIMS    : ${totalRenderedUnsafe}`);
  console.log("--------------------------------------------------------------------------");

  // Save rejected artifacts JSON
  const outputPath = path.join(process.cwd(), "rejected-unsafe-artifacts.json");
  fs.writeFileSync(outputPath, JSON.stringify(rejectedArtifacts, null, 2), "utf-8");
  console.log(`\nPersisted rejected unsafe artifacts to: ${outputPath}`);

  if (totalRenderedUnsafe === 0) {
    console.log("\n🟢 CERTIFICATION PASSED: RENDERED_UNSAFE_CLAIMS = 0");
  } else {
    console.error(`\n🔴 CERTIFICATION FAILED: RENDERED_UNSAFE_CLAIMS = ${totalRenderedUnsafe}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
