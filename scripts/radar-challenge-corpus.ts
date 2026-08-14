/**
 * RADAR Adversarial Challenge Corpus Generator
 *
 * Product-validation exercise to expose weaknesses in RADAR's judgment.
 *
 * CRITICAL: This is NOT a normal sampling exercise.
 * - Do NOT modify production code
 * - Do NOT modify scoring, thresholds, ranking, decision policy, editorial logic
 * - Do NOT add new business logic
 * - Use actual production output from runEngine(), RecommendationRecord, composeExecutiveBrief()
 * - The generator classifies/selects records but does NOT determine if RADAR is "correct"
 *
 * Within each category, search entire corpus and rank by signal tension strength.
 * Calculate separation between relevant signals for selection only.
 */

import { runEngine } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { composeExecutiveBrief } from "@/lib/intelligence/editorial/OpportunityBriefComposer";
import { candidateProfile } from "@/data/candidate-profile";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

interface ChallengeCase {
  category: string;
  rankInCategory: number;
  selectionRationale: string;
  signalSeparation: number;
  jobHash: string;
  decision: string;
  score: number;
  careerValue: number;
  shortlistingPotential: number;
  pursuitFriction: number;
  confidence: number;
  strategicAdvantage: string;
  principalRisk: string;
  recommendedAction: string;
  humanReviewQuestion: string;
}

interface SignalRange {
  category: string;
  min: number;
  max: number;
  avg: number;
}

function generateAdversarialCorpus() {
  console.log("=== RADAR ADVERSARIAL CHALLENGE CORPUS ===\n");
  console.log("Product-validation exercise to expose judgment weaknesses");
  console.log("IMPORTANT: Using actual production output only\n");

  // Build candidate projection
  const builder = new CandidateProjectionBuilderImpl();
  const candidateProjection = builder.fromProfile(candidateProfile);
  console.log(`✓ Reference profile: ${candidateProfile.identity.name}\n`);

  // Run engine on full corpus
  console.log("Running engine on 1,514 opportunities...\n");
  const { presented, records } = runEngine(candidateProjection, 0);
  console.log(`✓ Complete: ${records.length} records\n`);

  // Build full results with briefs
  const allCases: ChallengeCase[] = [];

  for (const record of records) {
    const presentedItem = presented.find(p => p.record.jobHash === record.jobHash);
    if (!presentedItem) continue;

    const source: OpportunitySource = {
      jobHash: record.jobHash,
      role: presentedItem.opportunity.role || "Unknown",
      company: presentedItem.opportunity.company || "Unknown",
      location: presentedItem.opportunity.location || "Unknown",
      postedRelative: presentedItem.opportunity.postedRelative || "Posted recently",
      scrapedFrom: presentedItem.opportunity.scrapedFrom || "LinkedIn",
      primaryConcern: presentedItem.opportunity.primaryConcern,
      dimensions: presentedItem.opportunity.dimensions || []
    };

    try {
      const brief = composeExecutiveBrief(record, source);
      allCases.push({
        category: "",
        rankInCategory: 0,
        selectionRationale: "",
        signalSeparation: 0,
        jobHash: record.jobHash,
        decision: record.verb,
        score: record.priority || 0,
        careerValue: record.decisionSummary?.careerValue || 0,
        shortlistingPotential: record.decisionSummary?.shortlistingPotential || 0,
        pursuitFriction: record.decisionSummary?.pursuitFriction || 0,
        confidence: record.confidence || 0,
        strategicAdvantage: brief.whyYou,
        principalRisk: brief.principalRisk,
        recommendedAction: brief.recommendedAction,
        humanReviewQuestion: ""
      });
    } catch (err) {
      console.error(`Error for ${record.jobHash}:`, err);
    }
  }

  console.log(`✓ Composed ${allCases.length} briefs\n`);

  // Filter out SPARSE_SPEC and NOT_EVALUABLE
  const validCases = allCases.filter(r => r.decision !== "SPARSE_SPEC" && r.decision !== "NOT_EVALUABLE");
  console.log(`✓ Valid cases: ${validCases.length}\n`);

  const selectedCases: ChallengeCase[] = [];

  // ===== CATEGORY 1: 5 OBVIOUS WINNERS =====
  console.log("Selecting Category 1: Obvious Winners...");
  const winners = validCases
    .filter(r =>
      r.decision === "PURSUE" &&
      r.score >= 80 &&
      r.careerValue >= 75 &&
      r.shortlistingPotential >= 80 &&
      r.pursuitFriction <= 10 &&
      r.confidence >= 0.7
    )
    .map(r => ({
      ...r,
      signalSeparation: r.score + r.careerValue + r.shortlistingPotential - r.pursuitFriction
    }))
    .sort((a, b) => b.signalSeparation - a.signalSeparation)
    .slice(0, 5);

  winners.forEach((r, i) => {
    selectedCases.push({
      ...r,
      category: "CAT1_OBVIOUS_WINNER",
      rankInCategory: i + 1,
      selectionRationale: `High composite signal: Score ${r.score}, CV ${r.careerValue}, SP ${r.shortlistingPotential}, Friction ${r.pursuitFriction}`,
      humanReviewQuestion: "Does this genuinely represent an opportunity worth prioritizing among all PURSUE recommendations?"
    });
  });

  // ===== CATEGORY 2: 5 OBVIOUS LOSERS =====
  console.log("Selecting Category 2: Obvious Losers...");
  const losers = validCases
    .filter(r =>
      r.decision === "PASS" &&
      (r.careerValue <= 35 || r.shortlistingPotential <= 20)
    )
    .map(r => ({
      ...r,
      signalSeparation: Math.abs(r.careerValue - 50) + Math.abs(r.shortlistingPotential - 50)
    }))
    .sort((a, b) => b.signalSeparation - a.signalSeparation)
    .slice(0, 5);

  losers.forEach((r, i) => {
    selectedCases.push({
      ...r,
      category: "CAT2_OBVIOUS_LOSER",
      rankInCategory: i + 1,
      selectionRationale: `Clear mismatch: CV ${r.careerValue}, SP ${r.shortlistingPotential}`,
      humanReviewQuestion: "Would any executive with this profile reasonably disagree with the PASS decision?"
    });
  });

  // ===== CATEGORY 3: 5 HIGH CV / LOW SHORTLISTING =====
  console.log("Selecting Category 3: High CV / Low Shortlisting...");
  const highCvLowSp = validCases
    .filter(r =>
      r.careerValue >= 70 &&
      r.shortlistingPotential <= 60 &&
      r.careerValue - r.shortlistingPotential >= 20
    )
    .map(r => ({
      ...r,
      signalSeparation: r.careerValue - r.shortlistingPotential
    }))
    .sort((a, b) => b.signalSeparation - a.signalSeparation)
    .slice(0, 5);

  highCvLowSp.forEach((r, i) => {
    selectedCases.push({
      ...r,
      category: "CAT3_HIGH_CV_LOW_SP",
      rankInCategory: i + 1,
      selectionRationale: `Signal separation: CV ${r.careerValue} - SP ${r.shortlistingPotential} = ${r.signalSeparation}`,
      humanReviewQuestion: `Would you personally pursue this opportunity (CV: ${r.careerValue}) despite the lower shortlisting probability (${r.shortlistingPotential})?`
    });
  });

  // ===== CATEGORY 4: 5 LOW CV / HIGH SHORTLISTING =====
  console.log("Selecting Category 4: Low CV / High Shortlisting...");
  const lowCvHighSp = validCases
    .filter(r =>
      r.careerValue <= 50 &&
      r.shortlistingPotential >= 75 &&
      r.shortlistingPotential - r.careerValue >= 25
    )
    .map(r => ({
      ...r,
      signalSeparation: r.shortlistingPotential - r.careerValue
    }))
    .sort((a, b) => b.signalSeparation - a.signalSeparation)
    .slice(0, 5);

  lowCvHighSp.forEach((r, i) => {
    selectedCases.push({
      ...r,
      category: "CAT4_LOW_CV_HIGH_SP",
      rankInCategory: i + 1,
      selectionRationale: `Signal separation: SP ${r.shortlistingPotential} - CV ${r.careerValue} = ${r.signalSeparation}`,
      humanReviewQuestion: `Would you reject this opportunity (CV: ${r.careerValue}) despite the high probability of being shortlisted (${r.shortlistingPotential})?`
    });
  });

  // ===== CATEGORY 5: 5 HIGH FRICTION / HIGH VALUE =====
  console.log("Selecting Category 5: High Friction / High Value...");
  const highFrictionHighValue = validCases
    .filter(r =>
      r.careerValue >= 70 &&
      r.pursuitFriction >= 20 &&
      r.careerValue + r.pursuitFriction >= 95
    )
    .map(r => ({
      ...r,
      signalSeparation: r.careerValue + r.pursuitFriction
    }))
    .sort((a, b) => b.signalSeparation - a.signalSeparation)
    .slice(0, 5);

  highFrictionHighValue.forEach((r, i) => {
    selectedCases.push({
      ...r,
      category: "CAT5_HIGH_FRICTION_HIGH_VALUE",
      rankInCategory: i + 1,
      selectionRationale: `Combined signal: CV ${r.careerValue} + Friction ${r.pursuitFriction} = ${r.signalSeparation}`,
      humanReviewQuestion: `Is this level of career upside (${r.careerValue}) worth the stated pursuit friction (${r.pursuitFriction})?`
    });
  });

  // ===== CATEGORY 6: 5 LOW FRICTION / MEDIOCRE VALUE =====
  console.log("Selecting Category 6: Low Friction / Mediocre Value...");
  const lowFrictionMediocre = validCases
    .filter(r =>
      r.pursuitFriction <= 10 &&
      r.careerValue >= 40 &&
      r.careerValue <= 60 &&
      r.shortlistingPotential >= 60
    )
    .map(r => ({
      ...r,
      signalSeparation: (100 - r.pursuitFriction) + (60 - Math.abs(r.careerValue - 50))
    }))
    .sort((a, b) => b.signalSeparation - a.signalSeparation)
    .slice(0, 5);

  lowFrictionMediocre.forEach((r, i) => {
    selectedCases.push({
      ...r,
      category: "CAT6_LOW_FRICTION_MEDIOCRE",
      rankInCategory: i + 1,
      selectionRationale: `Low effort (${r.pursuitFriction}) + Mediocre value (${r.careerValue})`,
      humanReviewQuestion: `Does this opportunity represent meaningful career progression (CV: ${r.careerValue}) or is it merely easy to pursue?`
    });
  });

  // ===== OUTPUT: MACHINE-READABLE TABLE =====
  console.log("\n" + "=".repeat(120));
  console.log("MACHINE-READABLE CHALLENGE CORPUS (JSON format)");
  console.log("=".repeat(120) + "\n");

  const jsonOutput = selectedCases.map(c => ({
    category: c.category,
    rankInCategory: c.rankInCategory,
    jobHash: c.jobHash,
    decision: c.decision,
    score: c.score,
    careerValue: c.careerValue,
    shortlistingPotential: c.shortlistingPotential,
    pursuitFriction: c.pursuitFriction,
    confidence: c.confidence,
    selectionRationale: c.selectionRationale,
    signalSeparation: c.signalSeparation,
    strategicAdvantage: c.strategicAdvantage.slice(0, 200),
    principalRisk: c.principalRisk.slice(0, 200),
    recommendedAction: c.recommendedAction.slice(0, 150),
    humanReviewQuestion: c.humanReviewQuestion
  }));

  console.log(JSON.stringify(jsonOutput, null, 2));

  // ===== OUTPUT: COMPLETE EXECUTIVE BRIEFS =====
  console.log("\n\n" + "=".repeat(120));
  console.log("COMPLETE EXECUTIVE BRIEFS FOR ALL 30 CASES");
  console.log("=".repeat(120));

  selectedCases.forEach((c, i) => {
    console.log(`\n${i + 1}. ${c.category} (Rank ${c.rankInCategory})`);
    console.log("-".repeat(120));
    console.log(`Job Hash:     ${c.jobHash}`);
    console.log(`RADAR Decision: ${c.decision}`);
    console.log(`Score:        ${c.score}`);
    console.log(`Career Value: ${c.careerValue}`);
    console.log(`Shortlisting: ${c.shortlistingPotential}`);
    console.log(`Friction:     ${c.pursuitFriction}`);
    console.log(`Confidence:   ${(c.confidence * 100).toFixed(0)}%`);
    console.log(`\nSelection Rationale:`);
    console.log(`  ${c.selectionRationale}`);
    console.log(`  Signal Separation: ${c.signalSeparation.toFixed(1)}`);
    console.log(`\nStrategic Advantage:`);
    console.log(`  ${c.strategicAdvantage}`);
    console.log(`\nPrincipal Risk:`);
    console.log(`  ${c.principalRisk}`);
    console.log(`\nRecommended Action:`);
    console.log(`  ${c.recommendedAction}`);
    console.log(`\nHuman Review Required:`);
    console.log(`  ❓ ${c.humanReviewQuestion}`);
  });

  // ===== OUTPUT: HUMAN REVIEW TABLE =====
  console.log("\n\n" + "=".repeat(120));
  console.log("HUMAN REVIEW TABLE");
  console.log("=".repeat(120));
  console.log("\nCat | Rank | Job Hash     | Decision | Score | CV  | SP  | Friction | Conf | Human Review Question");
  console.log("-".repeat(120));

  selectedCases.forEach(c => {
    console.log(
      `${c.category.slice(0, 3)} | ` +
      `${c.rankInCategory.toString().padStart(4)} | ` +
      `${c.jobHash.slice(0, 12).padEnd(12)} | ` +
      `${c.decision.padEnd(8)} | ` +
      `${c.score.toString().padStart(3)} | ` +
      `${c.careerValue.toString().padStart(3)} | ` +
      `${c.shortlistingPotential.toString().padStart(3)} | ` +
      `${c.pursuitFriction.toString().padStart(8)} | ` +
      `${(c.confidence * 100).toFixed(0).padStart(3)}% | ` +
      `${c.humanReviewQuestion.slice(0, 60)}...`
    );
  });

  // ===== ANALYSIS: CATEGORY DISTRIBUTION =====
  console.log("\n\n" + "=".repeat(120));
  console.log("A. CATEGORY DISTRIBUTION");
  console.log("=".repeat(120));

  const categories = [
    { name: "CAT1_OBVIOUS_WINNER", expected: 5, desc: "Obvious Winners" },
    { name: "CAT2_OBVIOUS_LOSER", expected: 5, desc: "Obvious Losers" },
    { name: "CAT3_HIGH_CV_LOW_SP", expected: 5, desc: "High CV / Low Shortlisting" },
    { name: "CAT4_LOW_CV_HIGH_SP", expected: 5, desc: "Low CV / High Shortlisting" },
    { name: "CAT5_HIGH_FRICTION_HIGH_VALUE", expected: 5, desc: "High Friction / High Value" },
    { name: "CAT6_LOW_FRICTION_MEDIOCRE", expected: 5, desc: "Low Friction / Mediocre Value" }
  ];

  categories.forEach(cat => {
    const count = selectedCases.filter(c => c.category === cat.name).length;
    const status = count === cat.expected ? "✓" : count < cat.expected ? "⚠️" : "✓";
    console.log(`${status} ${cat.desc.padEnd(35)} | Selected: ${count}/${cat.expected}`);
  });

  // ===== ANALYSIS: SIGNAL RANGES =====
  console.log("\n" + "=".repeat(120));
  console.log("B. SIGNAL RANGES BY CATEGORY");
  console.log("=".repeat(120));

  categories.forEach(cat => {
    const cases = selectedCases.filter(c => c.category === cat.name);
    if (cases.length === 0) return;

    const scores = cases.map(c => c.score);
    const cvs = cases.map(c => c.careerValue);
    const sps = cases.map(c => c.shortlistingPotential);
    const frictions = cases.map(c => c.pursuitFriction);

    console.log(`\n${cat.desc}:`);
    console.log(`  Score:     ${Math.min(...scores)}-${Math.max(...scores)} (avg: ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)})`);
    console.log(`  CV:        ${Math.min(...cvs)}-${Math.max(...cvs)} (avg: ${(cvs.reduce((a, b) => a + b, 0) / cvs.length).toFixed(1)})`);
    console.log(`  SP:        ${Math.min(...sps)}-${Math.max(...sps)} (avg: ${(sps.reduce((a, b) => a + b, 0) / sps.length).toFixed(1)})`);
    console.log(`  Friction:  ${Math.min(...frictions)}-${Math.max(...frictions)} (avg: ${(frictions.reduce((a, b) => a + b, 0) / frictions.length).toFixed(1)})`);
  });

  // ===== ANALYSIS: TOP 5 MOST INTERESTING TENSIONS =====
  console.log("\n" + "=".repeat(120));
  console.log("C. TOP 5 MOST INTERESTING TENSIONS");
  console.log("=".repeat(120));

  const sortedBySeparation = [...selectedCases]
    .sort((a, b) => b.signalSeparation - a.signalSeparation)
    .slice(0, 5);

  sortedBySeparation.forEach((c, i) => {
    console.log(`\n${i + 1}. ${c.category} (${c.jobHash})`);
    console.log(`   Signal Separation: ${c.signalSeparation.toFixed(1)}`);
    console.log(`   Decision: ${c.decision} | Score: ${c.score}`);
    console.log(`   CV: ${c.careerValue} | SP: ${c.shortlistingPotential} | Friction: ${c.pursuitFriction}`);
    console.log(`   ❓ ${c.humanReviewQuestion}`);
  });

  // ===== ANALYSIS: TOP 5 MOST LIKELY TO REQUIRE HUMAN JUDGMENT =====
  console.log("\n" + "=".repeat(120));
  console.log("D. TOP 5 CASES MOST LIKELY TO REQUIRE HUMAN JUDGMENT");
  console.log("=".repeat(120));

  // Calculate "debate score" based on conflicting signals
  const withDebateScore = selectedCases.map(c => {
    let debateScore = 0;
    if (c.careerValue >= 70 && c.shortlistingPotential <= 60) debateScore += 3;
    if (c.careerValue <= 50 && c.shortlistingPotential >= 75) debateScore += 3;
    if (c.pursuitFriction >= 20 && c.careerValue >= 70) debateScore += 2;
    if (c.pursuitFriction <= 10 && c.careerValue >= 40 && c.careerValue <= 60) debateScore += 1;
    if (c.confidence >= 0.5 && c.confidence <= 0.75) debateScore += 1;
    if (c.decision === "CONSIDER") debateScore += 2;
    return { ...c, debateScore };
  });

  const mostDebatable = withDebateScore
    .sort((a, b) => b.debateScore - a.debateScore)
    .slice(0, 5);

  mostDebatable.forEach((c, i) => {
    console.log(`\n${i + 1}. ${c.category} (${c.jobHash})`);
    console.log(`   Debate Score: ${c.debateScore}`);
    console.log(`   Decision: ${c.decision} | Score: ${c.score} | Confidence: ${(c.confidence * 100).toFixed(0)}%`);
    console.log(`   CV: ${c.careerValue} | SP: ${c.shortlistingPotential} | Friction: ${c.pursuitFriction}`);
    console.log(`   ❓ ${c.humanReviewQuestion}`);
  });

  // ===== ANALYSIS: CATEGORY GAPS =====
  console.log("\n" + "=".repeat(120));
  console.log("E. CATEGORY GAPS");
  console.log("=".repeat(120) + "\n");

  const incompleteCategories = categories.filter(cat => {
    const count = selectedCases.filter(c => c.category === cat.name).length;
    return count < cat.expected;
  });

  if (incompleteCategories.length === 0) {
    console.log("✓ All categories filled with requested counts");
  } else {
    console.log("⚠️  Categories with insufficient strong examples:");
    incompleteCategories.forEach(cat => {
      const count = selectedCases.filter(c => c.category === cat.name).length;
      console.log(`   - ${cat.desc}: ${count}/${cat.expected}`);
    });
  }

  // ===== FINAL SUMMARY =====
  console.log("\n\n" + "=".repeat(120));
  console.log("FINAL SUMMARY");
  console.log("=".repeat(120));
  console.log(`\nTotal Challenge Cases: ${selectedCases.length}`);
  console.log(`Total Categories: 6`);
  console.log(`Cases per Category: Target 5, Actual ${(selectedCases.length / 6).toFixed(1)}`);
  console.log(`\nSignal Ranges:`);
  console.log(`  Score: ${Math.min(...selectedCases.map(c => c.score))}-${Math.max(...selectedCases.map(c => c.score))}`);
  console.log(`  Career Value: ${Math.min(...selectedCases.map(c => c.careerValue))}-${Math.max(...selectedCases.map(c => c.careerValue))}`);
  console.log(`  Shortlisting: ${Math.min(...selectedCases.map(c => c.shortlistingPotential))}-${Math.max(...selectedCases.map(c => c.shortlistingPotential))}`);
  console.log(`  Friction: ${Math.min(...selectedCases.map(c => c.pursuitFriction))}-${Math.max(...selectedCases.map(c => c.pursuitFriction))}`);
  console.log(`\nDecisions:`);
  const pursueCount = selectedCases.filter(c => c.decision === "PURSUE").length;
  const considerCount = selectedCases.filter(c => c.decision === "CONSIDER").length;
  const passCount = selectedCases.filter(c => c.decision === "PASS").length;
  console.log(`  PURSUE: ${pursueCount}`);
  console.log(`  CONSIDER: ${considerCount}`);
  console.log(`  PASS: ${passCount}`);

  console.log("\n\n" + "=".repeat(120));
  console.log("STOP");
  console.log("=".repeat(120));
  console.log("\n✓ Challenge corpus generated");
  console.log("✓ No production code modified");
  console.log("✓ No scoring/thresholds/decisions changed");
  console.log("✓ Human review questions provided");
  console.log("✓ Ready for executive validation");
  console.log("\nSTOP. Do not proceed to P3.");
}

// Run
generateAdversarialCorpus();
