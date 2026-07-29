// src/lib/intelligence/engines/LifestyleAssessmentEngine.ts

import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { LifestyleAssessment } from "../../domain/semantic";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";
import locationPolicy from '@/data/ontology/location_policy.json';

export class LifestyleAssessmentEngine {
  public static evaluate(
    candidate: CandidateProjection,
    job: JobProjection
  ): LifestyleAssessment {
    const richness = EvidenceRichnessCalculator.calculate(job.originalOpportunity);
    const jobLocLower = job.location.toLowerCase();
    const candidatePrefs = candidate.preferredLocations.map(p => p.toLowerCase().trim());

    // 1. Location Fit (Excluding broad country tokens like 'india' for city-specific matching)
    const specificPrefs = candidatePrefs.filter(p => p !== "india" && p !== "any");
    let locationFit = specificPrefs.some((pref) => {
      return jobLocLower.includes(pref);
    });
    if (specificPrefs.length === 0 || candidatePrefs.includes("any")) {
      locationFit = true;
    }
    if (jobLocLower.includes("remote") && candidate.preferredWorkModel === "REMOTE") {
      locationFit = true;
    }

    // 2. Travel/Work Model Fit
    let travelFit = true;
    if (candidate.preferredWorkModel !== "ANY" && job.workModel !== "UNKNOWN") {
      if (candidate.preferredWorkModel === "REMOTE" && job.workModel === "ON_SITE") {
        travelFit = false;
      }
    }

    // 3. Schedule Fit (flags afternoon shift, night shifts, late-night hours)
    let scheduleFit = true;
    const descLower = `${job.role} ${job.location}`.toLowerCase();
    const scheduleFlags = ["afternoon shift", "night shift", "2:00 pm", "11:00 pm", "late-night", "rotational shift"];
    if (scheduleFlags.some(flag => descLower.includes(flag))) {
      scheduleFit = false;
    }

    // 4. Compensation Fit (default true for matching/unknown bounds)
    const compensationFit = true;

    // Calculate Location Friction Penalty from location_policy.json
    let locationFrictionPenalty = 0;
    const lp: any = locationPolicy;
    if (!locationFit) {
      if (lp.secondaryMetros?.keywords?.some((kw: string) => jobLocLower.includes(kw.toLowerCase()))) {
        locationFrictionPenalty = lp.secondaryMetros.penaltyPoints || 5;
      } else {
        locationFrictionPenalty = lp.regionalTier2?.penaltyPoints || 18;
      }
    }
    if (!travelFit) {
      locationFrictionPenalty += lp.nonPreferredWorkModelPenalty || 10;
    }

    return {
      status: "COMPLETE",
      sufficiency: richness.sufficiency,
      evidenceCount: 4,
      evidenceSummary: {
        extractedSignals: 4,
        inferredSignals: 0,
        ignoredSignals: 0,
        conflictingSignals: 0
      },
      locationFit,
      travelFit,
      scheduleFit,
      compensationFit,
      locationFrictionPenalty
    } as any;
  }
}
