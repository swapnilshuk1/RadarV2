// src/lib/intelligence/engines/IdentityAssessmentEngine.ts

import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { IdentityAssessment } from "../../domain/semantic";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";

export class IdentityAssessmentEngine {
  public static evaluate(
    candidate: CandidateProjection,
    job: JobProjection
  ): IdentityAssessment {
    // Canonical themes on candidate mapped to canonical theme IDs
    const candidateThemes = candidate.executiveThemes.map(t => {
      const lower = t.toLowerCase();
      if (lower === "growth") return "theme_growth";
      if (lower === "commercial") return "theme_commercial";
      if (lower === "customer") return "theme_customer";
      if (lower === "transformation") return "theme_transformation";
      if (lower === "digital") return "theme_digital";
      return t;
    });

    const jobThemes = job.executiveThemes;
    const richness = EvidenceRichnessCalculator.calculate(job.originalOpportunity);

    if (jobThemes.length === 0) {
      return {
        status: "FAILED",
        sufficiency: "INSUFFICIENT",
        evidenceCount: 0,
        failureCode: "EMPTY_THEMES",
        evidenceSummary: { extractedSignals: 0, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 },
        coverage: 0.0,
        matchedThemes: [],
        missingThemes: [],
        verdict: "MISMATCH"
      };
    }

    const matchedThemes = jobThemes.filter(theme => candidateThemes.includes(theme));
    const missingThemes = jobThemes.filter(theme => !candidateThemes.includes(theme));

    const rawCoverage = matchedThemes.length / jobThemes.length;
    /**
     * DESIGN RATIONALE: Theme Density Multiplier
     * Objective: Reduce score inflation on sparse job descriptions that specify only 1 or 2 themes.
     * Design: Require multiple independent executive themes before identity coverage approaches 100%.
     * Constraint: Single-theme matching jobs should never exceed ~65% coverage (0.50 + 0.15 * 1 = 0.65).
     * Maximum Saturation: 4+ matched themes saturate the density multiplier (0.50 + 0.15 * 4 = 1.10 -> clamped to 1.00).
     */
    const densityMultiplier = Math.min(1.0, 0.50 + 0.15 * matchedThemes.length);
    const coverage = Math.round(rawCoverage * densityMultiplier * 1000) / 1000;
    const verdict = coverage >= 0.30 ? "MATCH" : "MISMATCH";

    return {
      status: "COMPLETE",
      sufficiency: richness.sufficiency,
      evidenceCount: jobThemes.length,
      evidenceSummary: {
        extractedSignals: jobThemes.length,
        inferredSignals: 0,
        ignoredSignals: 0,
        conflictingSignals: 0
      },
      coverage,
      matchedThemes,
      missingThemes,
      verdict
    };
  }
}
