/**
 * P2 Validation Report Generator
 *
 * Validates the actual executive experience against the 1,514-opportunity corpus
 * using the reference profile.
 *
 * Generates:
 * A. Top 20 opportunities analysis
 * B. 10 detailed examples (3 winners, 3 losers, 2 surprising winners, 2 surprising losers)
 * C. Product defects classified as P0/P1/P2/P3
 *
 * IMPORTANT: No automatic fixes. Defects are documented for product review only.
 */

import { runEngine } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { composeExecutiveBrief } from "@/lib/intelligence/editorial/OpportunityBriefComposer";
import { getRepositories } from "@/data/sqlite/provider";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

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
  brief: string;
}

interface DefectReport {
  severity: "P0" | "P1" | "P2" | "P3";
  jobHash: string;
  category: string;
  description: string;
  recommendation: string;
}

async function generateValidationReport() {
  console.log("=== P2 EXECUTIVE INTELLIGENCE VALIDATION REPORT ===\n");

  // Load reference candidate profile
  console.log("Loading reference profile...\n");
  const repos = getRepositories();
  const candidateProfile = await repos.people.getLatestProjection("swapnil-shukla");

  if (!candidateProfile) {
    console.error("❌ Reference profile not found");
    return;
  }

  const candidateProjection = CandidateProjectionBuilderImpl.fromProfile(candidateProfile);

  console.log(`✓ Reference profile loaded: ${candidateProfile.id}`);
  console.log(`✓ Candidate projection: ${candidateProjection.hash}\n`);

  // Run engine on all opportunities
  console.log("Running engine on corpus...");
  console.log("(This may take a moment for 1,514 opportunities)\n");

  const { presented, records } = runEngine(candidateProjection, 0);

  console.log(`✓ Engine complete: ${records.length} records generated\n`);

  // Compose briefs for each record
  const results: ValidationResult[] = [];

  for (const record of records) {
    const presentedOpportunity = presented.find(p => p.jobHash === record.jobHash);
    if (!presentedOpportunity) continue;

    const source: OpportunitySource = {
      jobHash: record.jobHash,
      role: presentedOpportunity.role || "Unknown Role",
      company: presentedOpportunity.company || "Unknown Company",
      location: presentedOpportunity.location || "Unknown",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
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
        recommendedAction: brief.recommendedAction,
        brief: JSON.stringify(brief).slice(0, 500) + "..."
      });
    } catch (err) {
      console.error(`Error composing brief for ${record.jobHash}:`, err);
    }
  }

  // Sort by priority descending
  results.sort((a, b) => b.score - a.score);

  console.log(`✓ Composed ${results.length} executive briefs\n`);

  // ===== A. TOP 20 OPPORTUNITIES =====
  console.log("=".repeat(100));
  console.log("A. TOP 20 OPPORTUNITIES");
  console.log("=".repeat(100) + "\n");

  console.log("Rank | Decision | Score | CV | SP | Friction | Confidence | Job Hash");
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
      `${r.jobHash.slice(0, 40)}`
    );
  });

  // ===== B. 10 DETAILED EXAMPLES =====
  console.log("\n" + "=".repeat(100));
  console.log("B. 10 DETAILED EXAMPLES");
  console.log("=".repeat(100));

  // 3 Obvious Winners (top PURSUE with high confidence)
  const obviousWinners = results
    .filter(r => r.decision === "PURSUE" && r.confidence >= 0.75 && r.score >= 70)
    .slice(0, 3);

  console.log("\n--- 3 OBVIOUS WINNERS ---\n");
  obviousWinners.forEach((r, i) => {
    console.log(`\n${i + 1}. Job: ${r.jobHash}`);
    console.log(`   Decision: ${r.decision}`);
    console.log(`   Score: ${r.score} | Career Value: ${r.careerValue} | Shortlisting: ${r.shortlistingPotential}`);
    console.log(`   Confidence: ${(r.confidence * 100).toFixed(0)}%`);
    console.log(`   Strategic Advantage: ${r.strategicAdvantage.slice(0, 120)}${r.strategicAdvantage.length > 120 ? "..." : ""}`);
    console.log(`   Principal Risk: ${r.principalRisk.slice(0, 120)}${r.principalRisk.length > 120 ? "..." : ""}`);
    console.log(`   Recommended Action: ${r.recommendedAction}`);
  });

  // 3 Obvious Losers (PASS with clear rationale)
  const obviousLosers = results
    .filter(r => r.decision === "PASS" && r.score < 50)
    .slice(0, 3);

  console.log("\n\n--- 3 OBVIOUS LOSERS ---\n");
  obviousLosers.forEach((r, i) => {
    console.log(`\n${i + 1}. Job: ${r.jobHash}`);
    console.log(`   Decision: ${r.decision}`);
    console.log(`   Score: ${r.score} | Career Value: ${r.careerValue}`);
    console.log(`   Principal Risk: ${r.principalRisk.slice(0, 120)}${r.principalRisk.length > 120 ? "..." : ""}`);
    console.log(`   Why PASS: ${r.principalRisk.slice(0, 200)}`);
  });

  // 2 Surprising Winners (PURSUE with lower score but high career value)
  const surprisingWinners = results
    .filter(r => r.decision === "PURSUE" && r.careerValue >= 70 && r.score < 75 && r.score >= 60)
    .slice(0, 2);

  console.log("\n\n--- 2 SURPRISING WINNERS ---\n");
  surprisingWinners.forEach((r, i) => {
    console.log(`\n${i + 1}. Job: ${r.jobHash}`);
    console.log(`   Decision: ${r.decision}`);
    console.log(`   Score: ${r.score} | Career Value: ${r.careerValue} | Shortlisting: ${r.shortlistingPotential}`);
    console.log(`   Why surprising: Moderate score (${r.score}) but high career value (${r.careerValue})`);
    console.log(`   Strategic Advantage: ${r.strategicAdvantage.slice(0, 150)}${r.strategicAdvantage.length > 150 ? "..." : ""}`);
  });

  // 2 Surprising Losers (PASS with decent score)
  const surprisingLosers = results
    .filter(r => r.decision === "PASS" && r.score >= 45 && r.score < 65)
    .slice(0, 2);

  console.log("\n\n--- 2 SURPRISING LOSERS ---\n");
  surprisingLosers.forEach((r, i) => {
    console.log(`\n${i + 1}. Job: ${r.jobHash}`);
    console.log(`   Decision: ${r.decision}`);
    console.log(`   Score: ${r.score} | Career Value: ${r.careerValue}`);
    console.log(`   Why surprising: Decent score (${r.score}) but PASS decision`);
    console.log(`   Principal Risk: ${r.principalRisk.slice(0, 150)}${r.principalRisk.length > 150 ? "..." : ""}`);
  });

  // ===== C. PRODUCT DEFECTS =====
  console.log("\n" + "=".repeat(100));
  console.log("C. PRODUCT DEFECTS");
  console.log("=".repeat(100) + "\n");

  const defects: DefectReport[] = [];

  // Analyze for defects
  results.forEach(r => {
    // P0: Fundamentally wrong recommendation
    if (r.decision === "PURSUE" && r.score < 40) {
      defects.push({
        severity: "P0",
        jobHash: r.jobHash,
        category: "Wrong Recommendation",
        description: `PURSUE decision with low score (${r.score}) - likely scoring bug`,
        recommendation: "Review scoring logic and decision policy alignment"
      });
    }

    if (r.decision === "PASS" && r.score >= 75) {
      defects.push({
        severity: "P0",
        jobHash: r.jobHash,
        category: "Wrong Recommendation",
        description: `PASS decision with high score (${r.score}) - veto not reflected in score`,
        recommendation: "Review veto handling in score calculation"
      });
    }

    // P1: Materially misleading explanation
    if (r.decision === "PURSUE" && r.strategicAdvantage.length < 30) {
      defects.push({
        severity: "P1",
        jobHash: r.jobHash,
        category: "Weak Explanation",
        description: `Strategic advantage too brief/generic (${r.strategicAdvantage.length} chars)`,
        recommendation: "Improve evidence synthesis from candidate profile"
      });
    }

    if (r.decision === "PURSUE" && r.principalRisk.length < 20) {
      defects.push({
        severity: "P1",
        jobHash: r.jobHash,
        category: "Missing Risk",
        description: "Principal risk not identified for PURSUE opportunity",
        recommendation: "Review risk detection from decisionRisks"
      });
    }

    // P2: Weak/generic intelligence
    if (r.recommendedAction.toLowerCase().includes("tailor") && r.recommendedAction.length < 40) {
      defects.push({
        severity: "P2",
        jobHash: r.jobHash,
        category: "Generic Action",
        description: "Recommended action is generic ('tailor resume') without specifics",
        recommendation: "Add specific tailoring guidance from capability gaps"
      });
    }

    if (r.strategicAdvantage.toLowerCase().includes("strong profile") && r.strategicAdvantage.length < 50) {
      defects.push({
        severity: "P2",
        jobHash: r.jobHash,
        category: "Generic Advantage",
        description: "Strategic advantage uses generic language without specific evidence",
        recommendation: "Include specific candidate evidence in advantage statement"
      });
    }

    // P3: UX/Presentation polish
    if (r.principalRisk.length > 300) {
      defects.push({
        severity: "P3",
        jobHash: r.jobHash,
        category: "Long Text",
        description: `Principal risk too long (${r.principalRisk.length} chars)`,
        recommendation: "Condense principal risk for readability"
      });
    }

    if (r.recommendedAction.length > 250) {
      defects.push({
        severity: "P3",
        jobHash: r.jobHash,
        category: "Long Action",
        description: `Recommended action too long (${r.recommendedAction.length} chars)`,
        recommendation: "Condense action statement"
      });
    }
  });

  console.log("Severity | Count | Description");
  console.log("-".repeat(100));
  console.log(`P0       | ${defects.filter(d => d.severity === "P0").length.toString().padStart(5)} | Fundamentally wrong recommendation`);
  console.log(`P1       | ${defects.filter(d => d.severity === "P1").length.toString().padStart(5)} | Materially misleading explanation`);
  console.log(`P2       | ${defects.filter(d => d.severity === "P2").length.toString().padStart(5)} | Weak/generic intelligence`);
  console.log(`P3       | ${defects.filter(d => d.severity === "P3").length.toString().padStart(5)} | UX/presentation polish`);
  console.log(`-`.repeat(100));
  console.log(`TOTAL    | ${defects.length.toString().padStart(5)} | Product defects identified`);

  if (defects.length > 0) {
    console.log("\n--- DETAILED DEFECT LIST ---\n");
    console.log("Severity | Category | Job Hash | Description");
    console.log("-".repeat(100));

    defects.slice(0, 30).forEach(d => {
      console.log(
        `${d.severity.padEnd(8)} | ` +
        `${d.category.slice(0, 20).padEnd(20)} | ` +
        `${d.jobHash.slice(0, 20).padEnd(20)} | ` +
        `${d.description.slice(0, 50)}`
      );
    });

    if (defects.length > 30) {
      console.log(`\n... and ${defects.length - 30} more defects`);
    }
  }

  // ===== D. NO AUTOMATIC FIXES =====
  console.log("\n" + "=".repeat(100));
  console.log("D. NO AUTOMATIC FIXES");
  console.log("=".repeat(100));
  console.log("\n⚠️  DEFECTS ARE DOCUMENTED FOR PRODUCT REVIEW ONLY");
  console.log("⚠️  DO NOT AUTOMATICALLY FIX WITHOUT PRODUCT DECISION");
  console.log("\nValidation complete.");
  console.log(`${results.length} opportunities analyzed`);
  console.log(`${defects.length} defects identified`);
  console.log("\nNext steps:");
  console.log("1. Review Top 20 for ranking quality");
  console.log("2. Review 10 examples for narrative quality");
  console.log("3. Review defects for product prioritization");
  console.log("4. Product decision on fixes");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateValidationReport().catch(err => {
    console.error("Validation failed:", err);
    process.exit(1);
  });
}

export { generateValidationReport };
