/**
 * P2 Validation Report - Simplified
 *
 * Runs against the full corpus and generates validation output.
 * This version uses the test infrastructure instead of direct DB access.
 */

import { runEngine } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { composeExecutiveBrief } from "@/lib/intelligence/editorial/OpportunityBriefComposer";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

// Use the actual candidate profile from the codebase
import { candidateProfile } from "@/data/candidate-profile";

interface ValidationResult {
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
}

interface DefectReport {
  severity: "P0" | "P1" | "P2" | "P3";
  jobHash: string;
  category: string;
  description: string;
}

function generateMockCorpus(): OpportunitySource[] {
  // Generate representative 50-opportunity sample
  const companies = ["TechCorp", "GrowthCo", "ScaleInc", "StartupXYZ", "EnterpriseLtd", "DigitalFirst", "InnovateCo", "GlobalTech"];
  const roles = [
    "Chief Marketing Officer",
    "VP Marketing",
    "VP Growth",
    "Director Marketing",
    "Head of Growth",
    "Marketing Manager",
    "Senior Marketing Manager",
    "CMO",
    "Fractional CMO",
    "Marketing Consultant"
  ];
  const locations = ["Mumbai", "Bengaluru", "Delhi", "Hyderabad", "Pune", "Remote"];
  
  const corpus: OpportunitySource[] = [];
  
  for (let i = 0; i < 50; i++) {
    corpus.push({
      jobHash: `mock-job-${i}`,
      role: roles[i % roles.length],
      company: companies[i % companies.length],
      location: locations[i % locations.length],
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    });
  }
  
  return corpus;
}

function generateValidationReport() {
  console.log("=== P2 EXECUTIVE INTELLIGENCE VALIDATION REPORT ===\n");
  
  // Build candidate projection
  const builder = new CandidateProjectionBuilderImpl();
  const candidateProjection = builder.fromProfile(candidateProfile);
  console.log(`✓ Reference profile loaded: ${candidateProfile.identity.name}\n`);
  
  // Run engine
  console.log("Running engine on representative corpus...\n");
  const { presented, records } = runEngine(candidateProjection, 0);
  
  console.log(`✓ Engine complete: ${records.length} records\n`);
  
  // Compose briefs
  const results: ValidationResult[] = [];
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const record of records) { // Process all records
    const presentedItem = presented.find(p => p.record.jobHash === record.jobHash);
    if (!presentedItem) {
      console.log(`No presented item for ${record.jobHash}`);
      continue;
    }
    
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
      results.push({
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
      successCount++;
    } catch (err: any) {
      errorCount++;
      if (errorCount <= 3) { // Log first 3 errors
        console.error(`Error composing brief for ${record.jobHash}:`, err?.message || err);
        console.error("Record:", JSON.stringify(record, null, 2).slice(0, 500));
      }
    }
  }
  
  console.log(`Success: ${successCount}, Errors: ${errorCount}`);
  
  // Sort by score
  results.sort((a, b) => b.score - a.score);
  
  console.log(`✓ Composed ${results.length} executive briefs\n`);
  
  // ===== A. TOP 20 =====
  console.log("=".repeat(100));
  console.log("A. TOP 20 OPPORTUNITIES");
  console.log("=".repeat(100) + "\n");
  
  console.log("Rank | Decision | Score | CV | SP | Friction | Conf | Job Hash");
  console.log("-".repeat(100));
  
  results.slice(0, 20).forEach((r, i) => {
    console.log(
      `${(i + 1).toString().padStart(4)} | ` +
      `${r.decision.padEnd(8)} | ` +
      `${r.score.toString().padStart(3)} | ` +
      `${r.careerValue.toString().padStart(2)} | ` +
      `${r.shortlistingPotential.toString().padStart(2)} | ` +
      `${r.pursuitFriction.toString().padStart(8)} | ` +
      `${(r.confidence * 100).toFixed(0).padStart(3)}% | ` +
      `${r.jobHash}`
    );
  });
  
  // ===== B. 10 EXAMPLES =====
  console.log("\n" + "=".repeat(100));
  console.log("B. 10 DETAILED EXAMPLES");
  console.log("=".repeat(100));
  
  // 3 Obvious Winners (top PURSUE with high score)
  const obviousWinners = results
    .filter(r => r.decision === "PURSUE" && r.score >= 75)
    .slice(0, 3);
  console.log("\n--- 3 OBVIOUS WINNERS ---\n");
  obviousWinners.forEach((r, i) => {
    console.log(`${i + 1}. ${r.jobHash}`);
    console.log(`   Decision: ${r.decision}`);
    console.log(`   Score: ${r.score} | CV: ${r.careerValue} | SP: ${r.shortlistingPotential} | Confidence: ${(r.confidence * 100).toFixed(0)}%`);
    console.log(`   Strategic Advantage: ${r.strategicAdvantage.slice(0, 120)}${r.strategicAdvantage.length > 120 ? "..." : ""}`);
    console.log(`   Principal Risk: ${r.principalRisk.slice(0, 120)}${r.principalRisk.length > 120 ? "..." : ""}`);
    console.log(`   Recommended Action: ${r.recommendedAction}`);
    console.log();
  });
  
  // 3 Obvious Losers (PASS with low score)
  const obviousLosers = results
    .filter(r => r.decision === "PASS" && r.score < 50)
    .slice(0, 3);
  console.log("\n--- 3 OBVIOUS LOSERS ---\n");
  obviousLosers.forEach((r, i) => {
    console.log(`${i + 1}. ${r.jobHash}`);
    console.log(`   Decision: ${r.decision}`);
    console.log(`   Score: ${r.score} | CV: ${r.careerValue}`);
    console.log(`   Principal Risk: ${r.principalRisk.slice(0, 150)}${r.principalRisk.length > 150 ? "..." : ""}`);
    console.log();
  });
  
  // 2 Surprising Winners (PURSUE with moderate score but high CV)
  const surprisingWinners = results
    .filter(r => r.decision === "PURSUE" && r.score >= 60 && r.score < 75 && r.careerValue >= 65)
    .slice(0, 2);
  console.log("\n--- 2 SURPRISING WINNERS ---\n");
  surprisingWinners.forEach((r, i) => {
    console.log(`${i + 1}. ${r.jobHash}`);
    console.log(`   Decision: ${r.decision}`);
    console.log(`   Score: ${r.score} | CV: ${r.careerValue} | SP: ${r.shortlistingPotential}`);
    console.log(`   Why surprising: Moderate score (${r.score}) with high career value (${r.careerValue})`);
    console.log(`   Strategic Advantage: ${r.strategicAdvantage.slice(0, 150)}${r.strategicAdvantage.length > 150 ? "..." : ""}`);
    console.log();
  });
  
  // 2 Surprising Losers (PASS with decent score)
  const surprisingLosers = results
    .filter(r => r.decision === "PASS" && r.score >= 45 && r.score < 65)
    .slice(0, 2);
  console.log("\n--- 2 SURPRISING LOSERS ---\n");
  surprisingLosers.forEach((r, i) => {
    console.log(`${i + 1}. ${r.jobHash}`);
    console.log(`   Decision: ${r.decision}`);
    console.log(`   Score: ${r.score} | CV: ${r.careerValue}`);
    console.log(`   Why surprising: Decent score (${r.score}) but PASS decision`);
    console.log(`   Principal Risk: ${r.principalRisk.slice(0, 150)}${r.principalRisk.length > 150 ? "..." : ""}`);
    console.log();
  });
  
  // ===== C. DEFECTS =====
  console.log("=".repeat(100));
  console.log("C. PRODUCT DEFECTS");
  console.log("=".repeat(100) + "\n");
  
  const defects: DefectReport[] = [];
  
  results.forEach(r => {
    if (r.decision === "PURSUE" && r.score < 40) {
      defects.push({ severity: "P0", jobHash: r.jobHash, category: "Wrong Rec", description: `PURSUE with score ${r.score}` });
    }
    if (r.strategicAdvantage.length < 30) {
      defects.push({ severity: "P1", jobHash: r.jobHash, category: "Weak Explanation", description: `Advantage too brief (${r.strategicAdvantage.length} chars)` });
    }
    if (r.recommendedAction.includes("tailor") && r.recommendedAction.length < 40) {
      defects.push({ severity: "P2", jobHash: r.jobHash, category: "Generic Action", description: "Generic tailoring advice" });
    }
    if (r.principalRisk.length > 300) {
      defects.push({ severity: "P3", jobHash: r.jobHash, category: "Long Text", description: `Risk too long (${r.principalRisk.length} chars)` });
    }
  });
  
  console.log(`P0 (Wrong):        ${defects.filter(d => d.severity === "P0").length}`);
  console.log(`P1 (Misleading):   ${defects.filter(d => d.severity === "P1").length}`);
  console.log(`P2 (Weak/Generic): ${defects.filter(d => d.severity === "P2").length}`);
  console.log(`P3 (Polish):       ${defects.filter(d => d.severity === "P3").length}`);
  console.log(`-`.repeat(100));
  console.log(`TOTAL:             ${defects.length}`);
  
  if (defects.length > 0) {
    console.log("\n--- Sample Defects ---\n");
    defects.slice(0, 10).forEach(d => {
      console.log(`${d.severity} | ${d.category.padEnd(20)} | ${d.description}`);
    });
  }
  
  // ===== D. NO AUTOMATIC FIXES =====
  console.log("\n" + "=".repeat(100));
  console.log("D. NO AUTOMATIC FIXES");
  console.log("=".repeat(100));
  console.log("\n⚠️  Defects documented for product review");
  console.log("⚠️  Do NOT fix without product decision");
  console.log("\nValidation complete.");
}

// Run
generateValidationReport();
