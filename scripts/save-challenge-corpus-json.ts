import { runEngine } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { composeExecutiveBrief } from "@/lib/intelligence/editorial/OpportunityBriefComposer";
import { candidateProfile } from "@/data/candidate-profile";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import * as fs from "fs";

const builder = new CandidateProjectionBuilderImpl();
const candidateProjection = builder.fromProfile(candidateProfile);
console.log("Running engine...");
const { presented, records } = runEngine(candidateProjection, 0);
console.log(`Complete: ${records.length} records`);

const allCases: any[] = [];

for (const record of records) {
  const presentedItem = presented.find(p => p.record.jobHash === record.jobHash);
  if (!presentedItem) continue;

  const source: OpportunitySource = {
    jobHash: record.jobHash,
    role: presentedItem.opportunity.role || "Unknown",
    company: presentedItem.opportunity.company || "Unknown",
    location: presentedItem.opportunity.location || "Unknown",
    postedRelative: "Posted recently",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: []
  };

  try {
    const brief = composeExecutiveBrief(record, source);
    allCases.push({
      jobHash: record.jobHash,
      decision: record.verb,
      score: record.priority || 0,
      careerValue: record.decisionSummary?.careerValue || 0,
      shortlistingPotential: record.decisionSummary?.shortlistingPotential || 0,
      pursuitFriction: record.decisionSummary?.pursuitFriction || 0,
      confidence: record.confidence || 0,
      strategicAdvantage: brief.whyYou,
      principalRisk: brief.principalRisk,
      recommendedAction: brief.recommendedAction
    });
  } catch (err) {}
}

const validCases = allCases.filter((r: any) => r.decision !== "SPARSE_SPEC" && r.decision !== "NOT_EVALUABLE");
console.log(`Valid cases: ${validCases.length}`);

const selectedCases: any[] = [];

// CAT1: Obvious Winners
const winners = validCases
  .filter((r: any) => r.decision === "PURSUE" && r.score >= 80 && r.careerValue >= 75 && r.shortlistingPotential >= 80 && r.pursuitFriction <= 10)
  .sort((a: any, b: any) => (b.score + b.careerValue + b.shortlistingPotential) - (a.score + a.careerValue + a.shortlistingPotential))
  .slice(0, 5);
winners.forEach((r: any, i: number) => selectedCases.push({ category: "CAT1_OBVIOUS_WINNER", rankInCategory: i + 1, ...r, selectionRationale: "High composite signal", signalSeparation: r.score + r.careerValue + r.shortlistingPotential - r.pursuitFriction, humanReviewQuestion: "Does this genuinely represent an opportunity worth prioritizing among all PURSUE recommendations?" }));

// CAT2: Obvious Losers
const losers = validCases.filter((r: any) => r.decision === "PASS" && (r.careerValue <= 35 || r.shortlistingPotential <= 20)).slice(0, 5);
losers.forEach((r: any, i: number) => selectedCases.push({ category: "CAT2_OBVIOUS_LOSER", rankInCategory: i + 1, ...r, selectionRationale: "Clear mismatch", signalSeparation: Math.abs(r.careerValue - 50) + Math.abs(r.shortlistingPotential - 50), humanReviewQuestion: "Would any executive with this profile reasonably disagree with the PASS decision?" }));

// CAT3: High CV / Low SP
const highCvLowSp = validCases.filter((r: any) => r.careerValue >= 70 && r.shortlistingPotential <= 60).sort((a: any, b: any) => (b.careerValue - b.shortlistingPotential) - (a.careerValue - a.shortlistingPotential)).slice(0, 5);
highCvLowSp.forEach((r: any, i: number) => selectedCases.push({ category: "CAT3_HIGH_CV_LOW_SP", rankInCategory: i + 1, ...r, selectionRationale: "Signal separation: CV - SP", signalSeparation: r.careerValue - r.shortlistingPotential, humanReviewQuestion: `Would you personally pursue this opportunity (CV: ${r.careerValue}) despite the lower shortlisting probability (${r.shortlistingPotential})?` }));

// CAT4: Low CV / High SP
const lowCvHighSp = validCases.filter((r: any) => r.careerValue <= 50 && r.shortlistingPotential >= 75).sort((a: any, b: any) => (b.shortlistingPotential - b.careerValue) - (a.shortlistingPotential - a.careerValue)).slice(0, 5);
lowCvHighSp.forEach((r: any, i: number) => selectedCases.push({ category: "CAT4_LOW_CV_HIGH_SP", rankInCategory: i + 1, ...r, selectionRationale: "Signal separation: SP - CV", signalSeparation: r.shortlistingPotential - r.careerValue, humanReviewQuestion: `Would you reject this opportunity (CV: ${r.careerValue}) despite the high probability of being shortlisted (${r.shortlistingPotential})?` }));

// CAT5: High Friction / High Value
const highFriction = validCases.filter((r: any) => r.careerValue >= 70 && r.pursuitFriction >= 20).sort((a: any, b: any) => (b.careerValue + b.pursuitFriction) - (a.careerValue + a.pursuitFriction)).slice(0, 5);
highFriction.forEach((r: any, i: number) => selectedCases.push({ category: "CAT5_HIGH_FRICTION_HIGH_VALUE", rankInCategory: i + 1, ...r, selectionRationale: "Combined signal: CV + Friction", signalSeparation: r.careerValue + r.pursuitFriction, humanReviewQuestion: `Is this level of career upside (${r.careerValue}) worth the stated pursuit friction (${r.pursuitFriction})?` }));

// CAT6: Low Friction / Mediocre Value
const lowFriction = validCases.filter((r: any) => r.pursuitFriction <= 10 && r.careerValue >= 40 && r.careerValue <= 60).sort((a: any, b: any) => b.shortlistingPotential - a.shortlistingPotential).slice(0, 5);
lowFriction.forEach((r: any, i: number) => selectedCases.push({ category: "CAT6_LOW_FRICTION_MEDIOCRE", rankInCategory: i + 1, ...r, selectionRationale: "Low effort + Mediocre value", signalSeparation: 100 - r.pursuitFriction, humanReviewQuestion: `Does this opportunity represent meaningful career progression (CV: ${r.careerValue}) or is it merely easy to pursue?` }));

fs.writeFileSync("radar-challenge-corpus.json", JSON.stringify(selectedCases, null, 2));
console.log("✓ Saved radar-challenge-corpus.json");
console.log(`Total cases: ${selectedCases.length}`);
