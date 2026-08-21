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
    const jobLocLower = (job.location || "").toLowerCase().trim();
    const candidatePrefs = (candidate.preferredLocations || []).map(p => p.toLowerCase().trim());

    const lp: any = locationPolicy;
    const clusters: Record<string, string[]> = lp.locationClusters || {};

    // Expand candidate preferences with all synonyms from matching clusters
    const expandedCandidatePrefs = new Set<string>();
    for (const pref of candidatePrefs) {
      expandedCandidatePrefs.add(pref);
      for (const clusterKeywords of Object.values(clusters)) {
        if (clusterKeywords.some(k => k === pref || pref.includes(k) || k.includes(pref))) {
          clusterKeywords.forEach(k => expandedCandidatePrefs.add(k));
        }
      }
    }

    // 1. Location Fit (Excluding broad country tokens like 'india' for city-specific matching)
    const broadTokens = new Set(["india", "apac", "any", "global", "worldwide"]);
    const specificPrefs = Array.from(expandedCandidatePrefs).filter(p => !broadTokens.has(p));

    let locationFit = false;

    if (candidatePrefs.includes("any") || specificPrefs.length === 0) {
      locationFit = true;
    } else {
      // Check if job location matches any expanded preference or cluster
      locationFit = specificPrefs.some((pref) => {
        if (!pref) return false;
        if (jobLocLower.includes(pref) || pref.includes(jobLocLower)) return true;
        const escaped = pref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
        return regex.test(jobLocLower);
      });
    }

    // Remote / Hybrid work model compatibility
    if (jobLocLower.includes("remote") && (candidate.preferredWorkModel === "REMOTE" || candidate.preferredWorkModel === "HYBRID" || candidate.preferredWorkModel === "ANY")) {
      locationFit = true;
    }

    // Country fallback if job is marked as "India" or country-wide
    if (!locationFit && (jobLocLower === "india" || jobLocLower.includes("india")) && candidatePrefs.some(p => p === "india" || p === "apac")) {
      locationFit = true;
    }

    // 2. Travel/Work Model Fit
    let travelFit = true;
    if (candidate.preferredWorkModel !== "ANY" && job.workModel !== "UNKNOWN") {
      if (candidate.preferredWorkModel === "REMOTE" && job.workModel === "ON_SITE") {
        travelFit = false;
      } else if (candidate.preferredWorkModel === "HYBRID" && job.workModel === "ON_SITE") {
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

