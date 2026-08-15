import { runEngine } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { DecisionVerb } from "../src/data/opportunity-fixtures";

interface SimulationRecord {
  jobHash: string;
  role: string;
  company: string;
  qualityScore: number | null;
  careerValue: number;
  shortlistingPotential: number;
  pursuitFriction: number;
  vetoed: boolean;
  vetoReason: string | null;
  currentVerb: DecisionVerb;
  confidence: number;
  isSparseSpec: boolean;
  isIdentityMismatch: boolean;
  isNotEvaluable: boolean;
}

// Define candidate policy functions
type PolicyEvaluator = (rec: SimulationRecord) => { verb: DecisionVerb; ruleTriggered: string };

// Policy A: Pure Quality Thresholds (e.g., PURSUE >= 65, CONSIDER >= 55)
function evaluatePolicyA(rec: SimulationRecord, pursueCutoff = 65, considerCutoff = 55): { verb: DecisionVerb; ruleTriggered: string } {
  if (rec.qualityScore === null) {
    if (rec.isSparseSpec) return { verb: "SPARSE_SPEC", ruleTriggered: "GATE-SPARSE" };
    if (rec.isNotEvaluable) return { verb: "NOT_EVALUABLE", ruleTriggered: "GATE-INTEGRITY" };
    return { verb: "PASS", ruleTriggered: "GATE-IDENTITY" };
  }
  if (rec.vetoed) {
    return { verb: "PASS", ruleTriggered: rec.vetoReason || "VETO-HARD" };
  }
  if (rec.qualityScore >= pursueCutoff) {
    return { verb: "PURSUE", ruleTriggered: `POL-A-PURSUE-${pursueCutoff}` };
  }
  if (rec.qualityScore >= considerCutoff) {
    return { verb: "CONSIDER", ruleTriggered: `POL-A-CONSIDER-${considerCutoff}` };
  }
  return { verb: "PASS", ruleTriggered: "POL-A-PASS" };
}

// Policy B: Quality + SP (Quality establishes worthiness; SP constrains attainability)
// e.g. Quality >= 65 AND SP >= 50 -> PURSUE.
// If Quality >= 65 but SP < 50 -> Demote to CONSIDER (Reach role).
// Quality >= 55 AND SP >= 40 -> CONSIDER.
function evaluatePolicyB(rec: SimulationRecord, pursueQuality = 65, pursueSp = 50, considerQuality = 55): { verb: DecisionVerb; ruleTriggered: string } {
  if (rec.qualityScore === null) {
    if (rec.isSparseSpec) return { verb: "SPARSE_SPEC", ruleTriggered: "GATE-SPARSE" };
    if (rec.isNotEvaluable) return { verb: "NOT_EVALUABLE", ruleTriggered: "GATE-INTEGRITY" };
    return { verb: "PASS", ruleTriggered: "GATE-IDENTITY" };
  }
  if (rec.vetoed) {
    return { verb: "PASS", ruleTriggered: rec.vetoReason || "VETO-HARD" };
  }

  if (rec.qualityScore >= pursueQuality) {
    if (rec.shortlistingPotential >= pursueSp) {
      return { verb: "PURSUE", ruleTriggered: "POL-B-PURSUE-HIGH-ATTAINABILITY" };
    } else {
      // Reach Role: High quality but low shortlisting potential -> CONSIDER
      return { verb: "CONSIDER", ruleTriggered: "POL-B-CONSIDER-REACH-ROLE" };
    }
  }

  if (rec.qualityScore >= considerQuality) {
    return { verb: "CONSIDER", ruleTriggered: "POL-B-CONSIDER-QUALIFIED" };
  }

  return { verb: "PASS", ruleTriggered: "POL-B-PASS" };
}

// Policy C: Quality + SP + Friction (Cost of Pursuit modifier)
// e.g. Quality >= 65, SP >= 50, Friction <= 15 -> PURSUE.
// If Quality >= 65, SP >= 50, but Friction > 15 -> Demote PURSUE to CONSIDER (High Friction).
// If Quality >= 65, SP < 50 -> CONSIDER (Reach).
// If Quality >= 55, Friction <= 25 -> CONSIDER. If Friction > 25 -> PASS.
function evaluatePolicyC(
  rec: SimulationRecord,
  pursueQuality = 65,
  pursueSp = 50,
  maxPursueFriction = 15,
  considerQuality = 55,
  maxConsiderFriction = 25
): { verb: DecisionVerb; ruleTriggered: string } {
  if (rec.qualityScore === null) {
    if (rec.isSparseSpec) return { verb: "SPARSE_SPEC", ruleTriggered: "GATE-SPARSE" };
    if (rec.isNotEvaluable) return { verb: "NOT_EVALUABLE", ruleTriggered: "GATE-INTEGRITY" };
    return { verb: "PASS", ruleTriggered: "GATE-IDENTITY" };
  }
  if (rec.vetoed) {
    return { verb: "PASS", ruleTriggered: rec.vetoReason || "VETO-HARD" };
  }

  if (rec.qualityScore >= pursueQuality) {
    if (rec.shortlistingPotential < pursueSp) {
      return { verb: "CONSIDER", ruleTriggered: "POL-C-CONSIDER-LOW-SP" };
    }
    if (rec.pursuitFriction > maxPursueFriction) {
      return { verb: "CONSIDER", ruleTriggered: "POL-C-CONSIDER-HIGH-FRICTION" };
    }
    return { verb: "PURSUE", ruleTriggered: "POL-C-PURSUE-OPTIMAL" };
  }

  if (rec.qualityScore >= considerQuality) {
    if (rec.pursuitFriction > maxConsiderFriction) {
      return { verb: "PASS", ruleTriggered: "POL-C-PASS-PROHIBITIVE-FRICTION" };
    }
    return { verb: "CONSIDER", ruleTriggered: "POL-C-CONSIDER-QUALIFIED" };
  }

  return { verb: "PASS", ruleTriggered: "POL-C-PASS" };
}

// Policy D: Quality + SP + Friction + Easy Trap / Career Value Protection
// Policy C + Explicit Easy Trap rule: CV < 50, SP >= 80, Friction < 10 -> CONSIDER (never PURSUE).
function evaluatePolicyD(
  rec: SimulationRecord,
  pursueQuality = 65,
  pursueSp = 50,
  maxPursueFriction = 15,
  considerQuality = 55,
  maxConsiderFriction = 25
): { verb: DecisionVerb; ruleTriggered: string } {
  if (rec.qualityScore === null) {
    if (rec.isSparseSpec) return { verb: "SPARSE_SPEC", ruleTriggered: "GATE-SPARSE" };
    if (rec.isNotEvaluable) return { verb: "NOT_EVALUABLE", ruleTriggered: "GATE-INTEGRITY" };
    return { verb: "PASS", ruleTriggered: "GATE-IDENTITY" };
  }
  if (rec.vetoed) {
    return { verb: "PASS", ruleTriggered: rec.vetoReason || "VETO-HARD" };
  }

  // Easy Trap Check: CV < 50, SP >= 80, Friction < 10
  const isEasyTrap = rec.careerValue < 50 && rec.shortlistingPotential >= 80 && rec.pursuitFriction < 10;

  if (rec.qualityScore >= pursueQuality) {
    if (isEasyTrap) {
      return { verb: "CONSIDER", ruleTriggered: "R-CONSIDER-CAREER-VALUE-PROTECTION" };
    }
    if (rec.shortlistingPotential < pursueSp) {
      return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-REACH-ROLE" };
    }
    if (rec.pursuitFriction > maxPursueFriction) {
      return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-HIGH-FRICTION" };
    }
    return { verb: "PURSUE", ruleTriggered: "POL-D-PURSUE-BALANCED" };
  }

  if (rec.qualityScore >= considerQuality) {
    if (rec.pursuitFriction > maxConsiderFriction) {
      return { verb: "PASS", ruleTriggered: "POL-D-PASS-PROHIBITIVE-FRICTION" };
    }
    return { verb: "CONSIDER", ruleTriggered: "POL-D-CONSIDER-QUALIFIED" };
  }

  return { verb: "PASS", ruleTriggered: "POL-D-PASS" };
}

async function runSimulation() {
  console.log("=======================================================================");
  console.log("P4-A.6 — DECISION THRESHOLD & POLICY CALIBRATION SIMULATION (N = 1,514)");
  console.log("=======================================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection);

  const total = records.length;

  const simRecords: SimulationRecord[] = records.map(r => {
    const isSparseSpec = r.verb === "SPARSE_SPEC";
    const isNotEvaluable = r.verb === "NOT_EVALUABLE";
    const isIdentityMismatch = r.vetoReason === "G-EXECUTIVE-IDENTITY-MISMATCH";
    return {
      jobHash: r.jobHash,
      role: (r.explanation?.headline || r.jobHash).split("at")[0]?.trim() || r.jobHash,
      company: (r as any).opportunity?.company || "Unknown",
      qualityScore: r.qualityScore,
      careerValue: r.decisionSummary?.careerValue ?? 0,
      shortlistingPotential: r.decisionSummary?.shortlistingPotential ?? 0,
      pursuitFriction: r.decisionSummary?.pursuitFriction ?? 0,
      vetoed: !!r.vetoed,
      vetoReason: r.vetoReason || null,
      currentVerb: r.verb,
      confidence: r.confidence ?? 0,
      isSparseSpec,
      isIdentityMismatch,
      isNotEvaluable
    };
  });

  console.log(`Corpus Loaded: ${simRecords.length} records.\n`);

  // =========================================================================
  // SECTION 1: QUALITY BANDS FORENSICS
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("SECTION 1: QUALITY BANDS FORENSICS (ALL 1,514 OPPORTUNITIES)");
  console.log("-----------------------------------------------------------------------\n");

  const bands = [
    { label: "N/A (Null Quality Score)", filter: (r: SimulationRecord) => r.qualityScore === null },
    { label: "30–39 Quality Band", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore >= 30 && r.qualityScore < 40 },
    { label: "40–49 Quality Band", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore >= 40 && r.qualityScore < 50 },
    { label: "50–59 Quality Band", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore >= 50 && r.qualityScore < 60 },
    { label: "60–69 Quality Band", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore >= 60 && r.qualityScore < 70 },
    { label: "70–79 Quality Band", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore >= 70 && r.qualityScore < 80 },
    { label: "80–89 Quality Band", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore >= 80 && r.qualityScore < 90 },
    { label: "90–100 Quality Band", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore >= 90 }
  ];

  for (const b of bands) {
    const list = simRecords.filter(b.filter);
    console.log(`=== ${b.label} (Count: ${list.length}, ${((list.length / total) * 100).toFixed(2)}%) ===`);
    if (list.length === 0) {
      console.log("  [No opportunities in this band]\n");
      continue;
    }

    // Decision distribution
    const verbCounts: Record<string, number> = {};
    for (const r of list) verbCounts[r.currentVerb] = (verbCounts[r.currentVerb] || 0) + 1;
    const verbStr = Object.entries(verbCounts).map(([v, c]) => `${v}: ${c} (${((c / list.length) * 100).toFixed(1)}%)`).join(" | ");

    // Veto distribution
    const vetoCounts: Record<string, number> = {};
    let totalVetoed = 0;
    for (const r of list) {
      if (r.vetoed) {
        totalVetoed++;
        const reason = r.vetoReason || "UNKNOWN_VETO";
        vetoCounts[reason] = (vetoCounts[reason] || 0) + 1;
      }
    }
    const vetoStr = totalVetoed === 0 ? "None" : Object.entries(vetoCounts).map(([v, c]) => `${v}: ${c}`).join(", ");

    // Averages
    const meanSP = (list.reduce((acc, r) => acc + r.shortlistingPotential, 0) / list.length).toFixed(2);
    const meanFriction = (list.reduce((acc, r) => acc + r.pursuitFriction, 0) / list.length).toFixed(2);
    const meanCV = (list.reduce((acc, r) => acc + r.careerValue, 0) / list.length).toFixed(2);
    const meanConf = (list.reduce((acc, r) => acc + r.confidence, 0) / list.length).toFixed(2);

    console.log(`  Current Verbs : ${verbStr}`);
    console.log(`  Averages      : CV=${meanCV} | SP=${meanSP} | Friction=${meanFriction} | Confidence=${meanConf}`);
    console.log(`  Vetoed Count  : ${totalVetoed}/${list.length} (${((totalVetoed / list.length) * 100).toFixed(1)}%) -> [${vetoStr}]\n`);
  }

  // =========================================================================
  // SECTION 2: POLICY SIMULATIONS COMPARISON (POLICY A, B, C, D)
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("SECTION 2: CANDIDATE POLICY SIMULATIONS EVALUATION");
  console.log("-----------------------------------------------------------------------\n");

  const policies: { name: string; desc: string; eval: PolicyEvaluator }[] = [
    { name: "Current Production Baseline", desc: "PURSUE >= 70, CONSIDER >= 60", eval: r => ({ verb: r.currentVerb, ruleTriggered: "BASELINE" }) },
    { name: "Policy A1 (Pure Quality 68/58)", desc: "PURSUE >= 68, CONSIDER >= 58", eval: r => evaluatePolicyA(r, 68, 58) },
    { name: "Policy A2 (Pure Quality 65/55)", desc: "PURSUE >= 65, CONSIDER >= 55", eval: r => evaluatePolicyA(r, 65, 55) },
    { name: "Policy B (Quality 65 + SP 50 Filter)", desc: "PURSUE requires Quality>=65 & SP>=50; CONSIDER>=55", eval: r => evaluatePolicyB(r, 65, 50, 55) },
    { name: "Policy C (Quality 65 + SP 50 + Friction 15)", desc: "Quality>=65 & SP>=50 & Friction<=15 -> PURSUE; Friction>15 -> CONSIDER", eval: r => evaluatePolicyC(r, 65, 50, 15, 55, 25) },
    { name: "Policy D (Quality 65 + SP 50 + Friction 15 + Easy Trap)", desc: "Policy C + Easy Trap Protection (CV<50 & SP>=80 & Friction<10 -> CONSIDER)", eval: r => evaluatePolicyD(r, 65, 50, 15, 55, 25) }
  ];

  for (const pol of policies) {
    console.log(`=== ${pol.name} (${pol.desc}) ===`);
    const results = simRecords.map(r => {
      const outcome = pol.eval(r);
      return { ...r, newVerb: outcome.verb, ruleTriggered: outcome.ruleTriggered };
    });

    const verbCounts: Record<string, number> = { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE_SPEC: 0, NOT_EVALUABLE: 0 };
    let totalChanged = 0;
    let pursueToConsider = 0;
    let pursueToPass = 0;
    let considerToPursue = 0;
    let considerToPass = 0;
    let passToConsider = 0;
    let passToPursue = 0;

    for (const res of results) {
      verbCounts[res.newVerb] = (verbCounts[res.newVerb] || 0) + 1;
      if (res.newVerb !== res.currentVerb) {
        totalChanged++;
        if (res.currentVerb === "PURSUE" && res.newVerb === "CONSIDER") pursueToConsider++;
        if (res.currentVerb === "PURSUE" && res.newVerb === "PASS") pursueToPass++;
        if (res.currentVerb === "CONSIDER" && res.newVerb === "PURSUE") considerToPursue++;
        if (res.currentVerb === "CONSIDER" && res.newVerb === "PASS") considerToPass++;
        if (res.currentVerb === "PASS" && res.newVerb === "CONSIDER") passToConsider++;
        if (res.currentVerb === "PASS" && res.newVerb === "PURSUE") passToPursue++;
      }
    }

    console.log("  Verb Breakdown:");
    for (const [v, c] of Object.entries(verbCounts)) {
      console.log(`    - ${v.padEnd(14)}: ${c.toString().padStart(4)} (${((c / total) * 100).toFixed(2)}%)`);
    }
    console.log(`  Changes vs Baseline: ${totalChanged} records changed (${((totalChanged / total) * 100).toFixed(2)}%)`);
    if (pol.name !== "Current Production Baseline") {
      console.log(`    - PURSUE -> CONSIDER: ${pursueToConsider}`);
      console.log(`    - PURSUE -> PASS    : ${pursueToPass}`);
      console.log(`    - CONSIDER -> PURSUE: ${considerToPursue}`);
      console.log(`    - CONSIDER -> PASS  : ${considerToPass}`);
      console.log(`    - PASS -> CONSIDER  : ${passToConsider}`);
      console.log(`    - PASS -> PURSUE    : ${passToPursue}`);
    }
    console.log("");
  }

  // =========================================================================
  // SECTION 3: ADVERSARIAL CHALLENGE CASES INSPECTION
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("SECTION 3: ADVERSARIAL CHALLENGE CASES INSPECTION");
  console.log("-----------------------------------------------------------------------\n");

  // Specific categories
  const categories = [
    { name: "1. Obvious Winners (Quality>=75, CV>=75, SP>=70, Friction<=10)", filter: (r: SimulationRecord) => (r.qualityScore ?? 0) >= 75 && r.careerValue >= 75 && r.shortlistingPotential >= 70 && r.pursuitFriction <= 10 && !r.vetoed },
    { name: "2. Obvious Losers (Quality<50, CV<50, SP<50, Friction>=15)", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore < 50 && r.careerValue < 50 && r.shortlistingPotential < 50 && r.pursuitFriction >= 15 },
    { name: "3. High CV / Low SP (Reach roles: CV>=75, SP<50, Quality>=60)", filter: (r: SimulationRecord) => r.careerValue >= 75 && r.shortlistingPotential < 50 && (r.qualityScore ?? 0) >= 60 && !r.vetoed },
    { name: "4. Low CV / High SP (Easy lateral: CV<50, SP>=75, Quality<60)", filter: (r: SimulationRecord) => r.careerValue < 50 && r.shortlistingPotential >= 75 && r.qualityScore !== null && r.qualityScore < 60 && !r.vetoed },
    { name: "5. High CV / High Friction (Stretch worth effort: CV>=75, Friction>=20, Quality>=60)", filter: (r: SimulationRecord) => r.careerValue >= 75 && r.pursuitFriction >= 20 && (r.qualityScore ?? 0) >= 60 && !r.vetoed },
    { name: "6. Low CV / Low Friction (Poor alignment, easy: CV<50, Friction<10, Quality<55)", filter: (r: SimulationRecord) => r.careerValue < 50 && r.pursuitFriction < 10 && r.qualityScore !== null && r.qualityScore < 55 && !r.vetoed },
    { name: "7. High Quality / High Friction (Quality>=70, Friction>=20)", filter: (r: SimulationRecord) => (r.qualityScore ?? 0) >= 70 && r.pursuitFriction >= 20 && !r.vetoed },
    { name: "8. High Quality / Low SP (Quality>=70, SP<50)", filter: (r: SimulationRecord) => (r.qualityScore ?? 0) >= 70 && r.shortlistingPotential < 50 && !r.vetoed },
    { name: "9. Low Quality / High SP (Quality<55, SP>=75)", filter: (r: SimulationRecord) => r.qualityScore !== null && r.qualityScore < 55 && r.shortlistingPotential >= 75 && !r.vetoed },
    { name: "10. Easy Trap Condition A (CV<50, SP>=80, Friction<10)", filter: (r: SimulationRecord) => r.careerValue < 50 && r.shortlistingPotential >= 80 && r.pursuitFriction < 10 && !r.vetoed },
    { name: "11. Identity Mismatches (distance >= 0.80)", filter: (r: SimulationRecord) => r.isIdentityMismatch },
    { name: "12. Sub-Tier Roles Veto (G-SUB-TIER-MANDATE-VETO)", filter: (r: SimulationRecord) => r.vetoReason === "G-SUB-TIER-MANDATE-VETO" },
    { name: "13. Operating Level Regression Veto (G-COMPATIBILITY-REGRESSION-VETO)", filter: (r: SimulationRecord) => r.vetoReason === "G-COMPATIBILITY-REGRESSION-VETO" },
    { name: "14. SPARSE_SPEC / NOT_EVALUABLE", filter: (r: SimulationRecord) => r.isSparseSpec || r.isNotEvaluable }
  ];

  for (const cat of categories) {
    const list = simRecords.filter(cat.filter);
    console.log(`Category: ${cat.name} (Count: ${list.length})`);

    if (list.length === 0) {
      console.log("  [No matching records]\n");
      continue;
    }

    // Evaluate across Baseline, Policy A2, Policy B, Policy C, Policy D
    const polBaseline = list.map(r => r.currentVerb);
    const polA = list.map(r => evaluatePolicyA(r, 65, 55).verb);
    const polB = list.map(r => evaluatePolicyB(r, 65, 50, 55).verb);
    const polC = list.map(r => evaluatePolicyC(r, 65, 50, 15, 55, 25).verb);
    const polD = list.map(r => evaluatePolicyD(r, 65, 50, 15, 55, 25).verb);

    const countVerbs = (arr: DecisionVerb[]) => {
      const c: Record<string, number> = {};
      for (const v of arr) c[v] = (c[v] || 0) + 1;
      return Object.entries(c).map(([v, cnt]) => `${v}: ${cnt}`).join(", ");
    };

    console.log(`  - Baseline : ${countVerbs(polBaseline)}`);
    console.log(`  - Policy A2: ${countVerbs(polA)}`);
    console.log(`  - Policy B : ${countVerbs(polB)}`);
    console.log(`  - Policy C : ${countVerbs(polC)}`);
    console.log(`  - Policy D : ${countVerbs(polD)}`);
    console.log("");
  }

  // =========================================================================
  // SECTION 4: DETAILED CHANGE ANALYSIS FOR RECOMMENDED POLICY D
  // =========================================================================
  console.log("-----------------------------------------------------------------------");
  console.log("SECTION 4: TOP CHANGED DECISIONS INSPECTION (POLICY D vs BASELINE)");
  console.log("-----------------------------------------------------------------------\n");

  const polDResults = simRecords.map(r => {
    const outcome = evaluatePolicyD(r, 65, 50, 15, 55, 25);
    return { ...r, newVerb: outcome.verb, ruleTriggered: outcome.ruleTriggered };
  });

  const changedRecords = polDResults.filter(r => r.newVerb !== r.currentVerb);
  console.log(`Total changed records under Policy D: ${changedRecords.length}\n`);

  console.log("Sample 20 Changed Decisions:");
  changedRecords.slice(0, 20).forEach((r, idx) => {
    console.log(` [${(idx + 1).toString().padStart(2)}] ${r.jobHash} (${r.company}) | Score: ${r.qualityScore} | CV: ${r.careerValue} | SP: ${r.shortlistingPotential} | Friction: ${r.pursuitFriction}`);
    console.log(`      Baseline: ${r.currentVerb} -> Policy D: ${r.newVerb} [Triggered: ${r.ruleTriggered}]`);
  });

  console.log("\nSimulation execution complete.\n");
}

runSimulation().catch(console.error);
