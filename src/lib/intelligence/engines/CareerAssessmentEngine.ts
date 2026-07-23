// src/lib/intelligence/engines/CareerAssessmentEngine.ts

import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { CareerAssessment, OperatingLevel } from "../../domain/semantic";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";
import brandTiers from '@/data/ontology/brand_tiers.json';

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

    let trajectory: "FORWARD" | "LATERAL" | "BACKWARD" | "UNKNOWN" = "LATERAL";
    let regressionScore = 0;

    if (diff > 0) {
      trajectory = "BACKWARD";
      // Deterministic linear mapping: Regression Score = LevelDifference * 25
      regressionScore = diff * 25; 
    } else if (diff < 0) {
      trajectory = "FORWARD";
      regressionScore = 0;
    } else {
      trajectory = "LATERAL";
      regressionScore = 0;
    }

    let growthPotential: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" = "MEDIUM";
    if (jobVal > candVal) {
      growthPotential = "HIGH";
    } else if (jobVal < candVal) {
      growthPotential = "LOW";
    }

    // Evaluate Brand Equity & Platform Quality Bonus from brand_tiers.json
    const companyText = (job.company + " " + job.role + " " + (job.originalOpportunity?.normalizedText || "")).toLowerCase();
    let brandEquityBonus = 0;

    const bt: any = brandTiers;
    if (bt.tier1?.keywords?.some((kw: string) => companyText.includes(kw.toLowerCase()))) {
      brandEquityBonus = bt.tier1.bonusPoints || 15;
    } else if (bt.tier2?.keywords?.some((kw: string) => companyText.includes(kw.toLowerCase()))) {
      brandEquityBonus = bt.tier2.bonusPoints || 8;
    }

    // Calculate composite career score
    const careerScore = Math.min(100, Math.max(0, 80 - regressionScore + brandEquityBonus));

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
      growthPotential,
      regressionScore,
      careerScore
    } as any;
  }
}
