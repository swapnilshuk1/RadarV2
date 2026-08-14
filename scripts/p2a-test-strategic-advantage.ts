/**
 * P2-A Strategic Advantage Test Script
 * Quick validation of the new StrategicAdvantageSynthesizer
 */

import { synthesizeStrategicAdvantage, formatStrategicAdvantage } from "../src/lib/intelligence/editorial/StrategicAdvantageSynthesizer";
import type { RecommendationRecord } from "../src/lib/intelligence/record";
import type { OpportunitySource } from "../src/data/opportunity-fixtures";

console.log("=".repeat(60));
console.log("P2-A: Strategic Advantage Synthesis Test");
console.log("=".repeat(60));

// Test case 1: Strong transformation + CRM + scale match
const mockRecord1: RecommendationRecord = {
  jobHash: "j-test-1",
  engineVersion: "4.3.0",
  recommendationVersion: "4.3.0:test",
  verb: "PURSUE",
  rawScore: 85,
  priority: 85,
  vetoed: false,
  vetoReason: null,
  claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
  confidence: 0.92,
  factors: { pursuitFriction: 5 },
  evidenceGrounding: {},
  decisionSummary: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 5 },
  decisionDrivers: [{ factor: "CRM Transformation", impact: "positive", strength: "high", evidence: "13-market Salesforce migration" }],
  decisionRisks: [{ factor: "Location", impact: "negative", strength: "low", evidence: "Secondary metro" }],
  confidences: { parsing: 0.9, matching: 0.92, recommendation: 0.92 },
  stability: "High",
  headspace: { finalVerb: "PURSUE", downgraded: false },
  comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
  explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
  trace: {
    priority: 85,
    factors: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 1 },
    verb0: "PURSUE",
    finalVerb: "PURSUE",
    confidence: 0.92,
    stability: "High",
    pipeline: [],
    evidenceMapping: [
      {
        jobCapability: "CRM Transformation [CORE_MANDATE]",
        candidateCapability: "13-market Salesforce migration across APAC/ME/ANZ/ZA in 12 months",
        confidence: 0.95,
        reason: "Direct evidence match"
      },
      {
        jobCapability: "Commercial Growth [CORE_MANDATE]",
        candidateCapability: "Managed $8M Ford commercial portfolio",
        confidence: 0.90,
        reason: "Commercial scale match"
      },
      {
        jobCapability: "Scale Leadership [EXECUTION_CAPABILITY]",
        candidateCapability: "40-member CoE leadership",
        confidence: 0.88,
        reason: "Scale precedent"
      }
    ],
    careerValueBreakdown: { brandValue: 20, learningValue: 20, trajectoryValue: 20, riskMitigation: 15 },
    headspace: { finalVerb: "PURSUE", downgraded: false },
    missing: [],
    timestamp: new Date().toISOString(),
    candidateProjectionHash: "test",
    opportunityContentHash: "test"
  },
  esi: 0.85,
  diligenceStatus: "READY"
};

const mockSource1: OpportunitySource = {
  jobHash: "j-test-1",
  role: "Chief Marketing Officer",
  company: "BMW India",
  location: "Gurugram",
  postedRelative: "Posted recently",
  scrapedFrom: "LinkedIn",
  primaryConcern: null,
  dimensions: []
};

console.log("\n--- Test 1: Strong CRM + Transformation + Scale Match ---");
const advantage1 = synthesizeStrategicAdvantage(mockRecord1, mockSource1);
console.log("Statement:", advantage1.statement);
console.log("Category:", advantage1.category);
console.log("Confidence:", advantage1.confidence);
console.log("Evidence:", advantage1.evidence);
console.log("Formatted:", formatStrategicAdvantage(advantage1));

// Test case 2: Weak match
const mockRecord2: RecommendationRecord = {
  ...mockRecord1,
  jobHash: "j-test-2",
  trace: {
    ...mockRecord1.trace,
    evidenceMapping: [
      {
        jobCapability: "Data Science [CORE_MANDATE]",
        candidateCapability: "Some analytics exposure",
        confidence: 0.4,
        reason: "Limited match"
      }
    ]
  }
};

const mockSource2: OpportunitySource = {
  ...mockSource1,
  jobHash: "j-test-2",
  role: "Head of Data Science",
  company: "TechCorp"
};

console.log("\n--- Test 2: Weak Match ---");
const advantage2 = synthesizeStrategicAdvantage(mockRecord2, mockSource2);
console.log("Statement:", advantage2.statement);
console.log("Category:", advantage2.category);
console.log("Confidence:", advantage2.confidence);
console.log("Formatted:", formatStrategicAdvantage(advantage2));

// Test case 3: Career trajectory
const mockRecord3: RecommendationRecord = {
  ...mockRecord1,
  jobHash: "j-test-3",
  decisionSummary: { careerValue: 75, shortlistingPotential: 70, pursuitFriction: 10 },
  trace: {
    ...mockRecord1.trace,
    evidenceMapping: [
      {
        jobCapability: "Growth Strategy [CORE_MANDATE]",
        candidateCapability: "Full growth capability stack",
        confidence: 0.85,
        reason: "Capability match"
      },
      {
        jobCapability: "Commercial Leadership [CORE_MANDATE]",
        candidateCapability: "P&L ownership experience",
        confidence: 0.82,
        reason: "Commercial match"
      }
    ]
  }
};

console.log("\n--- Test 3: Career Trajectory ---");
const advantage3 = synthesizeStrategicAdvantage(mockRecord3, mockSource1);
console.log("Statement:", advantage3.statement);
console.log("Category:", advantage3.category);
console.log("Confidence:", advantage3.confidence);

console.log("\n" + "=".repeat(60));
console.log("✓ Strategic Advantage Synthesis Tests Complete");
console.log("=".repeat(60));
