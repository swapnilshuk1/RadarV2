import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { CapabilityAssessment, EvidenceMatch } from "../../domain/semantic";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";
import executiveOntology from "@/data/ontology/executive_ontology.json";

export class CapabilityAssessmentEngine {

  /**
   * Computes Transferability Fit T in [0, 1] using Shortest Path Cost on ESG Relationship Graph.
   */
  private static calculateGraphTransferability(jobCap: string, candidateCap: string): { score: number; reason: string } {
    const jobLower = jobCap.toLowerCase().trim();
    const candLower = candidateCap.toLowerCase().trim();

    // Exact String / Substring Match
    if (jobLower === candLower || candLower.includes(jobLower) || jobLower.includes(candLower)) {
      return { score: 1.00, reason: "Direct Exact Match (Path Cost 0.0)" };
    }

    const relGraph = (executiveOntology as any).relationshipGraph || [];
    
    // Find matching edge in Relationship Graph
    const edge = relGraph.find((e: any) => {
      const src = e.source.toLowerCase();
      const tgt = e.target.toLowerCase();
      return (candLower.includes(src) || src.includes(candLower)) &&
             (jobLower.includes(tgt) || tgt.includes(jobLower));
    });

    if (edge) {
      const pathCost = edge.cost || 0.20;
      const score = Number(Math.exp(-1.5 * pathCost).toFixed(2));
      return { score, reason: `Graph Path Transferability (${edge.relation}, Cost ${pathCost})` };
    }

    // Default Fallback for Unrelated Capabilities
    return { score: 0.00, reason: "Unrelated Capability (Path Cost Infinity)" };
  }

  public static evaluate(
    candidate: CandidateProjection,
    job: JobProjection
  ): CapabilityAssessment {
    const richness = EvidenceRichnessCalculator.calculate(job.originalOpportunity);
    const candidateCaps = candidate.coreCapabilities || [];
    const jobCaps = job.capabilities || [];

    if (jobCaps.length === 0) {
      return {
        status: "FAILED",
        sufficiency: "INSUFFICIENT",
        evidenceCount: 0,
        failureCode: "EMPTY_CAPABILITIES",
        evidenceSummary: { extractedSignals: 0, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 },
        overallFit: 0.0,
        matchedCapabilities: [],
        missingCapabilities: []
      };
    }

    const matchedCapabilities: string[] = [];
    const missingCapabilities: string[] = [];
    const matches: EvidenceMatch[] = [];

    let totalTransferabilityScore = 0;

    const explicitCaps = jobCaps.filter(c => c.source === "explicit");

    explicitCaps.forEach((jobCapObj) => {
      const jobCapName = jobCapObj.name;
      let bestMatch: { candidateCap: string; score: number; reason: string } = { candidateCap: "", score: 0, reason: "" };

      candidateCaps.forEach((candCap) => {
        const result = this.calculateGraphTransferability(jobCapName, candCap);
        if (result.score > bestMatch.score) {
          bestMatch = { candidateCap: candCap, score: result.score, reason: result.reason };
        }
      });

      if (bestMatch.score >= 0.40) {
        matchedCapabilities.push(`${jobCapName} (${Math.round(bestMatch.score * 100)}% fit)`);
        matches.push({
          jobCapability: jobCapName,
          candidateCapability: bestMatch.candidateCap,
          confidence: bestMatch.score,
          reason: bestMatch.reason
        });
        totalTransferabilityScore += bestMatch.score;
      } else {
        missingCapabilities.push(jobCapName);
      }
    });

    const explicitFit = explicitCaps.length > 0 ? totalTransferabilityScore / explicitCaps.length : 0.50;
    const overallFit = Number(explicitFit.toFixed(3));
    const matchingConfidence = Number((0.85 - (missingCapabilities.length * 0.05)).toFixed(2));

    return {
      status: "COMPLETE",
      sufficiency: richness.sufficiency,
      evidenceCount: richness.count,
      matchingConfidence: Math.max(0.1, matchingConfidence),
      evidenceSummary: {
        extractedSignals: richness.count,
        inferredSignals: 0,
        ignoredSignals: 0,
        conflictingSignals: 0
      },
      overallFit,
      matchedCapabilities,
      missingCapabilities,
      matches
    };
  }
}
