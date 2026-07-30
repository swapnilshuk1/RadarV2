import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { CareerAssessment, OperatingLevel } from "../../domain/semantic";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";
import { CareerValueEngine } from "./CareerValueEngine";
import brandTiers from "@/data/ontology/brand_tiers.json";

const LEVEL_HIERARCHY: Record<Exclude<OperatingLevel, "UNKNOWN">, number> = {
  EXECUTIVE: 5,
  STRATEGIC: 4,
  MANAGERIAL: 3,
  TACTICAL: 2,
  INDIVIDUAL_CONTRIBUTOR: 1
};

export class CareerAssessmentEngine {
  public static evaluate(
    candidate: CandidateProjection,
    job: JobProjection
  ): CareerAssessment {
    const richness = EvidenceRichnessCalculator.calculate(job.originalOpportunity);

    if (
      job.operatingLevel.value === "UNKNOWN" ||
      candidate.operatingLevel.value === "UNKNOWN"
    ) {
      return {
        status: "FAILED",
        sufficiency: "INSUFFICIENT",
        evidenceCount: 0,
        failureCode: "UNKNOWN_OPERATING_LEVEL",
        evidenceSummary: { extractedSignals: 0, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 },
        trajectory: "UNKNOWN",
        growthPotential: "UNKNOWN",
        regressionScore: 100
      };
    }

    const candVal = LEVEL_HIERARCHY[candidate.operatingLevel.value] || 1;
    const jobVal = LEVEL_HIERARCHY[job.operatingLevel.value] || 1;
    const diff = candVal - jobVal;

    const cvb = CareerValueEngine.evaluate(candidate, job);

    // 1. Evaluate Career Capital Gain
    const companyText = (job.company + " " + job.role + " " + (job.originalOpportunity?.normalizedText || "")).toLowerCase();
    let brandCapitalGain = 10;

    const bt: any = brandTiers;
    if (bt.tier1?.keywords?.some((kw: string) => companyText.includes(kw.toLowerCase()))) {
      brandCapitalGain = 25; // High Tier-1 Brand Capital Gain (OpenAI, Google, etc.)
    } else if (bt.tier2?.keywords?.some((kw: string) => companyText.includes(kw.toLowerCase()))) {
      brandCapitalGain = 15;
    }

    const platformScaleGain = cvb.commercialScale.value * 20;
    const scopeOwnershipGain = cvb.scopeExpansion.value * 20;
    const totalCareerCapitalGain = brandCapitalGain + platformScaleGain + scopeOwnershipGain;

    // 2. Evaluate Independent Career Risk
    let titleRegressionRisk = diff > 0 ? diff * 15 : 0;
    let executionAmbiguityRisk = 10;
    
    if (job.operatingContext.pnlResponsibility === false) executionAmbiguityRisk += 5;
    if (job.operatingContext.directReports === false) executionAmbiguityRisk += 5;

    const totalCareerRisk = titleRegressionRisk + executionAmbiguityRisk;

    // 3. Compute Net Dual-Balance Career Value
    const netCareerValue = Math.min(100, Math.max(0, Math.round(totalCareerCapitalGain - totalCareerRisk + 40)));

    let trajectory: "FORWARD" | "LATERAL" | "BACKWARD" | "UNKNOWN" = "LATERAL";
    if (totalCareerCapitalGain > totalCareerRisk + 15) {
      trajectory = "FORWARD";
    } else if (totalCareerRisk > totalCareerCapitalGain + 15) {
      trajectory = "BACKWARD";
    } else {
      trajectory = "LATERAL";
    }

    const regressionScore = Math.max(0, totalCareerRisk - brandCapitalGain);

    return {
      status: "COMPLETE",
      sufficiency: richness.sufficiency,
      evidenceCount: 1,
      evidenceSummary: {
        extractedSignals: 1,
        inferredSignals: 0,
        ignoredSignals: 0,
        conflictingSignals: 0
      },
      trajectory,
      growthPotential: netCareerValue >= 75 ? "HIGH" : netCareerValue >= 55 ? "MEDIUM" : "LOW",
      regressionScore,
      careerScore: netCareerValue,
      careerCapitalGain: totalCareerCapitalGain,
      careerRisk: totalCareerRisk
    } as any;
  }
}
