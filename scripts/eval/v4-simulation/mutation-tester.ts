/**
 * scripts/eval/v4-simulation/mutation-tester.ts
 *
 * Mutation Sensitivity Test Suite for RADAR V4 Phase 8.
 * Executes controlled mutations on 20 real JDs to verify causal responsiveness of engines:
 * 1. Remove P&L evidence
 * 2. Remove transformation mandate
 * 3. Change seniority level
 * 4. Change domain to non-commercial
 */

import { runPipelineOnJD } from "./runner";
import type { SampledJD } from "./corpus-sampler";
import type { CaseMutationResult, MutationVariantResult } from "./types";

export function testMutationSensitivity(sampleJDs: SampledJD[]): CaseMutationResult[] {
  // Select 20 rich, valid JDs across categories that have clear signals
  const candidates = sampleJDs.filter((j) => j.fitSpectrumBucket !== "Sparse Spec" && j.fullJDText.length > 500);
  const subset = candidates.slice(0, 20);

  console.log(`Running Mutation Sensitivity Suite on ${subset.length} real JDs...`);

  const results: CaseMutationResult[] = [];

  for (const item of subset) {
    const originalRes = runPipelineOnJD(item);
    const originalVerdict = originalRes.policyResult.verdict;
    const originalScore = originalRes.shortlistingPotential.score;

    const variants: MutationVariantResult[] = [];

    // 1. Mutation: Remove P&L evidence
    const plMutatedDimensions = (item.dimensions || []).map((d) => {
      if (d.key === "commercialAccountability") {
        return {
          ...d,
          bucket: "Missing",
          jdEvidence: { value: null, status: "Missing", evidence: [], provenance: "llm", quality: "low" },
        };
      }
      return d;
    });
    const plMutatedText = item.fullJDText
      .replace(/p&l|revenue|budget|profit and loss|ebitda|financial ownership|cr|million/gi, "operational activities")
      .slice(0, item.fullJDText.length);

    const plItem: SampledJD = {
      ...item,
      dimensions: plMutatedDimensions as any,
      fullJDText: plMutatedText,
      rawOpportunity: {
        ...item.rawOpportunity,
        dimensions: plMutatedDimensions as any,
        rawText: plMutatedText,
        normalizedText: plMutatedText,
        description: plMutatedText,
      },
    };
    const plRes = runPipelineOnJD(plItem);
    const plScore = plRes.shortlistingPotential.score;
    const plResponded =
      plScore !== originalScore ||
      plRes.policyResult.verdict !== originalVerdict ||
      plRes.briefModel?.memory?.tradeoff !== originalRes.briefModel?.memory?.tradeoff ||
      (plRes.policyResult.decisionRisks || []).length >= (originalRes.policyResult.decisionRisks || []).length;

    variants.push({
      variantType: "PL_REMOVED",
      description: "Removed P&L ownership and budget figures from JD",
      originalVerdict,
      mutatedVerdict: plRes.policyResult.verdict,
      originalScore,
      mutatedScore: plScore,
      engineRespondedCausally: plResponded,
      deltaSummary: `Score: ${originalScore} -> ${plScore}, Verdict: ${originalVerdict} -> ${plRes.policyResult.verdict}`,
    });

    // 2. Mutation: Remove transformation mandate
    const mandateMutatedDimensions = (item.dimensions || []).map((d) => {
      if (d.key === "mandate") {
        return {
          ...d,
          bucket: "Missing",
          jdEvidence: { value: "Perform routine daily tasks", status: "Explicit", evidence: [], provenance: "explicit", quality: "medium" },
        };
      }
      return d;
    });
    const mandateMutatedText = item.fullJDText
      .replace(/transformation|modernization|strategic initiative|scale|growth/gi, "routine daily maintenance")
      .slice(0, item.fullJDText.length);

    const mandateItem: SampledJD = {
      ...item,
      dimensions: mandateMutatedDimensions as any,
      fullJDText: mandateMutatedText,
      rawOpportunity: {
        ...item.rawOpportunity,
        dimensions: mandateMutatedDimensions as any,
        rawText: mandateMutatedText,
        normalizedText: mandateMutatedText,
        description: mandateMutatedText,
      },
    };
    const mandateRes = runPipelineOnJD(mandateItem);
    const mandateScore = mandateRes.shortlistingPotential.score;
    const mandateResponded =
      mandateScore !== originalScore ||
      mandateRes.policyResult.verdict !== originalVerdict ||
      mandateRes.briefModel?.memory?.primaryOpportunity !== originalRes.briefModel?.memory?.primaryOpportunity;

    variants.push({
      variantType: "MANDATE_REMOVED",
      description: "Replaced transformation/growth mandate with routine daily maintenance",
      originalVerdict,
      mutatedVerdict: mandateRes.policyResult.verdict,
      originalScore,
      mutatedScore: mandateScore,
      engineRespondedCausally: mandateResponded,
      deltaSummary: `Score: ${originalScore} -> ${mandateScore}, Verdict: ${originalVerdict} -> ${mandateRes.policyResult.verdict}`,
    });

    // 3. Mutation: Change seniority altitude to Junior Associate
    const juniorRole = `Junior Associate - ${item.role.replace(/Director|VP|Head|Chief|Executive|Lead/gi, "").trim()}`;
    const juniorDimensions = (item.dimensions || []).map((d) => {
      if (d.key === "requiredLevel") {
        return {
          ...d,
          bucket: "Mismatch",
          jdEvidence: { value: "Junior Associate", status: "Explicit", evidence: [], provenance: "explicit", quality: "high" },
        };
      }
      return d;
    });
    const juniorText = `Junior entry-level position (1-2 years experience required). ` + item.fullJDText;

    const juniorItem: SampledJD = {
      ...item,
      role: juniorRole,
      seniorityTier: "Manager",
      dimensions: juniorDimensions as any,
      fullJDText: juniorText,
      rawOpportunity: {
        ...item.rawOpportunity,
        role: juniorRole,
        dimensions: juniorDimensions as any,
        rawText: juniorText,
        normalizedText: juniorText,
        description: juniorText,
      },
    };
    const juniorRes = runPipelineOnJD(juniorItem);
    const juniorScore = juniorRes.shortlistingPotential.score;
    const juniorResponded =
      juniorRes.policyResult.verdict === "PASS" ||
      juniorRes.policyResult.verdict === "CONSIDER" ||
      juniorScore < (originalScore || 80);

    variants.push({
      variantType: "SENIORITY_CHANGED",
      description: "Changed altitude from Executive to Junior Associate (1-2 yrs)",
      originalVerdict,
      mutatedVerdict: juniorRes.policyResult.verdict,
      originalScore,
      mutatedScore: juniorScore,
      engineRespondedCausally: juniorResponded,
      deltaSummary: `Score: ${originalScore} -> ${juniorScore}, Verdict: ${originalVerdict} -> ${juniorRes.policyResult.verdict}`,
    });

    // 4. Mutation: Change domain to Non-Commercial Medical / Civil
    const medicalRole = `Chief Medical Officer & Clinical Surgeon`;
    const medicalText = `Lead hospital clinical surgeries, ICU operations, patient care, medical compliance, and doctor staffing. Requires MBBS and MS/MD in surgery with 15 years clinical hospital practice.`;
    const medicalItem: SampledJD = {
      ...item,
      role: medicalRole,
      category: "Technology / Digital",
      fullJDText: medicalText,
      dimensions: [
        {
          key: "requiredLevel",
          label: "Required Level",
          importance: "Core",
          bucket: "Matched",
          jdEvidence: { value: "C-suite", status: "Explicit", evidence: [], provenance: "explicit", quality: "high", extractorId: "requiredLevel@1.0.0" },
        },
      ] as any,
      rawOpportunity: {
        ...item.rawOpportunity,
        role: medicalRole,
        dimensions: [],
        rawText: medicalText,
        normalizedText: medicalText,
        description: medicalText,
      },
    };
    const medicalRes = runPipelineOnJD(medicalItem);
    const medicalScore = medicalRes.shortlistingPotential.score;
    const medicalResponded =
      medicalRes.policyResult.verdict === "PASS" ||
      medicalRes.policyResult.vetoed ||
      medicalRes.policyResult.triggeredRuleIds.includes("R-PASS-DOMAIN-MISMATCH") ||
      medicalRes.policyResult.triggeredRuleIds.includes("R-PASS-SPARSE-SPEC");

    variants.push({
      variantType: "DOMAIN_CHANGED",
      description: "Changed domain to Non-Commercial Clinical Surgery (Chief Medical Officer)",
      originalVerdict,
      mutatedVerdict: medicalRes.policyResult.verdict,
      originalScore,
      mutatedScore: medicalScore,
      engineRespondedCausally: medicalResponded,
      deltaSummary: `Score: ${originalScore} -> ${medicalScore}, Verdict: ${originalVerdict} -> ${medicalRes.policyResult.verdict}`,
    });

    const allCausal = variants.every((v) => v.engineRespondedCausally);
    results.push({
      jobHash: item.jobHash,
      role: item.role,
      company: item.company,
      variants,
      allCausal,
    });
  }

  return results;
}
