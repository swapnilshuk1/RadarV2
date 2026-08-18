/**
 * P2-A Corpus Spot Check
 * Test strategic advantage on a few live opportunities
 */

import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { LifestyleAssessmentEngine } from "../src/lib/intelligence/engines/LifestyleAssessmentEngine";
import { IdentityAssessmentEngine } from "../src/lib/intelligence/engines/IdentityAssessmentEngine";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import { synthesizeStrategicAdvantage, formatStrategicAdvantage } from "../src/lib/intelligence/editorial/StrategicAdvantageSynthesizer";
import { candidateProfile } from "../src/data/candidate-profile";
import liveScraped from "../src/data/live-scraped.json";

console.log("=".repeat(80));
console.log("P2-A: Strategic Advantage Corpus Spot Check");
console.log("=".repeat(80));

const builder = new CandidateProjectionBuilderImpl();
const candidateProj = builder.fromProfile(candidateProfile);

// Sample 5 opportunities from the corpus
const samples = [
  { label: "BMW India CMO", match: "BMW" },
  { label: "Morgan Stanley Director", match: "Morgan Stanley" },
  { label: "Xpand Chief Growth", match: "Xpand" },
  { label: "Ethos Contract Role", match: "Ethos" },
  { label: "SkanAI Director", match: "SkanAI" }
];

for (const { label, match } of samples) {
  const rawOpportunity = (liveScraped as any[]).find(o =>
    o.company?.toLowerCase().includes(match.toLowerCase()) ||
    o.role?.toLowerCase().includes(match.toLowerCase())
  );

  if (!rawOpportunity) {
    console.log(`\n⚠ ${label}: Not found in corpus`);
    continue;
  }

  const jobProj = JobProjectionBuilder.build(rawOpportunity);

  // Run assessments
  const identity = IdentityAssessmentEngine.evaluate(candidateProj, jobProj);
  const capability = CapabilityAssessmentEngine.evaluate(candidateProj, jobProj);
  const opportunity = OpportunityAssessmentEngine.evaluate(candidateProj, jobProj);
  const career = CareerAssessmentEngine.evaluate(candidateProj, jobProj);
  const lifestyle = LifestyleAssessmentEngine.evaluate(candidateProj, jobProj);

  // Run Decision Policy
  const candIdentityVal = (candidateProj as any).executiveIdentity?.value || "Commercial & Marketing Leadership";
  const rawJobText = rawOpportunity.normalizedText || "";

  const policyResult = DecisionPolicyEngine.evaluate(
    identity,
    capability,
    opportunity,
    career,
    lifestyle,
    jobProj.executiveIdentity.value,
    candIdentityVal,
    rawJobText,
    false
  );

  // Build minimal record for strategic advantage synthesis
  const mockRecord: any = {
    jobHash: rawOpportunity.jobHash,
    verb: policyResult.verdict,
    priority: policyResult.priorityScore,
    decisionSummary: {
      careerValue: (career as any).careerScore || 0
    },
    trace: {
      evidenceMapping: capability.matches || []
    }
  };

  // Synthesize strategic advantage
  const advantage = synthesizeStrategicAdvantage(mockRecord, rawOpportunity);

  console.log(`\n--- ${label} ---`);
  console.log(`  Role: ${rawOpportunity.role}`);
  console.log(`  Company: ${rawOpportunity.company}`);
  console.log(`  RADAR Decision: ${policyResult.verdict}`);
  console.log(`  Score: ${policyResult.rawScore}`);
  console.log(`  Strategic Advantage: ${formatStrategicAdvantage(advantage)}`);
  console.log(`  Category: ${advantage.category}`);
  console.log(`  Confidence: ${(advantage.confidence * 100).toFixed(0)}%`);
}

console.log("\n" + "=".repeat(80));
console.log("P2-A Corpus Spot Check Complete");
console.log("=".repeat(80));
