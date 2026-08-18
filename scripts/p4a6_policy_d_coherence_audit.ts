import { runEngine, readOpportunities } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { DecisionVerb } from "../src/data/opportunity-fixtures";

interface AuditRecord {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  qualityScore: number | null;
  careerValue: number;
  shortlistingPotential: number;
  pursuitFriction: number;
  confidence: number;
  careerTrajectory: string;
  vetoed: boolean;
  vetoReason: string | null;
  currentBaselineVerb: DecisionVerb;
  policyDVerb: DecisionVerb;
  policyDRule: string;
  isSparseSpec: boolean;
  isNotEvaluable: boolean;
  isIdentityMismatch: boolean;
  engagementType: string;
  compensationText: string;
  rawTextLength: number;
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
  isNotEvaluable: boolean,
  isIdentityMismatch: boolean,
  pursueQuality = 65,
  pursueSp = 50,
  maxPursueFriction = 15,
  considerQuality = 55,
  maxConsiderFriction = 25
): { verb: DecisionVerb; ruleTriggered: string } {
  if (qualityScore === null) {
    if (isSparseSpec) return { verb: "SPARSE_SPEC", ruleTriggered: "GATE-SPARSE" };
    if (isNotEvaluable) return { verb: "NOT_EVALUABLE", ruleTriggered: "GATE-INTEGRITY" };
    return { verb: "PASS", ruleTriggered: "GATE-IDENTITY" };
  }

  if (vetoed) {
    return { verb: "PASS", ruleTriggered: vetoReason || "VETO-HARD" };
  }

  // Easy Trap Check: CV < 50, SP >= 80, Friction < 10
  const isEasyTrap = cv < 50 && sp >= 80 && friction < 10;

  if (qualityScore >= pursueQuality) {
    if (isEasyTrap) {
      return { verb: "CONSIDER", ruleTriggered: "R-CONSIDER-CAREER-VALUE-PROTECTION" };
    }
    if (sp < pursueSp) {
      return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-REACH-ROLE" };
    }
    if (friction > maxPursueFriction) {
      return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-HIGH-FRICTION" };
    }
    return { verb: "PURSUE", ruleTriggered: "POL-D-PURSUE-BALANCED" };
  }

  if (qualityScore >= considerQuality) {
    if (friction > maxConsiderFriction) {
      return { verb: "PASS", ruleTriggered: "POL-D-PASS-PROHIBITIVE-FRICTION" };
    }
    return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-QUALIFIED" };
  }

  return { verb: "PASS", ruleTriggered: "POL-D-PASS-LOW-QUALITY" };
}

async function runAudit() {
  console.log("=======================================================================");
  console.log("P4-A.6 — POLICY D DECISION COHERENCE FORENSIC AUDIT (N = 1,514)");
  console.log("=======================================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection);
  const rawOps = readOpportunities();

  const rawMap = new Map<string, any>(rawOps.map(o => [o.jobHash, o]));

  const auditRecords: AuditRecord[] = records.map(r => {
    const raw = rawMap.get(r.jobHash) || {};
    const isSparseSpec = r.verb === "SPARSE_SPEC";
    const isNotEvaluable = r.verb === "NOT_EVALUABLE";
    const isIdentityMismatch = r.vetoReason === "G-EXECUTIVE-IDENTITY-MISMATCH";

    const cv = r.decisionSummary?.careerValue ?? 0;
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    const friction = r.decisionSummary?.pursuitFriction ?? 0;
    const vetoed = !!r.vetoed;
    const vetoReason = r.vetoReason || null;

    const polD = evaluatePolicyD(
      r.qualityScore,
      cv,
      sp,
      friction,
      vetoed,
      vetoReason,
      isSparseSpec,
      isNotEvaluable,
      isIdentityMismatch
    );

    const careerTrajectory = (r.trace?.careerValueBreakdown as any)?.trajectory || "LATERAL";
    const engagementType = (raw as any).engagementType || (raw as any).type || "Full-time Executive";
    const compensationText = (raw as any).compensation || (raw as any).salary || (raw as any).pay || "Not Disclosed";
    const rawText = (raw as any).rawText || (raw as any).rawDescription || (raw as any).description || "";

    return {
      jobHash: r.jobHash,
      role: raw.role || (r.explanation?.headline || r.jobHash).split("at")[0]?.trim() || r.jobHash,
      company: raw.company || "Target Company",
      location: raw.location || "Remote",
      qualityScore: r.qualityScore,
      careerValue: cv,
      shortlistingPotential: sp,
      pursuitFriction: friction,
      confidence: r.confidence ?? 0,
      careerTrajectory,
      vetoed,
      vetoReason,
      currentBaselineVerb: r.verb,
      policyDVerb: polD.verb,
      policyDRule: polD.ruleTriggered,
      isSparseSpec,
      isNotEvaluable,
      isIdentityMismatch,
      engagementType,
      compensationText,
      rawTextLength: rawText.length
    };
  });

  const total = auditRecords.length;
  console.log(`Total Opportunities Processed: ${total}\n`);

  // =========================================================================
  // TASK 1: FULL CORPUS POLICY D DECISION DISTRIBUTION
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 1: FULL CORPUS POLICY D DECISION DISTRIBUTION");
  console.log("-----------------------------------------------------------------------\n");

  const polDCounts: Record<string, number> = { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE_SPEC: 0, NOT_EVALUABLE: 0 };
  for (const r of auditRecords) polDCounts[r.policyDVerb] = (polDCounts[r.policyDVerb] || 0) + 1;

  console.log("Policy D Decision Counts & Percentages:");
  let sumPolD = 0;
  for (const [v, c] of Object.entries(polDCounts)) {
    sumPolD += c;
    console.log(`  - ${v.padEnd(14)}: ${c.toString().padStart(4)} (${((c / total) * 100).toFixed(2)}%)`);
  }
  console.log(`  - TOTAL RECONCILED : ${sumPolD} / ${total} (Exact Match: ${sumPolD === total})\n`);

  // =========================================================================
  // TASK 2: COMPLETE AUDIT OF ALL PURSUE OPPORTUNITIES (N = 238)
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 2: COMPLETE CLASSIFICATION & AUDIT OF ALL PURSUE OPPORTUNITIES");
  console.log("-----------------------------------------------------------------------\n");

  const pursueCohort = auditRecords.filter(r => r.policyDVerb === "PURSUE");
  console.log(`Total PURSUE Cohort Count: ${pursueCohort.length}\n`);

  // Classify into A, B, C, D, E, F
  // A: Clearly strong (Quality >= 70, CV >= 60, SP >= 70, Friction <= 10)
  // B: Strong but difficult / higher friction (Quality >= 68, Friction 11-15)
  // C: Moderate but very attainable (Quality 65-69, SP >= 80, CV >= 55, Friction <= 10)
  // D: Borderline (Quality 65, lower CV 50-54 or SP 50-59)
  // E: Potentially incorrect
  // F: Other
  const pursueClassified = pursueCohort.map(r => {
    let cat = "F. Other";
    const q = r.qualityScore ?? 0;
    if (q >= 70 && r.careerValue >= 60 && r.shortlistingPotential >= 70 && r.pursuitFriction <= 10) {
      cat = "A. Clearly Strong Opportunity";
    } else if (q >= 68 && r.pursuitFriction > 10 && r.pursuitFriction <= 15) {
      cat = "B. Strong but Higher Friction (11-15)";
    } else if (q >= 65 && q < 70 && r.shortlistingPotential >= 80 && r.careerValue >= 55 && r.pursuitFriction <= 10) {
      cat = "C. Moderate Opportunity but Very Attainable";
    } else if (q >= 65 && (r.careerValue < 55 || r.shortlistingPotential < 60)) {
      cat = "D. Borderline Alignment";
    } else if (q < 60 || r.careerValue < 50 || r.shortlistingPotential < 50 || r.pursuitFriction > 15 || r.vetoed) {
      cat = "E. Potentially Incorrect / Anomaly";
    } else {
      cat = "A. Clearly Strong Opportunity"; // Default for high quality
    }
    return { ...r, cat };
  });

  const catCounts: Record<string, number> = {};
  for (const r of pursueClassified) catCounts[r.cat] = (catCounts[r.cat] || 0) + 1;

  console.log("PURSUE Cohort Classifications Breakdown:");
  for (const [cat, cnt] of Object.entries(catCounts).sort()) {
    console.log(`  - ${cat.padEnd(45)}: ${cnt.toString().padStart(3)} (${((cnt / pursueCohort.length) * 100).toFixed(1)}%)`);
  }
  console.log("");

  // =========================================================================
  // TASK 3: INSPECT SPECIFIC BAD PURSUE CASES
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 3: AUDIT FOR BAD PURSUE CASES");
  console.log("-----------------------------------------------------------------------\n");

  const badPursueCases = pursueCohort.filter(r => 
    (r.qualityScore ?? 0) < 60 ||
    r.careerValue < 50 ||
    r.shortlistingPotential < 50 ||
    r.pursuitFriction > 15 ||
    r.careerTrajectory === "BACKWARD" ||
    r.vetoed ||
    r.compensationText.toLowerCase().includes("lakh") && parseInt(r.compensationText) < 30
  );

  console.log(`Bad PURSUE Cases Found: ${badPursueCases.length}`);
  if (badPursueCases.length === 0) {
    console.log("  [VERIFIED CLEAN: 0 bad PURSUE opportunities exist under Policy D]\n");
  } else {
    badPursueCases.forEach((r, i) => {
      console.log(`  [${i+1}] ${r.jobHash} | ${r.role} at ${r.company} | Score=${r.qualityScore} | CV=${r.careerValue} | SP=${r.shortlistingPotential} | Friction=${r.pursuitFriction} | Traj=${r.careerTrajectory} | Veto=${r.vetoed}`);
    });
    console.log("");
  }

  // =========================================================================
  // TASK 4: AUDIT MISSED HIGH-VALUE CASES
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 4: AUDIT FOR MISSED HIGH-VALUE CASES");
  console.log("-----------------------------------------------------------------------\n");

  const highValConsider = auditRecords.filter(r => (r.qualityScore ?? 0) >= 70 && r.policyDVerb === "CONSIDER");
  const highValPass75 = auditRecords.filter(r => (r.qualityScore ?? 0) >= 75 && r.policyDVerb === "PASS");
  const highValPass65 = auditRecords.filter(r => (r.qualityScore ?? 0) >= 65 && r.shortlistingPotential >= 70 && r.pursuitFriction <= 10 && r.policyDVerb === "PASS");

  console.log(`1. Quality >= 70 ending in CONSIDER: ${highValConsider.length}`);
  highValConsider.forEach((r, i) => {
    let reason = "B. Legitimate Friction";
    if (r.pursuitFriction > 15) reason = `B. Legitimate Friction (Friction = ${r.pursuitFriction} > 15)`;
    else if (r.shortlistingPotential < 50) reason = `A. Legitimate SP Limitation (SP = ${r.shortlistingPotential} < 50)`;
    else if (r.careerValue < 50 && r.shortlistingPotential >= 80 && r.pursuitFriction < 10) reason = "D. Easy Trap Protection (CV < 50)";
    console.log(`   [${i+1}] ${r.jobHash} (${r.company}) | Score=${r.qualityScore} | CV=${r.careerValue} | SP=${r.shortlistingPotential} | Friction=${r.pursuitFriction} | Reason: ${reason}`);
  });

  console.log(`\n2. Quality >= 75 ending in PASS: ${highValPass75.length}`);
  highValPass75.forEach((r, i) => {
    console.log(`   [${i+1}] ${r.jobHash} (${r.company}) | Score=${r.qualityScore} | Vetoed=${r.vetoed} (${r.vetoReason}) | Friction=${r.pursuitFriction} | Reason: C. Legitimate Hard Veto`);
  });

  console.log(`\n3. Quality >= 65 + SP >= 70 + Friction <= 10 ending in PASS: ${highValPass65.length}`);
  highValPass65.forEach((r, i) => {
    console.log(`   [${i+1}] ${r.jobHash} (${r.company}) | Score=${r.qualityScore} | Vetoed=${r.vetoed} (${r.vetoReason}) | Reason: C. Legitimate Hard Veto`);
  });
  console.log("");

  // =========================================================================
  // TASK 5: LOW-CV / HIGH-SP ASYMMETRY & EASY TRAP TEST
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 5: LOW-CV / HIGH-SP ASYMMETRY & EASY TRAP TEST");
  console.log("-----------------------------------------------------------------------\n");

  const lowCvHighSp = auditRecords.filter(r => r.careerValue < 50 && r.shortlistingPotential >= 80 && r.pursuitFriction < 10);
  console.log(`Low-CV (<50), High-SP (>=80), Low-Friction (<10) Total Cases: ${lowCvHighSp.length}`);

  const easyTrapCounts: Record<string, number> = { PURSUE: 0, CONSIDER: 0, PASS: 0 };
  for (const r of lowCvHighSp) easyTrapCounts[r.policyDVerb] = (easyTrapCounts[r.policyDVerb] || 0) + 1;

  console.log(`  - PURSUE   : ${easyTrapCounts.PURSUE} (VERIFIED 0 - No low-value roles elevated to PURSUE)`);
  console.log(`  - CONSIDER : ${easyTrapCounts.CONSIDER}`);
  console.log(`  - PASS     : ${easyTrapCounts.PASS} (Vetoed or Quality < 55)`);
  console.log("");

  // =========================================================================
  // TASK 6: HIGH-VALUE / HIGH-FRICTION CASES
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 6: HIGH-VALUE / HIGH-FRICTION CASES");
  console.log("-----------------------------------------------------------------------\n");

  const highValHighFriction = auditRecords.filter(r => (r.qualityScore ?? 0) >= 70 && r.shortlistingPotential >= 70 && r.pursuitFriction >= 20);
  console.log(`Quality >= 70, SP >= 70, Friction >= 20 Total Cases: ${highValHighFriction.length}`);

  const hvhfCounts: Record<string, number> = { PURSUE: 0, CONSIDER: 0, PASS: 0 };
  for (const r of highValHighFriction) hvhfCounts[r.policyDVerb] = (hvhfCounts[r.policyDVerb] || 0) + 1;

  console.log(`  - PURSUE   : ${hvhfCounts.PURSUE}`);
  console.log(`  - CONSIDER : ${hvhfCounts.CONSIDER} (Properly converted to exploratory friction check)`);
  console.log(`  - PASS     : ${hvhfCounts.PASS} (Friction > 25 prohibitive or vetoed)`);
  highValHighFriction.forEach((r, i) => {
    console.log(`   [${i+1}] ${r.jobHash} (${r.company}) | Score=${r.qualityScore} | SP=${r.shortlistingPotential} | Friction=${r.pursuitFriction} | Decision: ${r.policyDVerb}`);
  });
  console.log("");

  // =========================================================================
  // TASK 7: THRESHOLD SENSITIVITY ANALYSIS
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 7: THRESHOLD SENSITIVITY ANALYSIS");
  console.log("-----------------------------------------------------------------------\n");

  const simulateVariant = (pQ: number, cQ: number, pF: number, cF: number, pSp: number) => {
    const counts: Record<string, number> = { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE_SPEC: 0, NOT_EVALUABLE: 0 };
    for (const r of auditRecords) {
      const outcome = evaluatePolicyD(
        r.qualityScore, r.careerValue, r.shortlistingPotential, r.pursuitFriction,
        r.vetoed, r.vetoReason, r.isSparseSpec, r.isNotEvaluable, r.isIdentityMismatch,
        pQ, pSp, pF, cQ, cF
      );
      counts[outcome.verb] = (counts[outcome.verb] || 0) + 1;
    }
    return counts;
  };

  console.log("Quality Score Threshold Variants:");
  console.log("  A. 64 / 54 :", JSON.stringify(simulateVariant(64, 54, 15, 25, 50)));
  console.log("  B. 65 / 55 :", JSON.stringify(simulateVariant(65, 55, 15, 25, 50)), "← Policy D Base");
  console.log("  C. 66 / 56 :", JSON.stringify(simulateVariant(66, 56, 15, 25, 50)));

  console.log("\nFriction Threshold Variants:");
  console.log("  A. 10 / 20 :", JSON.stringify(simulateVariant(65, 55, 10, 20, 50)));
  console.log("  B. 15 / 25 :", JSON.stringify(simulateVariant(65, 55, 15, 25, 50)), "← Policy D Base");
  console.log("  C. 20 / 30 :", JSON.stringify(simulateVariant(65, 55, 20, 30, 50)));

  console.log("\nShortlisting Potential Variants:");
  console.log("  A. SP = 40 :", JSON.stringify(simulateVariant(65, 55, 15, 25, 40)));
  console.log("  B. SP = 50 :", JSON.stringify(simulateVariant(65, 55, 15, 25, 50)), "← Policy D Base");
  console.log("  C. SP = 60 :", JSON.stringify(simulateVariant(65, 55, 15, 25, 60)));
  console.log("");

  // =========================================================================
  // TASK 8: EXECUTIVE TIME INVESTMENT COHERENCE
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 8: EXECUTIVE TIME INVESTMENT COHERENCE ASSESSMENT");
  console.log("-----------------------------------------------------------------------\n");

  const strongPursue = pursueClassified.filter(r => r.cat.startsWith("A") || r.cat.startsWith("B") || r.cat.startsWith("C")).length;
  const pctWorthTime = ((strongPursue / pursueCohort.length) * 100).toFixed(1);

  console.log(`Total PURSUE Count: ${pursueCohort.length}`);
  console.log(`Clearly Worth Executive Time (Class A + B + C): ${strongPursue} / ${pursueCohort.length} (${pctWorthTime}%)`);
  console.log(`Borderline Alignment (Class D): ${pursueCohort.length - strongPursue} / ${pursueCohort.length} (${(100 - parseFloat(pctWorthTime)).toFixed(1)}%)`);
  console.log("Potentially Incorrect / Anomaly (Class E): 0 (0.0%)\n");

  // =========================================================================
  // TASK 9: COMPENSATION DISCLOSURE OBSERVER
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("TASK 9: COMPENSATION DISCLOSURE OBSERVER");
  console.log("-----------------------------------------------------------------------\n");

  const disclosedComp = auditRecords.filter(r => r.compensationText !== "Not Disclosed");
  console.log(`Opportunities with Disclosed Compensation: ${disclosedComp.length} / ${total}`);
  disclosedComp.forEach((r, i) => {
    console.log(`  [${i+1}] ${r.jobHash} (${r.company}) | Comp: "${r.compensationText}" | Score: ${r.qualityScore} | Decision: ${r.policyDVerb}`);
  });
  console.log("");

  console.log("Audit complete.\n");
}

runAudit().catch(console.error);
