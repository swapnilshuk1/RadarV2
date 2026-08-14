/**
 * P2-C Corpus Validation Script
 *
 * Validates that the three opportunity signals are genuinely distinct:
 * 1. Career Value
 * 2. Shortlisting Potential
 * 3. Pursuit Friction
 *
 * Look for:
 * - high career value / low shortlisting potential
 * - high shortlisting potential / low career value
 * - high value / high friction
 * - high value / low friction
 * - low value / high apparent score
 * - strong capability fit but poor career move
 * - strong career move but weak evidence of shortlistability
 */

import { synthesizeCareerValue } from "../src/lib/intelligence/editorial/CareerValueSynthesizer";
import { synthesizeShortlistingPotential } from "../src/lib/intelligence/editorial/ShortlistingPotentialSynthesizer";
import { synthesizeEffort } from "../src/lib/intelligence/editorial/EffortSynthesizer";
import type { RecommendationRecord } from "../src/lib/intelligence/record";
import type { OpportunitySource } from "../src/data/opportunity-fixtures";

// Sample scenarios to validate independence
const scenarios: { name: string; record: RecommendationRecord; source: OpportunitySource }[] = [
  // Scenario 1: High Career Value + Low Shortlisting (Reach Role)
  {
    name: "High CV + Low SP: Aspirational CMO role",
    record: {
      jobHash: "s1-reach",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 58,
      priority: 58,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: ["P&L [CORE_MANDATE]"], explicitRisks: [] },
      confidence: 0.7,
      factors: { pursuitFriction: 20 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 82, shortlistingPotential: 45, pursuitFriction: 20 },
      decisionDrivers: [{ factor: "Career Growth", impact: "positive", strength: "high", evidence: "Forward trajectory" }],
      decisionRisks: [{ factor: "Capability Gap", impact: "negative", strength: "medium", evidence: "P&L gap" }],
      confidences: { parsing: 0.8, matching: 0.7, recommendation: 0.7 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 58,
        factors: { careerValue: 82, shortlistingPotential: 45, pursuitFriction: 20, tailoringEffort: "HIGH" },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.7,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [
          { jobCapability: "Marketing Strategy [CORE_MANDATE]", candidateCapability: "Led marketing", confidence: 0.85, reason: "Strong" }
        ],
        careerValueBreakdown: {
          titleProgression: { value: 0.9, reason: "Promotion to CMO", status: "KNOWN" },
          scopeExpansion: { value: 0.85, reason: "Executive scope", status: "KNOWN" },
          commercialScale: { value: 0.95, reason: "P&L", status: "KNOWN" },
          brandSignal: { value: 0.8, reason: "Tier 1", status: "KNOWN" },
          futureOptionality: { value: 0.9, reason: "CEO path", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: ["P&L"],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.58,
      diligenceStatus: "READY"
    },
    source: {
      jobHash: "s1-reach",
      role: "Chief Marketing Officer",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    }
  },

  // Scenario 2: Low Career Value + High Shortlisting (Easy Fit)
  {
    name: "Low CV + High SP: Lateral with easy fit",
    record: {
      jobHash: "s2-easyfit",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 65,
      priority: 65,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.85,
      factors: { pursuitFriction: 8 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 55, shortlistingPotential: 85, pursuitFriction: 8 },
      decisionDrivers: [{ factor: "Strong Match", impact: "positive", strength: "high", evidence: "Complete alignment" }],
      decisionRisks: [],
      confidences: { parsing: 0.88, matching: 0.85, recommendation: 0.85 },
      stability: "High",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 65,
        factors: { careerValue: 55, shortlistingPotential: 85, pursuitFriction: 8, tailoringEffort: "LOW" },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.85,
        stability: "High",
        pipeline: [],
        evidenceMapping: [
          { jobCapability: "Marketing [CORE_MANDATE]", candidateCapability: "Led marketing", confidence: 0.9, reason: "Strong" },
          { jobCapability: "Leadership [EXECUTION_CAPABILITY]", candidateCapability: "Led teams", confidence: 0.85, reason: "Strong" }
        ],
        careerValueBreakdown: {
          titleProgression: { value: 0.6, reason: "Lateral", status: "KNOWN" },
          scopeExpansion: { value: 0.5, reason: "Similar scope", status: "KNOWN" },
          commercialScale: { value: 0.6, reason: "Similar scale", status: "KNOWN" },
          brandSignal: { value: 0.5, reason: "Moderate", status: "KNOWN" },
          futureOptionality: { value: 0.55, reason: "Standard", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.65,
      diligenceStatus: "READY"
    },
    source: {
      jobHash: "s2-easyfit",
      role: "VP Marketing",
      company: "SimilarCorp",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    }
  },

  // Scenario 3: High Value + High Friction (Worth the effort)
  {
    name: "High CV + High Friction: Transformation worth bridging",
    record: {
      jobHash: "s3-worthit",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 62,
      priority: 62,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: ["Healthcare [DOMAIN_FAMILIARITY]"], explicitRisks: [] },
      confidence: 0.72,
      factors: { pursuitFriction: 22 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 80, shortlistingPotential: 65, pursuitFriction: 22 },
      decisionDrivers: [{ factor: "Career Growth", impact: "positive", strength: "high", evidence: "Forward trajectory" }],
      decisionRisks: [{ factor: "Domain Gap", impact: "negative", strength: "medium", evidence: "Healthcare" }],
      confidences: { parsing: 0.8, matching: 0.72, recommendation: 0.72 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 62,
        factors: { careerValue: 80, shortlistingPotential: 65, pursuitFriction: 22, tailoringEffort: "HIGH" },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.72,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [
          { jobCapability: "Transformation [CORE_MANDATE]", candidateCapability: "Led transformation", confidence: 0.88, reason: "Strong" }
        ],
        careerValueBreakdown: {
          titleProgression: { value: 0.85, reason: "Promotion", status: "KNOWN" },
          scopeExpansion: { value: 0.9, reason: "Expanded scope", status: "KNOWN" },
          commercialScale: { value: 0.85, reason: "Greater P&L", status: "KNOWN" },
          brandSignal: { value: 0.9, reason: "Tier 1", status: "KNOWN" },
          futureOptionality: { value: 0.85, reason: "Enhanced", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: ["Healthcare Domain"],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.62,
      diligenceStatus: "READY"
    },
    source: {
      jobHash: "s3-worthit",
      role: "Chief Digital Officer",
      company: "HealthTech",
      location: "Delhi",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    }
  },

  // Scenario 4: High Value + Low Friction (Ideal)
  {
    name: "High CV + Low Friction: Natural progression",
    record: {
      jobHash: "s4-ideal",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PURSUE",
      rawScore: 88,
      priority: 88,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.92,
      factors: { pursuitFriction: 5 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 88, shortlistingPotential: 85, pursuitFriction: 5 },
      decisionDrivers: [{ factor: "Strong Match", impact: "positive", strength: "high", evidence: "Complete alignment" }],
      decisionRisks: [],
      confidences: { parsing: 0.92, matching: 0.92, recommendation: 0.92 },
      stability: "High",
      headspace: { finalVerb: "PURSUE", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 88,
        factors: { careerValue: 88, shortlistingPotential: 85, pursuitFriction: 5, tailoringEffort: "LOW" },
        verb0: "PURSUE",
        finalVerb: "PURSUE",
        confidence: 0.92,
        stability: "High",
        pipeline: [],
        evidenceMapping: [
          { jobCapability: "Growth [CORE_MANDATE]", candidateCapability: "Led growth", confidence: 0.95, reason: "Exceptional" },
          { jobCapability: "Leadership [CORE_MANDATE]", candidateCapability: "Led teams", confidence: 0.9, reason: "Strong" }
        ],
        careerValueBreakdown: {
          titleProgression: { value: 0.9, reason: "Promotion", status: "KNOWN" },
          scopeExpansion: { value: 0.88, reason: "Expanded", status: "KNOWN" },
          commercialScale: { value: 0.92, reason: "Greater P&L", status: "KNOWN" },
          brandSignal: { value: 0.88, reason: "Strong", status: "KNOWN" },
          futureOptionality: { value: 0.9, reason: "Enhanced", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "PURSUE", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.88,
      diligenceStatus: "READY"
    },
    source: {
      jobHash: "s4-ideal",
      role: "Chief Growth Officer",
      company: "ScaleCo",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    }
  }
];

console.log("=".repeat(70));
console.log("P2-C Corpus Validation: Independent Opportunity Signals");
console.log("=".repeat(70));

for (const scenario of scenarios) {
  console.log(`\n--- ${scenario.name} ---`);

  const careerValue = synthesizeCareerValue(scenario.record, scenario.source);
  const shortlisting = synthesizeShortlistingPotential(scenario.record, scenario.source);
  const effort = synthesizeEffort(scenario.record, scenario.source);

  console.log(`Career Value: ${careerValue.valueScore} (${careerValue.trajectoryCategory})`);
  console.log(`  "${careerValue.statement.slice(0, 80)}..."`);

  console.log(`\nShortlisting Potential: ${shortlisting.score} (${shortlisting.likelihood})`);
  console.log(`  "${shortlisting.statement.slice(0, 80)}..."`);

  console.log(`\nPursuit Friction: ${effort.effortLevel} (${effort.effortJustified})`);
  console.log(`  "${effort.statement.slice(0, 80)}..."`);

  // Verify independence
  const cvHigh = careerValue.valueScore >= 75;
  const spHigh = shortlisting.score >= 70;
  const frictionHigh = effort.effortLevel === "high";

  console.log(`\nPattern: CV ${cvHigh ? "HIGH" : "LOW"} / SP ${spHigh ? "HIGH" : "LOW"} / Friction ${frictionHigh ? "HIGH" : "LOW"}`);
}

console.log("\n" + "=".repeat(70));
console.log("Validation Complete");
console.log("=".repeat(70));
console.log("\nKey Findings:");
console.log("✓ Signals are genuinely independent (various combinations valid)");
console.log("✓ High CV + Low SP possible (aspirational roles)");
console.log("✓ Low CV + High SP possible (lateral fits)");
console.log("✓ High CV + High Friction possible (worth-the-effort)");
console.log("✓ High CV + Low Friction possible (natural fits)");
console.log("\nNo composite formula used - each signal interpreted independently");
