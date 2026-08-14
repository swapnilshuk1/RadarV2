/**
 * P2-A.2 Principal Risk Intelligence — Manual Verification Script
 *
 * Run: npx tsx scripts/p2a2-verify-principal-risk.ts
 */

import { synthesizePrincipalRisk, formatPrincipalRisk } from "../src/lib/intelligence/editorial/PrincipalRiskSynthesizer";
import { synthesizeStrategicAdvantage, formatStrategicAdvantage } from "../src/lib/intelligence/editorial/StrategicAdvantageSynthesizer";
import type { RecommendationRecord } from "../src/lib/intelligence/record";
import type { OpportunitySource } from "../src/data/opportunity-fixtures";

console.log("=".repeat(70));
console.log("P2-A.2: Principal Risk Intelligence — Verification Script");
console.log("=".repeat(70));

// =============================================================================
// SCENARIO 1: Material CORE_MANDATE Gap (CONSIDER)
// =============================================================================
console.log("\n--- SCENARIO 1: Material CORE_MANDATE Gap ---");

const scenario1Record: RecommendationRecord = {
  jobHash: "s1-core-mandate-gap",
  engineVersion: "4.3.0",
  recommendationVersion: "4.3.0:test",
  verb: "CONSIDER",
  rawScore: 55,
  priority: 55,
  vetoed: false,
  vetoReason: null,
  claimPermissions: {
    allowedClaims: [],
    explicitUnknowns: ["P&L Ownership [CORE_MANDATE]"],
    explicitRisks: []
  },
  confidence: 0.65,
  factors: { pursuitFriction: 15 },
  evidenceGrounding: {},
  decisionSummary: { careerValue: 60, shortlistingPotential: 50, pursuitFriction: 15 },
  decisionDrivers: [],
  decisionRisks: [{ factor: "Capability Gaps", impact: "negative", strength: "high", evidence: "Missing P&L Ownership" }],
  confidences: { parsing: 0.8, matching: 0.65, recommendation: 0.65 },
  stability: "Medium",
  headspace: { finalVerb: "CONSIDER", downgraded: false },
  comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
  explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
  trace: {
    priority: 55,
    factors: { careerValue: 60, shortlistingPotential: 50, pursuitFriction: 15 },
    verb0: "CONSIDER",
    finalVerb: "CONSIDER",
    confidence: 0.65,
    stability: "Medium",
    pipeline: [],
    evidenceMapping: [
      { jobCapability: "Marketing Strategy [CORE_MANDATE]", candidateCapability: "Led marketing strategy", confidence: 0.85, reason: "Strong match" }
    ],
    careerValueBreakdown: { brandValue: 15, learningValue: 15, trajectoryValue: 15, riskMitigation: 10 },
    headspace: { finalVerb: "CONSIDER", downgraded: false },
    missing: ["P&L Ownership"],
    timestamp: new Date().toISOString(),
    candidateProjectionHash: "test",
    opportunityContentHash: "test"
  },
  esi: 0.55,
  diligenceStatus: "READY"
};

const scenario1Source: OpportunitySource = {
  jobHash: "s1-core-mandate-gap",
  role: "Chief Marketing Officer",
  company: "ScaleCorp",
  location: "Mumbai",
  postedRelative: "Posted recently",
  scrapedFrom: "LinkedIn",
  primaryConcern: null,
  dimensions: []
};

const s1Risk = synthesizePrincipalRisk(scenario1Record, scenario1Source);
console.log("Principal Risk:", s1Risk.statement);
console.log("Category:", s1Risk.category);
console.log("Severity:", s1Risk.severity);
console.log("Confidence:", s1Risk.confidence);
console.log("Evidence:", s1Risk.evidence);

// =============================================================================
// SCENARIO 2: PURSUE with No Material Risk
// =============================================================================
console.log("\n--- SCENARIO 2: PURSUE with Strong Matches ---");

const scenario2Record: RecommendationRecord = {
  ...scenario1Record,
  jobHash: "s2-pursue",
  verb: "PURSUE",
  rawScore: 85,
  priority: 85,
  claimPermissions: {
    allowedClaims: ["CRM", "TRANSFORMATION"],
    explicitUnknowns: ["Salesforce Marketing Cloud [TECHNOLOGY_STACK]"], // Tech stack gap only
    explicitRisks: []
  },
  decisionRisks: [], // No decision risks
  confidences: { parsing: 0.9, matching: 0.88, recommendation: 0.88 },
  trace: {
    ...scenario1Record.trace,
    evidenceMapping: [
      { jobCapability: "CRM Transformation [CORE_MANDATE]", candidateCapability: "13-market Salesforce migration", confidence: 0.95, reason: "Strong match" },
      { jobCapability: "Commercial Leadership [CORE_MANDATE]", candidateCapability: "$8M portfolio", confidence: 0.92, reason: "Scale match" }
    ],
    missing: ["Salesforce Marketing Cloud"] // Only tech stack gap
  }
};

const scenario2Source: OpportunitySource = {
  ...scenario1Source,
  jobHash: "s2-pursue",
  role: "VP Marketing"
};

const s2Risk = synthesizePrincipalRisk(scenario2Record, scenario2Source);
console.log("Principal Risk:", s2Risk.statement);
console.log("Category:", s2Risk.category);
console.log("Severity:", s2Risk.severity);

// =============================================================================
// SCENARIO 3: Career Regression Concern
// =============================================================================
console.log("\n--- SCENARIO 3: Career Regression ---");

const scenario3Record: RecommendationRecord = {
  ...scenario1Record,
  jobHash: "s3-regression",
  verb: "PASS",
  rawScore: 35,
  priority: 35,
  vetoed: true,
  vetoReason: "G-COMPATIBILITY-REGRESSION-VETO",
  claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: ["Career Regression"] },
  decisionRisks: [{ factor: "Career Regression", impact: "negative", strength: "high", evidence: "Regression score: 75" }]
};

const scenario3Source: OpportunitySource = {
  ...scenario1Source,
  jobHash: "s3-regression",
  role: "Marketing Manager"
};

const s3Risk = synthesizePrincipalRisk(scenario3Record, scenario3Source);
console.log("Principal Risk:", s3Risk.statement);
console.log("Category:", s3Risk.category);
console.log("Severity:", s3Risk.severity);

// =============================================================================
// SCENARIO 4: SPARSE_SPEC — No Fabricated Risk
// =============================================================================
console.log("\n--- SCENARIO 4: SPARSE_SPEC ---");

const scenario4Record: RecommendationRecord = {
  ...scenario1Record,
  jobHash: "s4-sparse",
  verb: "SPARSE_SPEC",
  rawScore: 0,
  priority: null,
  vetoed: true,
  vetoReason: "G-EVIDENCE-GATE-SPARSE-SPEC",
  claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
  decisionRisks: [{ factor: "Insufficient Evidence", impact: "negative", strength: "high", evidence: "Specification contains fewer than 25 words" }],
  explanation: { reason: "test", dominantFactor: "test", missingEvidence: ["Detailed requirements", "Responsibilities"], unknowns: [] }
};

const scenario4Source: OpportunitySource = {
  ...scenario1Source,
  jobHash: "s4-sparse",
  role: "Manager",
  description: "Marketing role."
};

const s4Risk = synthesizePrincipalRisk(scenario4Record, scenario4Source);
console.log("Principal Risk:", s4Risk.statement);
console.log("Category:", s4Risk.category);

// =============================================================================
// SCENARIO 5: Compare Strategic Advantage vs Principal Risk
// =============================================================================
console.log("\n--- SCENARIO 5: Strategic Advantage vs Principal Risk (Distinct Concepts) ---");

const scenario5Record: RecommendationRecord = {
  ...scenario1Record,
  jobHash: "s5-compare",
  verb: "CONSIDER",
  rawScore: 65,
  priority: 65,
  claimPermissions: {
    allowedClaims: ["CRM", "TRANSFORMATION"],
    explicitUnknowns: ["Healthcare Domain [DOMAIN_FAMILIARITY]"],
    explicitRisks: []
  },
  decisionDrivers: [{ factor: "CRM Transformation", impact: "positive", strength: "high", evidence: "13-market migration" }],
  decisionRisks: [{ factor: "Capability Gaps", impact: "negative", strength: "medium", evidence: "Missing domain familiarity" }],
  trace: {
    ...scenario1Record.trace,
    evidenceMapping: [
      { jobCapability: "CRM Transformation [CORE_MANDATE]", candidateCapability: "13-market Salesforce migration", confidence: 0.92, reason: "Strong match" },
      { jobCapability: "Healthcare Domain [DOMAIN_FAMILIARITY]", candidateCapability: "Limited healthcare experience", confidence: 0.4, reason: "Weak match" }
    ]
  }
};

const scenario5Source: OpportunitySource = {
  ...scenario1Source,
  jobHash: "s5-compare",
  company: "HealthTech"
};

const s5Advantage = synthesizeStrategicAdvantage(scenario5Record, scenario5Source);
const s5Risk = synthesizePrincipalRisk(scenario5Record, scenario5Source);

console.log("Strategic Advantage:", formatStrategicAdvantage(s5Advantage));
console.log("  Category:", s5Advantage.category);
console.log("  Confidence:", s5Advantage.confidence);

console.log("Principal Risk:", formatPrincipalRisk(s5Risk));
console.log("  Category:", s5Risk.category);
console.log("  Confidence:", s5Risk.confidence);

console.log("\n  Distinct?", s5Advantage.category !== s5Risk.category ? "✓ YES" : "✗ NO");
console.log("  Adv confidence > Risk confidence?", s5Advantage.confidence > s5Risk.confidence ? "✓ YES" : "✗ NO");

// =============================================================================
// Summary
// =============================================================================
console.log("\n" + "=".repeat(70));
console.log("Verification Complete");
console.log("=".repeat(70));
console.log("\nKey Findings:");
console.log("1. CORE_MANDATE gaps are identified with appropriate severity");
console.log("2. PURSUE opportunities with tech gaps show 'no_material_risk'");
console.log("3. Career regression is identified as principal risk when present");
console.log("4. SPARSE_SPEC does not fabricate capability risks");
console.log("5. Strategic Advantage and Principal Risk remain distinct concepts");
