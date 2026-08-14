/**
 * P3-A Signal Conflict Analysis - Full Dataset
 *
 * Analyzes all ~1,500 opportunities to find the most instructive
 * signal-conflict cases for decision policy design.
 */

import { runEngine } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "@/data/candidate-profile";
import { composeExecutiveBrief } from "@/lib/intelligence/editorial/OpportunityBriefComposer";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

const builder = new CandidateProjectionBuilderImpl();
const candidateProjection = builder.fromProfile(candidateProfile);

console.log("Running engine on full dataset...");
const { presented, records } = runEngine(candidateProjection, 0);
console.log(`Complete: ${records.length} records\n`);

interface SignalConflictCase {
  jobHash: string;
  role: string;
  company: string;
  decision: string;
  priorityScore: number;
  careerValue: number;
  shortlistingPotential: number;
  pursuitFriction: number;
  confidence: number;
  strategicAdvantage: string;
  principalRisk: string;
  pattern: string;
  conflictSeverity: "high" | "medium" | "low";
}

const conflictCases: SignalConflictCase[] = [];

// Pattern definitions
const patterns = [
  {
    name: "A1: Extreme Easy Trap",
    test: (r: any) => r.decisionSummary?.careerValue < 35 
      && r.decisionSummary?.shortlistingPotential >= 85 
      && r.decisionSummary?.pursuitFriction <= 5
      && r.verb === "PURSUE",
    severity: "high" as const
  },
  {
    name: "A2: Moderate Easy Trap", 
    test: (r: any) => r.decisionSummary?.careerValue >= 35 && r.decisionSummary?.careerValue < 50
      && r.decisionSummary?.shortlistingPotential >= 85
      && r.decisionSummary?.pursuitFriction <= 5
      && r.verb === "PURSUE",
    severity: "medium" as const
  },
  {
    name: "B1: High CV Low SP Pass",
    test: (r: any) => r.decisionSummary?.careerValue >= 75
      && r.decisionSummary?.shortlistingPotential < 60
      && r.decisionSummary?.pursuitFriction <= 10
      && r.verb === "PASS",
    severity: "medium" as const
  },
  {
    name: "C1: Friction Override High Value",
    test: (r: any) => r.decisionSummary?.careerValue >= 75
      && r.decisionSummary?.shortlistingPotential >= 75
      && r.decisionSummary?.pursuitFriction >= 25
      && r.verb === "PASS",
    severity: "high" as const
  },
  {
    name: "C2: Friction Creates Ambiguity",
    test: (r: any) => r.decisionSummary?.careerValue >= 70
      && r.decisionSummary?.shortlistingPotential >= 80
      && r.decisionSummary?.pursuitFriction >= 20
      && r.verb === "CONSIDER",
    severity: "low" as const
  },
  {
    name: "D1: Borderline Everything Consider",
    test: (r: any) => r.decisionSummary?.careerValue >= 50 && r.decisionSummary?.careerValue < 70
      && r.decisionSummary?.shortlistingPotential >= 70 && r.decisionSummary?.shortlistingPotential < 85
      && r.decisionSummary?.pursuitFriction >= 10 && r.decisionSummary?.pursuitFriction < 25
      && r.verb === "CONSIDER",
    severity: "low" as const
  },
  {
    name: "E1: Low Friction Mediocre Value Pursue",
    test: (r: any) => r.decisionSummary?.careerValue >= 45 && r.decisionSummary?.careerValue < 65
      && r.decisionSummary?.shortlistingPotential >= 80
      && r.decisionSummary?.pursuitFriction <= 5
      && r.verb === "PURSUE",
    severity: "medium" as const
  },
  {
    name: "F1: Domain Mismatch Override",
    test: (r: any) => r.decisionSummary?.careerValue >= 70
      && r.decisionSummary?.shortlistingPotential >= 70
      && r.vetoReason?.includes("DOMAIN")
      && r.verb === "PASS",
    severity: "high" as const
  },
  {
    name: "G1: Coherence Failure",
    test: (r: any) => {
      const hasCareerRisk = r.principalRisk?.toLowerCase().includes("career") 
        && r.principalRisk?.toLowerCase().includes("step back");
      const lowCV = r.decisionSummary?.careerValue < 40;
      return hasCareerRisk && lowCV && r.verb === "PURSUE";
    },
    severity: "high" as const
  }
];

for (const record of records) {
  const presentedItem = presented.find(p => p.record.jobHash === record.jobHash);
  if (!presentedItem) continue;

  // Skip sparse specs
  if (record.verb === "SPARSE_SPEC" || record.verb === "NOT_EVALUABLE") continue;

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

  let brief;
  try {
    brief = composeExecutiveBrief(record, source);
  } catch {
    continue;
  }

  for (const pattern of patterns) {
    if (pattern.test(record)) {
      conflictCases.push({
        jobHash: record.jobHash,
        role: source.role.slice(0, 50),
        company: source.company.slice(0, 30),
        decision: record.verb,
        priorityScore: record.priority || 0,
        careerValue: record.decisionSummary?.careerValue || 0,
        shortlistingPotential: record.decisionSummary?.shortlistingPotential || 0,
        pursuitFriction: record.decisionSummary?.pursuitFriction || 0,
        confidence: record.confidence || 0,
        strategicAdvantage: brief.whyYou.slice(0, 80),
        principalRisk: brief.principalRisk.slice(0, 80),
        pattern: pattern.name,
        conflictSeverity: pattern.severity
      });
      break; // Only match first pattern
    }
  }
}

console.log("=".repeat(120));
console.log("SIGNAL CONFLICT ANALYSIS - FULL DATASET");
console.log("=".repeat(120));
console.log(`\nTotal records analyzed: ${records.length}`);
console.log(`Signal conflict cases found: ${conflictCases.length}`);
console.log(`Conflict rate: ${((conflictCases.length / records.length) * 100).toFixed(1)}%\n`);

// Group by pattern
const byPattern = new Map<string, SignalConflictCase[]>();
for (const c of conflictCases) {
  const list = byPattern.get(c.pattern) || [];
  list.push(c);
  byPattern.set(c.pattern, list);
}

console.log("=".repeat(120));
console.log("CONFLICTS BY PATTERN");
console.log("=".repeat(120));
console.log();

for (const [pattern, cases] of byPattern) {
  console.log(`${pattern}: ${cases.length} cases`);
}

console.log();

// Show top 2-3 cases per high/medium severity pattern
console.log("=".repeat(120));
console.log("REPRESENTATIVE CASES (High & Medium Severity)");
console.log("=".repeat(120));
console.log();

const highMediumCases = conflictCases.filter(c => c.conflictSeverity !== "low");
const uniquePatterns = [...new Set(highMediumCases.map(c => c.pattern))];

for (const pattern of uniquePatterns) {
  const cases = highMediumCases.filter(c => c.pattern === pattern).slice(0, 3);
  if (cases.length === 0) continue;

  console.log(`\n${pattern.toUpperCase()} (${cases.length} total cases)`);
  console.log("-".repeat(120));

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    console.log(`\n${i + 1}. ${c.jobHash}`);
    console.log(`   Role: ${c.role} at ${c.company}`);
    console.log(`   Decision: ${c.decision} | Severity: ${c.conflictSeverity}`);
    console.log(`   CV: ${c.careerValue} | SP: ${c.shortlistingPotential} | Friction: ${c.pursuitFriction}`);
    console.log(`   Priority Score: ${c.priorityScore} | Confidence: ${(c.confidence * 100).toFixed(0)}%`);
    console.log(`   Strategic Advantage: ${c.strategicAdvantage}...`);
    console.log(`   Principal Risk: ${c.principalRisk}...`);
  }
}

// Summary statistics
console.log("\n\n" + "=".repeat(120));
console.log("SUMMARY STATISTICS");
console.log("=".repeat(120));
console.log();

const highSeverity = conflictCases.filter(c => c.conflictSeverity === "high").length;
const mediumSeverity = conflictCases.filter(c => c.conflictSeverity === "medium").length;
const lowSeverity = conflictCases.filter(c => c.conflictSeverity === "low").length;

console.log(`High severity conflicts:   ${highSeverity}`);
console.log(`Medium severity conflicts: ${mediumSeverity}`);
console.log(`Low severity conflicts:    ${lowSeverity}`);
console.log(`Total conflicts:           ${conflictCases.length}`);
console.log();

// Specific patterns of concern
const easyTrap = conflictCases.filter(c => c.pattern.startsWith("A")).length;
const frictionOverride = conflictCases.filter(c => c.pattern.startsWith("C")).length;
const coherenceFailure = conflictCases.filter(c => c.pattern === "G1: Coherence Failure").length;

console.log(`Pattern A (Easy Trap):          ${easyTrap} cases`);
console.log(`Pattern C (Friction Override):  ${frictionOverride} cases`);
console.log(`Pattern G (Coherence Failure):  ${coherenceFailure} cases`);
console.log();

// CV vs Decision analysis
const lowCVPursue = records.filter(r => 
  r.verb === "PURSUE" 
  && r.decisionSummary?.careerValue < 50
  && r.decisionSummary?.shortlistingPotential >= 80
).length;

const highCVPass = records.filter(r => 
  r.verb === "PASS" 
  && r.decisionSummary?.careerValue >= 75
  && r.decisionSummary?.shortlistingPotential >= 70
).length;

console.log(`CV < 50 + SP >= 80 + PURSUE:  ${lowCVPursue} cases in full dataset`);
console.log(`CV >= 75 + SP >= 70 + PASS:   ${highCVPass} cases in full dataset`);
console.log();

console.log("=".repeat(120));
console.log("ANALYSIS COMPLETE");
console.log("=".repeat(120));
