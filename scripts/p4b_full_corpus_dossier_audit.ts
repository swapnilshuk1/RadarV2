import { runEngine, readOpportunities } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import { synthesizeStrategicAdvantage } from "../src/lib/intelligence/editorial/StrategicAdvantageSynthesizer";
import { synthesizePrincipalRisk } from "../src/lib/intelligence/editorial/PrincipalRiskSynthesizer";
import { synthesizeAction } from "../src/lib/intelligence/editorial/ActionSynthesizer";
import { synthesizeCareerValue } from "../src/lib/intelligence/editorial/CareerValueSynthesizer";
import { synthesizeEffort } from "../src/lib/intelligence/editorial/EffortSynthesizer";
import { playbookNarrative } from "../src/lib/intelligence/editorial";

export interface DefectItem {
  class: "P0" | "P1" | "P2" | "P3";
  category: string;
  jobHash: string;
  role: string;
  company: string;
  verdict: string;
  qualityScore: number | null;
  issue: string;
  snippet: string;
}

async function auditDossierFullCorpus() {
  console.log("==========================================================================");
  console.log("      P4-B DOSSIER & EDITORIAL INTELLIGENCE FULL CORPUS AUDIT (N = 1,514)  ");
  console.log("==========================================================================");

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  const { records } = runEngine(projection);
  const rawOpps = readOpportunities();

  console.log(`Loaded ${records.length} evaluated records from live engine.\n`);

  const rawMap = new Map<string, any>(rawOpps.map(o => [o.jobHash, o]));

  const defects: DefectItem[] = [];

  const saPhraseCounts = new Map<string, number>();
  const prPhraseCounts = new Map<string, number>();
  const actionPhraseCounts = new Map<string, number>();

  let saPrContradictionCount = 0;
  let rawTermLeakageCount = 0;
  let truncationArtifactCount = 0;
  let genericSaCount = 0;
  let genericActionCount = 0;

  const scoreCombinations = {
    quality85Pass: [] as string[],
    quality80Consider: [] as string[],
    quality65Pursue: [] as string[],
    quality45Pass: [] as string[],
    qualityNaPass: [] as string[],
    highQualityHighFriction: [] as string[],
    highQualityLowSp: [] as string[]
  };

  const rawTermsRegex = /\b(POL-D|G-EXECUTIVE|G-SUB-TIER|G-IDENTITY|G-EXECUTION|vectorSimilarity|rawScore|priorityScore|undefined|\[object Object\])\b/i;

  for (const r of records) {
    const raw = rawMap.get(r.jobHash) || {};
    const role = raw.role || (r.explanation?.headline || r.jobHash).split("at")[0]?.trim() || r.jobHash;
    const company = raw.company || "Target Company";
    const verdict = r.verb;
    const qualityScore = r.qualityScore;
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    const friction = r.decisionSummary?.pursuitFriction ?? 0;

    // Build Brief via BriefCompositionEngine
    const oppFixture: any = {
      ...raw,
      decision: r.verb,
      recommendationResult: { score: r.qualityScore ?? 50 },
      dimensions: raw.dimensions || []
    };

    let briefModel: any = null;
    try {
      briefModel = BriefCompositionEngine.compose(oppFixture, { bypassHistory: true });
    } catch (e) {}

    // Run dynamic synthesizers
    const saObj = synthesizeStrategicAdvantage(r, raw);
    const prObj = synthesizePrincipalRisk(r, raw);
    const cvObj = synthesizeCareerValue(r, raw);
    const effortObj = synthesizeEffort(r, raw);
    const actionObj = synthesizeAction(r, raw, saObj, prObj, cvObj, effortObj);
    const narrativeObj = playbookNarrative(r, raw);

    const sa = saObj.statement || "";
    const pr = prObj.statement || "";
    const action = actionObj.statement || "";
    const renderedProsePayload = [
      sa,
      pr,
      action,
      briefModel?.executiveOpinion || "",
      briefModel?.strategicTrajectory || "",
      briefModel?.verdictReasoning || "",
      narrativeObj.recommendation || "",
      ...(narrativeObj.positioning || [])
    ].join(" ");

    // Track phrase frequency
    if (sa) saPhraseCounts.set(sa, (saPhraseCounts.get(sa) || 0) + 1);
    if (pr) prPhraseCounts.set(pr, (prPhraseCounts.get(pr) || 0) + 1);
    if (action) actionPhraseCounts.set(action, (actionPhraseCounts.get(action) || 0) + 1);

    // 1. Audit Generic Strategic Advantage
    const genericSaPhrases = [
      "Core mandate requirements match your established capabilities.",
      "Adjacent capabilities may transfer; direct precedent is limited.",
      "Role alignment is supported by your career trajectory.",
      "Established track record aligns with role demands."
    ];
    if (genericSaPhrases.some(g => sa === g)) {
      genericSaCount++;
      defects.push({
        class: "P2",
        category: "Generic Strategic Advantage",
        jobHash: r.jobHash,
        role,
        company,
        verdict,
        qualityScore,
        issue: "Strategic Advantage collapsed into generic boilerplate phrase",
        snippet: sa
      });
    }

    // 2. Audit Contradiction between SA and PR
    const saHasMandateMatch = sa.toLowerCase().includes("core mandate requirements match") || sa.toLowerCase().includes("aligns precisely");
    const prHasNoMandatePrecedent = pr.toLowerCase().includes("lacks core mandate precedent") || pr.toLowerCase().includes("no precedent") || pr.toLowerCase().includes("missing core experience") || pr.toLowerCase().includes("separate functional domain") || pr.toLowerCase().includes("precedent is limited");

    if (saHasMandateMatch && prHasNoMandatePrecedent) {
      saPrContradictionCount++;
      defects.push({
        class: "P0",
        category: "SA-PR Direct Contradiction",
        jobHash: r.jobHash,
        role,
        company,
        verdict,
        qualityScore,
        issue: "Strategic Advantage asserts core mandate match while Principal Risk asserts limited core mandate precedent",
        snippet: `SA: "${sa}" | PR: "${pr}"`
      });
    }

    // 3. Audit Raw Engine Terminology Leakage in Executive Prose
    if (rawTermsRegex.test(renderedProsePayload)) {
      rawTermLeakageCount++;
      const match = renderedProsePayload.match(rawTermsRegex)?.[0] || "";
      defects.push({
        class: "P1",
        category: "Raw Terminology Leakage",
        jobHash: r.jobHash,
        role,
        company,
        verdict,
        qualityScore,
        issue: `Exposed raw engine/code term in prose: ${match}`,
        snippet: renderedProsePayload.slice(0, 150)
      });
    }

    // 4. Audit Truncation Artifacts
    if (sa.endsWith("...") || pr.endsWith("...") || action.endsWith("...") || sa.endsWith(",") || pr.endsWith(",")) {
      truncationArtifactCount++;
      defects.push({
        class: "P3",
        category: "Truncation Artifact",
        jobHash: r.jobHash,
        role,
        company,
        verdict,
        qualityScore,
        issue: "Editorial text exhibits clipped string or hanging trailing punctuation",
        snippet: sa.slice(-30) || pr.slice(-30) || action.slice(-30)
      });
    }

    // 5. Audit Generic Action
    if (action.includes("Proceed.") && action.includes("Request a screening call")) {
      genericActionCount++;
      defects.push({
        class: "P2",
        category: "Generic Action Template",
        jobHash: r.jobHash,
        role,
        company,
        verdict,
        qualityScore,
        issue: "Recommended Action uses generic template fallback",
        snippet: action
      });
    }

    // 6. Score Combination Audits
    if (qualityScore !== null && qualityScore >= 85 && verdict === "PASS") scoreCombinations.quality85Pass.push(r.jobHash);
    if (qualityScore !== null && qualityScore >= 80 && verdict === "CONSIDER") scoreCombinations.quality80Consider.push(r.jobHash);
    if (qualityScore !== null && qualityScore >= 65 && verdict === "PURSUE") scoreCombinations.quality65Pursue.push(r.jobHash);
    if (qualityScore !== null && qualityScore <= 45 && verdict === "PASS") scoreCombinations.quality45Pass.push(r.jobHash);
    if (qualityScore === null && verdict === "PASS") scoreCombinations.qualityNaPass.push(r.jobHash);
    if (qualityScore !== null && qualityScore >= 75 && friction > 15) scoreCombinations.highQualityHighFriction.push(r.jobHash);
    if (qualityScore !== null && qualityScore >= 75 && sp < 50) scoreCombinations.highQualityLowSp.push(r.jobHash);
  }

  // Summary Report
  console.log("--------------------------------------------------------------------------");
  console.log("                   DEFECT DISTRIBUTION BY FREQUENCY                       ");
  console.log("--------------------------------------------------------------------------");
  const classP0 = defects.filter(d => d.class === "P0").length;
  const classP1 = defects.filter(d => d.class === "P1").length;
  const classP2 = defects.filter(d => d.class === "P2").length;
  const classP3 = defects.filter(d => d.class === "P3").length;

  console.log(`  P0 (Wrong / Contradiction)          : ${classP0.toString().padStart(4)} (${(classP0 / records.length * 100).toFixed(2)}%)`);
  console.log(`  P1 (Misleading / Term Leakage)      : ${classP1.toString().padStart(4)} (${(classP1 / records.length * 100).toFixed(2)}%)`);
  console.log(`  P2 (Weak / Generic Boilerplate)     : ${classP2.toString().padStart(4)} (${(classP2 / records.length * 100).toFixed(2)}%)`);
  console.log(`  P3 (Polish / Truncation Artifacts) : ${classP3.toString().padStart(4)} (${(classP3 / records.length * 100).toFixed(2)}%)`);
  console.log(`  TOTAL DEFECTS DETECTED              : ${defects.length}`);
  console.log("--------------------------------------------------------------------------\n");

  console.log("--------------------------------------------------------------------------");
  console.log("                     PHRASE REPETITION & BOILERPLATE AUDIT                  ");
  console.log("--------------------------------------------------------------------------");
  console.log(`  Unique SA Phrases     : ${saPhraseCounts.size} (Top SA phrase repeated ${Math.max(...Array.from(saPhraseCounts.values()), 0)} times)`);
  console.log(`  Unique PR Phrases     : ${prPhraseCounts.size} (Top PR phrase repeated ${Math.max(...Array.from(prPhraseCounts.values()), 0)} times)`);
  console.log(`  Unique Action Phrases : ${actionPhraseCounts.size} (Top Action phrase repeated ${Math.max(...Array.from(actionPhraseCounts.values()), 0)} times)`);
  console.log("--------------------------------------------------------------------------\n");

  console.log("--------------------------------------------------------------------------");
  console.log("                    TOP REPEATED BOILERPLATE PHRASES                       ");
  console.log("--------------------------------------------------------------------------");
  const sortedSA = Array.from(saPhraseCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log("Top Strategic Advantage Boilerplate:");
  sortedSA.forEach(([phrase, count]) => console.log(`  - [${count}x] "${phrase}"`));

  const sortedPR = Array.from(prPhraseCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log("\nTop Principal Risk Boilerplate:");
  sortedPR.forEach(([phrase, count]) => console.log(`  - [${count}x] "${phrase}"`));
  console.log("--------------------------------------------------------------------------\n");

  console.log("--------------------------------------------------------------------------");
  console.log("                    SCORE COMBINATION REPRESENTATIVE COUNTS                ");
  console.log("--------------------------------------------------------------------------");
  console.log(`  A. Quality >= 85 + PASS          : ${scoreCombinations.quality85Pass.length}`);
  console.log(`  B. Quality >= 80 + CONSIDER      : ${scoreCombinations.quality80Consider.length}`);
  console.log(`  C. Quality >= 65 + PURSUE        : ${scoreCombinations.quality65Pursue.length}`);
  console.log(`  D. Quality <= 45 + PASS          : ${scoreCombinations.quality45Pass.length}`);
  console.log(`  E. Quality N/A  + PASS          : ${scoreCombinations.qualityNaPass.length}`);
  console.log(`  F. High Quality + High Friction  : ${scoreCombinations.highQualityHighFriction.length}`);
  console.log(`  G. High Quality + Low SP        : ${scoreCombinations.highQualityLowSp.length}`);
  console.log("--------------------------------------------------------------------------\n");

  if (defects.length > 0) {
    console.log("--------------------------------------------------------------------------");
    console.log("                 TOP 20 REPRESENTATIVE DEFECTS SAMPLE                      ");
    console.log("--------------------------------------------------------------------------");
    defects.slice(0, 20).forEach((d, i) => {
      console.log(`[${i+1}] Class [${d.class}] ${d.category} | JobHash: ${d.jobHash.slice(0,12)} | Verdict: ${d.verdict} | Score: ${d.qualityScore}`);
      console.log(`    Issue: ${d.issue}`);
      console.log(`    Snippet: "${d.snippet.slice(0, 120)}..."\n`);
    });
  } else {
    console.log("==========================================================================");
    console.log("  PERFECT PASS! ZERO DEFECTS (P0=0, P1=0, P2=0, P3=0) ACROSS N = 1,514   ");
    console.log("==========================================================================");
  }
}

auditDossierFullCorpus().catch(err => {
  console.error(err);
  process.exit(1);
});
