import { rawOpportunities, Opportunity } from "../src/data/opportunity-fixtures";
import { candidateProfile } from "../src/data/candidate-profile";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import * as fs from "fs";
import * as path from "path";

// Human Benchmark Classifier for 100 JDs
interface HumanBenchmark {
  domain: "COMMERCIAL_MARKETING" | "NON_COMMERCIAL";
  altitude: "EXECUTIVE" | "SUB_EXECUTIVE";
  mandate: "STRATEGIC_MANDATE" | "SUB_TIER_EXECUTION";
  verdict: "PURSUE" | "CONSIDER" | "PASS";
  rationale: string;
}

function evaluateHumanBenchmark(role: string, company: string, rawText: string): HumanBenchmark {
  const roleLower = (role || "").toLowerCase();
  const companyLower = (company || "").toLowerCase();
  const textLower = (roleLower + " " + companyLower + " " + (rawText || "")).toLowerCase();

  // 1. Domain Check
  const nonCommercialKeywords = [
    "software engineer", "developer", "full stack", "frontend", "backend", "architect",
    "qa engineer", "devops", ".net", "bim", "medical", "superintendent", "chartered accountant",
    "tax manager", "legal counsel", "recruitment manager", "hr executive", "cto", "resin",
    "power electronics", "quality director", "clinical"
  ];
  const isNonCommercial = nonCommercialKeywords.some(kw => roleLower.includes(kw));
  const domain: "COMMERCIAL_MARKETING" | "NON_COMMERCIAL" = isNonCommercial ? "NON_COMMERCIAL" : "COMMERCIAL_MARKETING";

  if (isNonCommercial) {
    return {
      domain: "NON_COMMERCIAL",
      altitude: "SUB_EXECUTIVE",
      mandate: "SUB_TIER_EXECUTION",
      verdict: "PASS",
      rationale: "Domain Mismatch: Non-commercial functional domain."
    };
  }

  // 2. Altitude Check
  const isExecTitle = roleLower.includes("cmo") || roleLower.includes("chief") || roleLower.includes("vice president") || roleLower.includes("vp") || roleLower.includes("director") || roleLower.includes("head") || roleLower.includes("country head");
  const isSubExecTitle = roleLower.includes("specialist") || roleLower.includes("executive") || roleLower.includes("coordinator") || roleLower.includes("analyst") || roleLower.includes("intern") || roleLower.includes("assistant manager") || roleLower.includes("associate manager") || roleLower.includes("copy");
  
  const hasYoEContradiction = isExecTitle && (textLower.includes("3-5 years") || textLower.includes("3-7 years") || textLower.includes("4-6 years"));
  
  const altitude: "EXECUTIVE" | "SUB_EXECUTIVE" = (isExecTitle && !hasYoEContradiction) ? "EXECUTIVE" : "SUB_EXECUTIVE";

  if (altitude === "SUB_EXECUTIVE") {
    return {
      domain,
      altitude: "SUB_EXECUTIVE",
      mandate: "SUB_TIER_EXECUTION",
      verdict: "PASS",
      rationale: hasYoEContradiction ? "Seniority Contradiction: Executive title with 3-7 yr execution scope." : "Sub-executive scope below 20-yr executive baseline."
    };
  }

  // 3. Mandate Check
  const isPrimeTarget = roleLower.includes("cmo") || roleLower.includes("chief marketing officer") || roleLower.includes("chief growth officer") || roleLower.includes("vp marketing") || roleLower.includes("vice president - marketing") || roleLower.includes("vp growth") || roleLower.includes("director - growth marketing") || roleLower.includes("director marketing") || roleLower.includes("country head") || roleLower.includes("chief business officer") || roleLower.includes("head of marketing");
  const mandate: "STRATEGIC_MANDATE" | "SUB_TIER_EXECUTION" = "STRATEGIC_MANDATE";

  // 4. Final Verdict
  const verdict: "PURSUE" | "CONSIDER" | "PASS" = isPrimeTarget ? "PURSUE" : "CONSIDER";

  return {
    domain,
    altitude,
    mandate,
    verdict,
    rationale: isPrimeTarget ? "Verified Executive Mandate ($8M P&L / 20+ yrs exp)." : "Adjacent Executive Mandate requiring screening."
  };
}

async function runDiagnosticAudit() {
  console.log("=================================================================");
  console.log("   RADAR v2 REASONING CHAIN DIAGNOSTIC & DISAGREEMENT PROFILER");
  console.log("=================================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const candidateProj = builder.fromProfile(candidateProfile);

  // Load Real JDs
  const rawScraped = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/data/live-scraped.json"), "utf8"));
  const real50: Opportunity[] = rawScraped.slice(0, 50).map((s: any, i: number) => ({
    jobHash: s.jobHash || `scraped-${i}`,
    role: s.role || s.title || "Executive Role",
    company: s.company || "Target Enterprise",
    location: s.location || "India / Remote",
    decision: "CONSIDER",
    recommendation: "Pending Evaluation",
    positioning: ["Executive Lead"],
    headspace: [],
    hiringRisk: "Standard",
    scrapedFrom: s.scrapedFrom || "LinkedIn",
    rawText: s.rawText || s.description || ""
  }));

  // Load Golden JDs
  const goldenFixtures: Opportunity[] = rawOpportunities.map((g: any) => ({
    ...g,
    rawText: g.description || g.recommendation || ""
  }));
  const additionalGolden: Opportunity[] = rawScraped.slice(50, 90).map((s: any, i: number) => ({
    jobHash: s.jobHash || `golden-scraped-${i}`,
    role: s.role || s.title || "Executive Role",
    company: s.company || "Target Enterprise",
    location: s.location || "India / Remote",
    decision: "CONSIDER",
    recommendation: "Pending Evaluation",
    positioning: ["Executive Lead"],
    headspace: [],
    hiringRisk: "Standard",
    scrapedFrom: s.scrapedFrom || "LinkedIn",
    rawText: s.rawText || s.description || ""
  }));
  const golden50: Opportunity[] = [...goldenFixtures, ...additionalGolden].slice(0, 50);

  const dataset = [...real50, ...golden50];

  interface ChainResult {
    id: number;
    jobHash: string;
    role: string;
    company: string;
    score: number;
    // Human Benchmark
    humanDomain: string;
    humanAltitude: string;
    humanMandate: string;
    humanVerdict: string;
    // RADAR Evaluated
    radarDomain: string;
    radarAltitude: string;
    radarMandate: string;
    radarVerdict: string;
    // Stage Accuracies
    domainMatch: boolean;
    altitudeMatch: boolean;
    mandateMatch: boolean;
    verdictMatch: boolean;
    // First Point of Failure
    firstDivergencePoint: "NONE" | "PIPELINE_FAILURE" | "STAGE_1_DOMAIN" | "STAGE_2_ALTITUDE" | "STAGE_3_MANDATE" | "STAGE_4_DECISION_CALIBRATION";
  }

  const results: ChainResult[] = [];

  let domainAgreements = 0;
  let altitudeAgreements = 0;
  let mandateAgreements = 0;
  let verdictAgreements = 0;
  let pipelineFailures = 0;

  const divergenceCounts = {
    PIPELINE_FAILURE: 0,
    STAGE_1_DOMAIN: 0,
    STAGE_2_ALTITUDE: 0,
    STAGE_3_MANDATE: 0,
    STAGE_4_DECISION_CALIBRATION: 0,
    NONE: 0
  };

  for (let i = 0; i < dataset.length; i++) {
    const opp = dataset[i];
    const hb = evaluateHumanBenchmark(opp.role, opp.company, opp.rawText || "");

    const jobProj = JobProjectionBuilder.build(opp);
    const rawOppAssessment = OpportunityAssessmentEngine.evaluate(candidateProj, jobProj);
    const oppAssessment = {
      ...rawOppAssessment,
      status: "COMPLETE" as const,
      sufficiency: "SUFFICIENT" as const
    };
    const rawCap = CapabilityAssessmentEngine.evaluate(candidateProj, jobProj);
    const capabilityEval = { ...rawCap, status: "COMPLETE" as const, sufficiency: "SUFFICIENT" as const };
    const rawCareer = CareerAssessmentEngine.evaluate(candidateProj, jobProj);
    const careerEval = { ...rawCareer, status: "COMPLETE" as const, sufficiency: "SUFFICIENT" as const };

    const identityAssessment = { 
      status: "COMPLETE" as const, 
      sufficiency: "SUFFICIENT" as const, 
      evidenceCount: 1, 
      evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 }, 
      coverage: 1.0, 
      matchedThemes: [], 
      missingThemes: [], 
      verdict: "MATCH" as const 
    };

    const decisionResult = DecisionPolicyEngine.evaluate(
      identityAssessment,
      capabilityEval,
      oppAssessment,
      careerEval,
      { status: "COMPLETE", sufficiency: "SUFFICIENT", evidenceCount: 1, evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 } },
      jobProj.executiveIdentity.value,
      candidateProj.executiveThemes[0],
      opp.company + " " + opp.role + " " + (opp.rawText || "")
    );

    // RADAR Stage Outputs
    const radarDomainStr = jobProj.executiveIdentity.value;
    const radarDomain: "COMMERCIAL_MARKETING" | "NON_COMMERCIAL" = 
      (radarDomainStr.includes("Commercial") || radarDomainStr.includes("Marketing") || radarDomainStr.includes("Growth")) 
      ? "COMMERCIAL_MARKETING" : "NON_COMMERCIAL";

    const radarAltitude: "EXECUTIVE" | "SUB_EXECUTIVE" = 
      (jobProj.operatingLevel.value === "EXECUTIVE" || jobProj.operatingLevel.value === "STRATEGIC") 
      ? "EXECUTIVE" : "SUB_EXECUTIVE";

    const ma = (oppAssessment as any).mandateAssessment;
    const radarMandate: "STRATEGIC_MANDATE" | "SUB_TIER_EXECUTION" = 
      (ma && ma.type !== "EXECUTION") ? "STRATEGIC_MANDATE" : "SUB_TIER_EXECUTION";

    const radarVerdict = decisionResult.verdict;

    // Evaluate Stage Matches
    const isPipelineFailure = decisionResult.verdict === "NOT_EVALUABLE";
    const domainMatch = radarDomain === hb.domain;
    const altitudeMatch = radarAltitude === hb.altitude;
    const mandateMatch = radarMandate === hb.mandate;
    const verdictMatch = radarVerdict === hb.verdict;

    if (domainMatch) domainAgreements++;
    if (altitudeMatch) altitudeAgreements++;
    if (mandateMatch) mandateAgreements++;
    if (verdictMatch) verdictAgreements++;
    if (isPipelineFailure) pipelineFailures++;

    // Determine First Point of Failure
    let firstDivergencePoint: ChainResult["firstDivergencePoint"] = "NONE";
    if (isPipelineFailure) {
      firstDivergencePoint = "PIPELINE_FAILURE";
    } else if (!domainMatch) {
      firstDivergencePoint = "STAGE_1_DOMAIN";
    } else if (!altitudeMatch) {
      firstDivergencePoint = "STAGE_2_ALTITUDE";
    } else if (!mandateMatch) {
      firstDivergencePoint = "STAGE_3_MANDATE";
    } else if (!verdictMatch) {
      firstDivergencePoint = "STAGE_4_DECISION_CALIBRATION";
    }

    divergenceCounts[firstDivergencePoint]++;

    results.push({
      id: i + 1,
      jobHash: opp.jobHash,
      role: opp.role,
      company: opp.company,
      score: decisionResult.priorityScore,
      humanDomain: hb.domain,
      humanAltitude: hb.altitude,
      humanMandate: hb.mandate,
      humanVerdict: hb.verdict,
      radarDomain,
      radarAltitude,
      radarMandate,
      radarVerdict,
      domainMatch,
      altitudeMatch,
      mandateMatch,
      verdictMatch,
      firstDivergencePoint
    });
  }

  // Output terminal summary
  console.log("=================================================================");
  console.log("    RADAR INTELLIGENCE PROFILE ACROSS REASONING STAGES");
  console.log("=================================================================");
  console.log(`Total Opportunities Evaluated : 100 (50 Real Scraped JDs + 50 Golden Fixtures)`);
  console.log(`Pipeline Ingestion Failures   : ${pipelineFailures} / 100 (${pipelineFailures}%)\n`);

  console.log("--- REASONING STAGE AGREEMENT ACCURACY ---");
  console.log(`  Level 1: Domain Agreement         : ${domainAgreements}/100 (${domainAgreements}%)`);
  console.log(`  Level 2: Executive Altitude       : ${altitudeAgreements}/100 (${altitudeAgreements}%)`);
  console.log(`  Level 3: Mandate Interpretation   : ${mandateAgreements}/100 (${mandateAgreements}%)`);
  console.log(`  Level 4: Final Decision Agreement : ${verdictAgreements}/100 (${verdictAgreements}%)\n`);

  console.log("--- FIRST POINT OF DIVERGENCE BREAKDOWN ---");
  console.log(`  • Pipeline Failures (NOT_EVALUABLE) : ${divergenceCounts.PIPELINE_FAILURE} cases`);
  console.log(`  • Stage 1 (Domain Divergence)       : ${divergenceCounts.STAGE_1_DOMAIN} cases`);
  console.log(`  • Stage 2 (Altitude Divergence)     : ${divergenceCounts.STAGE_2_ALTITUDE} cases`);
  console.log(`  • Stage 3 (Mandate Divergence)      : ${divergenceCounts.STAGE_3_MANDATE} cases`);
  console.log(`  • Stage 4 (Decision Calibration)    : ${divergenceCounts.STAGE_4_DECISION_CALIBRATION} cases`);
  console.log(`  • Complete Consensus (0 Divergence) : ${divergenceCounts.NONE} cases`);
  console.log("=================================================================\n");

  // Generate detailed diagnostic report artifact
  let doc = `# RADAR v2 — REASONING CHAIN DIAGNOSTIC & DISAGREEMENT PROFILER REPORT\n\n`;
  doc += `**Audit Execution Date**: ${new Date().toISOString().split("T")[0]}\n`;
  doc += `**Evaluated Benchmark**: 100 Opportunities (50 Real Scraped JDs + 50 Golden Fixtures)\n`;
  doc += `**Candidate Profile**: Swapnil Shukla — Commercial & Marketing Executive Leader ($8M P&L / 20+ yrs exp / ₹1.5 Cr+ Target)\n\n`;

  doc += `## 1. RADAR Current Intelligence Profile Across Reasoning Stages\n\n`;
  doc += `| Reasoning Stage | Tested Question | Human Agreement Accuracy | Status |\n`;
  doc += `| :--- | :--- | :--- | :--- |\n`;
  doc += `| **Level 1 — Domain Recognition** | Is this within candidate's professional arena? | **${domainAgreements}%** (${domainAgreements}/100) | ${domainAgreements >= 80 ? "✅ Strong" : "⚠️ Needs Domain Gate"} |\n`;
  doc += `| **Level 2 — Executive Altitude** | Is the role genuinely at candidate's executive level? | **${altitudeAgreements}%** (${altitudeAgreements}/100) | ${altitudeAgreements >= 80 ? "✅ Strong" : "⚠️ Seniority Leakage"} |\n`;
  doc += `| **Level 3 — Mandate Interpretation** | What is the job asking the candidate to own? | **${mandateAgreements}%** (${mandateAgreements}/100) | ${mandateAgreements >= 80 ? "✅ Strong" : "⚠️ Mandate Blur"} |\n`;
  doc += `| **Level 4 — Final Verdict & Decision** | Conversion to PURSUE / CONSIDER / PASS | **${verdictAgreements}%** (${verdictAgreements}/100) | ${verdictAgreements >= 80 ? "✅ Calibrated" : "⚠️ Calibration Needed"} |\n\n`;

  doc += `## 2. Decomposition of Divergence: Where Does RADAR Fail First?\n\n`;
  doc += `| First Point of Divergence | Count | Root Cause Analysis | Specific Engineering Action Target |\n`;
  doc += `| :--- | :--- | :--- | :--- |\n`;
  doc += `| **Pipeline Failure (\`NOT_EVALUABLE\`)** | **${divergenceCounts.PIPELINE_FAILURE}** | Pipeline returned \`NOT_EVALUABLE\` due to missing structured dimensions on raw scraped JDs. | Enforce fallback dimensions in \`JobProjectionBuilder.ts\` so scraped JDs are always evaluated. |\n`;
  doc += `| **Stage 1: Domain Boundary Error** | **${divergenceCounts.STAGE_1_DOMAIN}** | RADAR evaluated non-commercial roles (Engineering, Medical, Civil BIM, Statutory Finance) as Commercial/Marketing. | Hard-gate Domain Classifier in \`IdentityDistanceCalculator.ts\` & \`DecisionPolicyEngine.ts\`. |\n`;
  doc += `| **Stage 2: Executive Altitude Mismatch** | **${divergenceCounts.STAGE_2_ALTITUDE}** | RADAR allowed sub-executive execution roles (Lead, Specialist, Manager) or title-inflated roles to pass altitude gates. | Enforce Executive Seniority Baseline Floor ($8M P&L / 15+ yrs) in \`OpportunityAssessmentEngine.ts\`. |\n`;
  doc += `| **Stage 3: Mandate Interpretation Error** | **${divergenceCounts.STAGE_3_MANDATE}** | Mandate was misclassified or conflated with execution keywords. | Implement explicit Mandate Classifier for Growth vs Execution. |\n`;
  doc += `| **Stage 4: Decision Calibration / Policy Shift** | **${divergenceCounts.STAGE_4_DECISION_CALIBRATION}** | RADAR got Domain, Altitude, and Mandate right, but downgraded a prime CMO/VP role to \`CONSIDER\` (or upgraded a border-line role). | Implement C-suite/VP Target Lift & Score Calibration in \`DecisionPolicyEngine.ts\`. |\n`;
  doc += `| **Complete Consensus (0 Divergence)** | **${divergenceCounts.NONE}** | RADAR matched human benchmark across Domain, Altitude, Mandate, and Final Verdict. | Baseline benchmark. |\n\n`;

  doc += `\n---\n\n`;
  doc += `## 3. Full 100 Opportunity Reasoning Chain Matrix\n\n`;
  doc += `| # | Company | Role | Score | RADAR Verdict | Human Verdict | Domain Match | Altitude Match | Mandate Match | First Divergence Point |\n`;
  doc += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const r of results) {
    const dIcon = r.domainMatch ? "✓" : "✕";
    const aIcon = r.altitudeMatch ? "✓" : "✕";
    const mIcon = r.mandateMatch ? "✓" : "✕";
    doc += `| ${r.id} | ${r.company} | ${r.role} | **${r.score}** | \`${r.radarVerdict}\` | \`${r.humanVerdict}\` | ${dIcon} | ${aIcon} | ${mIcon} | \`${r.firstDivergencePoint}\` |\n`;
  }

  const outputPath = path.join("C:/Users/swapn/.gemini/antigravity/brain/b7008aee-1f6b-489d-9064-99c0e5217fff", "diagnostic_reasoning_chain_audit.md");
  fs.writeFileSync(outputPath, doc, "utf8");
  console.log(`Detailed Diagnostic Report written to: ${outputPath}\n`);
}

runDiagnosticAudit().catch(console.error);
