import { runEngine, readOpportunities } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";

async function runProductionCorpusAudit() {
  console.log("==========================================================================");
  console.log("             P4-A.7 FULL CORPUS POLICY D PRODUCTION AUDIT                 ");
  console.log("==========================================================================");

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection);
  const rawOpps = readOpportunities();

  console.log(`Loaded ${records.length} evaluated records from live engine (raw corpus: ${rawOpps.length}).`);

  const rawMap = new Map<string, any>(rawOpps.map(o => [o.jobHash, o]));

  const distribution = {
    PURSUE: 0,
    CONSIDER: 0,
    PASS: 0,
    SPARSE_SPEC: 0,
    NOT_EVALUABLE: 0,
    TOTAL: 0
  };

  const results: Array<{
    hash: string;
    role: string;
    company: string;
    verdict: string;
    qualityScore: number | null;
    sp: number;
    friction: number;
    cv: number;
    vetoed: boolean;
    vetoReason: string | null;
  }> = [];

  let invalidPursueCount = 0;
  let zeroAsNaCount = 0;

  for (const r of records) {
    distribution.TOTAL++;
    const raw = rawMap.get(r.jobHash) || {};

    const verdict = r.verb as keyof typeof distribution;
    if (distribution[verdict] !== undefined) {
      distribution[verdict]++;
    }

    const qualityScore = r.qualityScore;
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    const friction = r.decisionSummary?.pursuitFriction ?? 0;
    const cv = r.decisionSummary?.careerValue ?? 0;
    const vetoed = !!r.vetoed;
    const vetoReason = r.vetoReason || null;

    results.push({
      hash: r.jobHash,
      role: raw.role || (r.explanation?.headline || r.jobHash).split("at")[0]?.trim() || r.jobHash,
      company: raw.company || "Target Company",
      verdict: r.verb,
      qualityScore,
      sp,
      friction,
      cv,
      vetoed,
      vetoReason
    });

    // Invariant Check B: PURSUE validation
    if (r.verb === "PURSUE") {
      if ((qualityScore ?? 0) < 65 || sp < 50 || friction > 15 || vetoed) {
        invalidPursueCount++;
        console.error(`INVALID PURSUE: ${r.jobHash} (Quality: ${qualityScore}, SP: ${sp}, Friction: ${friction}, Vetoed: ${vetoed})`);
      }
    }

    // Invariant Check F: 0 used as N/A in SPARSE_SPEC or NOT_EVALUABLE
    if (qualityScore === 0 && (r.verb === "SPARSE_SPEC" || r.verb === "NOT_EVALUABLE")) {
      zeroAsNaCount++;
    }
  }

  console.log("\n--------------------------------------------------------------------------");
  console.log("                     FULL CORPUS DECISION DISTRIBUTION                    ");
  console.log("--------------------------------------------------------------------------");
  console.log(`  PURSUE        : ${distribution.PURSUE.toString().padStart(4)} (${(distribution.PURSUE / distribution.TOTAL * 100).toFixed(2)}%)`);
  console.log(`  CONSIDER      : ${distribution.CONSIDER.toString().padStart(4)} (${(distribution.CONSIDER / distribution.TOTAL * 100).toFixed(2)}%)`);
  console.log(`  PASS          : ${distribution.PASS.toString().padStart(4)} (${(distribution.PASS / distribution.TOTAL * 100).toFixed(2)}%)`);
  console.log(`  SPARSE_SPEC   : ${distribution.SPARSE_SPEC.toString().padStart(4)} (${(distribution.SPARSE_SPEC / distribution.TOTAL * 100).toFixed(2)}%)`);
  console.log(`  NOT_EVALUABLE : ${distribution.NOT_EVALUABLE.toString().padStart(4)} (${(distribution.NOT_EVALUABLE / distribution.TOTAL * 100).toFixed(2)}%)`);
  console.log(`  TOTAL         : ${distribution.TOTAL.toString().padStart(4)} (100.00%)`);
  console.log("--------------------------------------------------------------------------");

  console.log("\n--------------------------------------------------------------------------");
  console.log("                        CRITICAL POLICY INVARIANTS                         ");
  console.log("--------------------------------------------------------------------------");
  console.log(`  A & B. Invalid PURSUE cases                       : ${invalidPursueCount} (Expected 0)`);
  console.log(`  F. 0 used as N/A in SPARSE_SPEC/NOT_EVALUABLE   : ${zeroAsNaCount} (Expected 0)`);
  console.log("--------------------------------------------------------------------------\n");

  // Dynamically extract Group A (Bottom 10 PURSUE) and Group B (Top 10 CONSIDER)
  const groupA = results
    .filter(r => r.verdict === "PURSUE")
    .sort((a, b) => (a.qualityScore ?? 0) - (b.qualityScore ?? 0) || a.cv - b.cv)
    .slice(0, 10);

  const groupB = results
    .filter(r => r.verdict === "CONSIDER")
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0) || b.cv - a.cv)
    .slice(0, 10);

  console.log("--------------------------------------------------------------------------");
  console.log("            GROUP A: BOTTOM 10 PURSUE BOUNDARY CASES (LOWEST QUALITY)     ");
  console.log("--------------------------------------------------------------------------");
  groupA.forEach((r, i) => {
    console.log(`  [A-${(i+1).toString().padStart(2)}] Hash:${r.hash.padEnd(16)} | ${r.role.slice(0,30).padEnd(30)} | Quality=${r.qualityScore} | SP=${r.sp} | Friction=${r.friction}`);
  });

  console.log("\n--------------------------------------------------------------------------");
  console.log("            GROUP B: TOP 10 CONSIDER BOUNDARY CASES (HIGHEST QUALITY)     ");
  console.log("--------------------------------------------------------------------------");
  groupB.forEach((r, i) => {
    console.log(`  [B-${(i+1).toString().padStart(2)}] Hash:${r.hash.padEnd(16)} | ${r.role.slice(0,30).padEnd(30)} | Quality=${r.qualityScore} | SP=${r.sp} | Friction=${r.friction}`);
  });
  console.log("\n--------------------------------------------------------------------------\n");
}

runProductionCorpusAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
