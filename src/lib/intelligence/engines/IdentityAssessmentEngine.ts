import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { IdentityAssessment } from "../../domain/semantic";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";
import { IdentityDistanceCalculator } from "../utils/IdentityDistanceCalculator";

export class IdentityAssessmentEngine {
  /**
   * Pure Vector Comparison: Measures topological distance between candidate identity vector and job identity vector.
   * Does NOT "discover" identity; evaluates vector alignment (1 - d).
   */
  public static evaluate(
    candidate: CandidateProjection,
    job: JobProjection
  ): IdentityAssessment {
    const candidateIdentityStr = candidate.executiveThemes?.length 
      ? candidate.executiveThemes[0] 
      : "Commercial & Marketing Leadership";

    const jobIdentityStr = job.executiveIdentity?.value || "Commercial & Marketing Leadership";
    const jobText = (job.role || "") + " " + (job.originalOpportunity?.description || "");

    const distance = IdentityDistanceCalculator.calculate(candidateIdentityStr, jobIdentityStr, jobText);
    const coverage = Number((1.0 - distance).toFixed(2)); // Vector Similarity
    const richness = EvidenceRichnessCalculator.calculate(job.originalOpportunity);

    const isMatch = distance < 0.80;
    const verdict = isMatch ? "MATCH" : "MISMATCH";

    const matchedThemes = isMatch ? [candidateIdentityStr] : [];
    const missingThemes = isMatch ? [] : [jobIdentityStr];

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
      coverage,
      matchedThemes,
      missingThemes,
      verdict
    };
  }
}
