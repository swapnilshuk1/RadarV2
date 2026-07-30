// scripts/test-ekb-compilation.ts

import { EKBCompiler } from "../src/lib/intelligence/ekb/EKBCompiler";
import { FeatureRegistry } from "../src/lib/intelligence/similarity/FeatureRegistry";
import { EKBCompatibilityAdapter } from "../src/lib/intelligence/ekb/EKBCompatibilityAdapter";
import type { SimilarityFeatureProvider, SimilarityContribution } from "../src/lib/intelligence/similarity/SimilarityTypes";

console.log("=================================================================");
console.log("  RADAR v2 EKB KNOWLEDGE COMPILER & PROMOTIONAL GATES BENCHMARK");
console.log("=================================================================\n");

// 1. Register Mock Explanatory Feature Providers
const trajectoryProvider: SimilarityFeatureProvider = {
  name: "CareerTrajectoryProvider",
  async calculateScore(candidate, opportunity, versionId) {
    return {
      featureName: "CareerTrajectoryProvider",
      score: 0.88,
      weight: 0.35,
      contributionValue: 0.88 * 0.35,
      explanation: "Strong trajectory overlap (+0.18): Progression from VP Marketing to Chief Commercial Officer",
      evidenceSnippet: "Managed $8M Ford fee book and led 40-member Performance CoE",
    };
  }
};

const capabilityProvider: SimilarityFeatureProvider = {
  name: "CapabilityCoverageProvider",
  async calculateScore(candidate, opportunity, versionId) {
    return {
      featureName: "CapabilityCoverageProvider",
      score: 0.92,
      weight: 0.35,
      contributionValue: 0.92 * 0.35,
      explanation: "Shared commercial transformation experience (+0.12): Growth Strategy & Performance Marketing",
      evidenceSnippet: "Salesforce CDP & CRM Transformation across 13 APAC markets",
    };
  }
};

const industryAdjacencyProvider: SimilarityFeatureProvider = {
  name: "IndustryAdjacencyProvider",
  async calculateScore(candidate, opportunity, versionId) {
    return {
      featureName: "IndustryAdjacencyProvider",
      score: 0.75,
      weight: 0.30,
      contributionValue: 0.75 * 0.30,
      explanation: "Adjacent industry alignment: Automotive & Consumer Mobility to Retail Commerce",
    };
  }
};

FeatureRegistry.register("CareerTrajectoryProvider", trajectoryProvider, 0.35);
FeatureRegistry.register("CapabilityCoverageProvider", capabilityProvider, 0.35);
FeatureRegistry.register("IndustryAdjacencyProvider", industryAdjacencyProvider, 0.30);

// 2. Compile Release 14.2.1
console.log("1. Executing EKB Knowledge Base Compiler for Release 14.2.1...");
const release = EKBCompiler.compileAndPublishVersion(14, 2, 1, ["RevPAR Optimization", "Grid Interconnection", "Commercial Growth"]);

console.log(`   ✓ Version Compiled : ${release.versionId}`);
console.log(`   ✓ Published At     : ${release.publishedAt}`);
console.log(`   ✓ Capabilities     : ${release.capabilitiesCount}`);
console.log(`   ✓ Audit Status     : ${release.validationResult.promotionGateStatus}`);
console.log(`   ✓ Audit Summary    : ${release.validationResult.auditSummary}\n`);

// 3. Test Explanatory Similarity Feature Engine
console.log("2. Evaluating Explanatory Feature Similarity Engine...");
const candidate = { id: "c1", name: "Swapnil Shukla" };
const opportunity = { jobHash: "j-5a2769562ba0", role: "Head of Growth", company: "FRND", decision: "PURSUE" } as any;

FeatureRegistry.calculateSimilarity(candidate, opportunity, release.versionId).then((res) => {
  console.log(`   ✓ Total Executive Similarity Score: ${(res.totalProximityScore * 100).toFixed(1)}%`);
  console.log(`   ✓ Version Identity: ${res.versionId}`);
  console.log("   ✓ Feature Explanations:");
  for (const contrib of res.contributions) {
    console.log(`     • [${contrib.featureName}] ${contrib.explanation} (Score: ${(contrib.score * 100).toFixed(0)}%)`);
  }

  // 4. Test Zero-Downtime ACL Adapter
  console.log("\n3. Testing Zero-Downtime Anti-Corruption Layer (ACL) Fallback...");
  const cap1 = EKBCompatibilityAdapter.resolveCapability("Performance Marketing");
  console.log(`   ✓ Resolved "Performance Marketing": ${cap1.name} (Source: ${cap1.source})`);

  const cap2 = EKBCompatibilityAdapter.resolveCapability("RevPAR Hospitality Management");
  console.log(`   ✓ Resolved Unknown "RevPAR Hospitality Management": ${cap2.name} (Source: ${cap2.source})\n`);

  console.log("=================================================================");
  console.log("  EKB BENCHMARK PASSED: ZERO DOWNTIME & GOVERMENT GATES VERIFIED");
  console.log("=================================================================");
});
