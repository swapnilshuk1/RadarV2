import { runEngine, readOpportunities } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { DecisionVerb } from "../src/data/opportunity-fixtures";

interface BoundaryRecord {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  qualityScore: number;
  careerValue: number;
  shortlistingPotential: number;
  pursuitFriction: number;
  confidence: number;
  policyDVerb: DecisionVerb;
  policyDRule: string;
  rawText: string;
  matchedCapabilities: string[];
  missingCapabilities: string[];
  trajectory: string;
  vetoed: boolean;
  vetoReason: string | null;
}

// Policy D evaluator
function evaluatePolicyD(
  qualityScore: number | null,
  cv: number,
  sp: number,
  friction: number,
  vetoed: boolean,
  vetoReason: string | null,
  isSparseSpec: boolean,
  isNotEvaluable: boolean
): { verb: DecisionVerb; ruleTriggered: string } {
  if (qualityScore === null) {
    if (isSparseSpec) return { verb: "SPARSE_SPEC", ruleTriggered: "GATE-SPARSE" };
    if (isNotEvaluable) return { verb: "NOT_EVALUABLE", ruleTriggered: "GATE-INTEGRITY" };
    return { verb: "PASS", ruleTriggered: "GATE-IDENTITY" };
  }

  if (vetoed) {
    return { verb: "PASS", ruleTriggered: vetoReason || "VETO-HARD" };
  }

  const isEasyTrap = cv < 50 && sp >= 80 && friction < 10;

  if (qualityScore >= 65) {
    if (isEasyTrap) return { verb: "CONSIDER", ruleTriggered: "R-CONSIDER-CAREER-VALUE-PROTECTION" };
    if (sp < 50) return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-REACH-ROLE" };
    if (friction > 15) return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-HIGH-FRICTION" };
    return { verb: "PURSUE", ruleTriggered: "POL-D-PURSUE-BALANCED" };
  }

  if (qualityScore >= 55) {
    if (friction > 25) return { verb: "PASS", ruleTriggered: "POL-D-PASS-PROHIBITIVE-FRICTION" };
    return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-QUALIFIED" };
  }

  return { verb: "PASS", ruleTriggered: "POL-D-PASS-LOW-QUALITY" };
}

async function runBoundaryValidation() {
  console.log("=======================================================================");
  console.log("P4-A.6.1 — HUMAN BOUNDARY VALIDATION CASE EXTRACTION (N = 20)");
  console.log("=======================================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection);
  const rawOps = readOpportunities();
  const rawMap = new Map<string, any>(rawOps.map(o => [o.jobHash, o]));

  const allRecords: BoundaryRecord[] = [];

  for (const r of records) {
    if (r.qualityScore === null) continue;

    const raw = rawMap.get(r.jobHash) || {};
    const cv = r.decisionSummary?.careerValue ?? 0;
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    const friction = r.decisionSummary?.pursuitFriction ?? 0;
    const vetoed = !!r.vetoed;
    const vetoReason = r.vetoReason || null;
    const isSparseSpec = r.verb === "SPARSE_SPEC";
    const isNotEvaluable = r.verb === "NOT_EVALUABLE";

    const polD = evaluatePolicyD(
      r.qualityScore, cv, sp, friction, vetoed, vetoReason, isSparseSpec, isNotEvaluable
    );

    const rawText = (raw as any).rawText || (raw as any).rawDescription || (raw as any).description || "";
    const matchedCapabilities = (r.trace as any)?.evidenceMapping?.map((m: any) => m.capability || m.key) || [];
    const missingCapabilities = (r.explanation as any)?.missingEvidence || [];
    const trajectory = (r.trace?.careerValueBreakdown as any)?.trajectory || "LATERAL";

    allRecords.push({
      jobHash: r.jobHash,
      role: raw.role || (r.explanation?.headline || r.jobHash).split("at")[0]?.trim() || r.jobHash,
      company: raw.company || "Target Company",
      location: raw.location || "Remote",
      qualityScore: r.qualityScore,
      careerValue: cv,
      shortlistingPotential: sp,
      pursuitFriction: friction,
      confidence: r.confidence ?? 0,
      policyDVerb: polD.verb,
      policyDRule: polD.ruleTriggered,
      rawText,
      matchedCapabilities,
      missingCapabilities,
      trajectory,
      vetoed,
      vetoReason
    });
  }

  // GROUP A: Bottom 10 PURSUE opportunities (Lowest qualityScore >= 65)
  const pursueOpps = allRecords
    .filter(r => r.policyDVerb === "PURSUE")
    .sort((a, b) => a.qualityScore - b.qualityScore || a.careerValue - b.careerValue);

  const groupA = pursueOpps.slice(0, 10);

  // GROUP B: Top 10 CONSIDER opportunities (Highest qualityScore <= 69 that ended in CONSIDER)
  const considerOpps = allRecords
    .filter(r => r.policyDVerb === "CONSIDER")
    .sort((a, b) => b.qualityScore - a.qualityScore || b.careerValue - a.careerValue);

  const groupB = considerOpps.slice(0, 10);

  console.log("-----------------------------------------------------------------------");
  console.log("GROUP A: BOTTOM 10 PURSUE OPPORTUNITIES (Lowest qualityScore)");
  console.log("-----------------------------------------------------------------------\n");

  groupA.forEach((r, idx) => {
    console.log(`[GROUP A - #${idx + 1}] JobHash: ${r.jobHash}`);
    console.log(`  Role      : ${r.role}`);
    console.log(`  Company   : ${r.company}`);
    console.log(`  Location  : ${r.location}`);
    console.log(`  Score     : ${r.qualityScore} | CV: ${r.careerValue} | SP: ${r.shortlistingPotential} | Friction: ${r.pursuitFriction}`);
    console.log(`  Trajectory: ${r.trajectory}`);
    console.log(`  Matches   : ${r.matchedCapabilities.slice(0, 3).join(", ")}`);
    console.log(`  Gaps      : ${r.missingCapabilities.slice(0, 3).join(", ")}`);
    console.log(`  JD Sample : "${r.rawText.slice(0, 120).replace(/\n/g, " ")}..."`);
    console.log("");
  });

  console.log("-----------------------------------------------------------------------");
  console.log("GROUP B: TOP 10 CONSIDER OPPORTUNITIES (Highest qualityScore)");
  console.log("-----------------------------------------------------------------------\n");

  groupB.forEach((r, idx) => {
    console.log(`[GROUP B - #${idx + 1}] JobHash: ${r.jobHash}`);
    console.log(`  Role      : ${r.role}`);
    console.log(`  Company   : ${r.company}`);
    console.log(`  Location  : ${r.location}`);
    console.log(`  Score     : ${r.qualityScore} | CV: ${r.careerValue} | SP: ${r.shortlistingPotential} | Friction: ${r.pursuitFriction}`);
    console.log(`  Rule      : ${r.policyDRule}`);
    console.log(`  Trajectory: ${r.trajectory}`);
    console.log(`  Matches   : ${r.matchedCapabilities.slice(0, 3).join(", ")}`);
    console.log(`  Gaps      : ${r.missingCapabilities.slice(0, 3).join(", ")}`);
    console.log(`  JD Sample : "${r.rawText.slice(0, 120).replace(/\n/g, " ")}..."`);
    console.log("");
  });
}

runBoundaryValidation().catch(console.error);
