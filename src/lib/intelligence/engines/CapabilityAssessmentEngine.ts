import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection, CapabilityTaxonomyTier } from "../../domain/job_projection";
import { CapabilityAssessment, EvidenceMatch } from "../../domain/semantic";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";
import type { CandidateEvaluationContext } from "../context";
import executiveOntology from "@/data/ontology/executive_ontology.json";
import { RequirementEvidenceAdapter } from "../semantic/RequirementEvidenceAdapter";

export class CapabilityAssessmentEngine {

  /**
   * Domain Operational Equivalence Lookup Map.
   * Maps required job capability tokens to 4-hop operational evidence clusters.
   */
  private static readonly OPERATIONAL_EQUIVALENCE_CLUSTERS: Record<string, string[]> = {
    "crm": [
      "salesforce marketing cloud", "sfmc", "cdp", "customer data platform",
      "crm strategy", "crm analytics", "customer analytics", "klaviyo",
      "braze", "segment", "freshworks", "kustomer", "retention & expansion", "ga4"
    ],
    "crm governance": [
      "salesforce marketing cloud", "sfmc", "cdp", "customer data platform",
      "crm strategy", "pipeline governance", "data governance", "crm analytics",
      "international crm governance", "adobe experience cloud"
    ],
    "revops": [
      "sales & gtm strategy", "sales operations", "revenue operations",
      "managed $12m performance marketing budget", "pipeline analytics", "forecasting",
      "p&l ownership", "commercial growth"
    ],
    "customer success": [
      "retention & expansion (nrr)", "customer analytics", "account expansion",
      "client relationship management", "growth marketing"
    ],
    "nrr": [
      "retention & expansion (nrr)", "customer analytics", "account expansion",
      "d2c growth + performance + crm"
    ],
    "customer intelligence": [
      "google analytics 4 (ga4)", "cdp", "custom customer data platforms (cdp)",
      "customer analytics", "crm analytics", "mixpanel", "appsflyer", "adjust"
    ],
    "gtm strategy": [
      "sales & gtm strategy", "performance marketing", "omni-channel",
      "brand marketing", "commercial growth", "d2c growth", "budget ownership"
    ],
    "performance marketing": [
      "managed $12m performance marketing budget", "growth marketing",
      "d2c growth + performance + crm", "google analytics 4 (ga4)", "adjust", "appsflyer"
    ],
    "digital transformation": [
      "digital transformation", "e-commerce expansion", "cloud",
      "enterprise architecture", "databricks", "redshift", "snowflake"
    ]
  };

  /**
   * Computes Transferability Fit using Operational Equivalence & Shortest Path Graph Costs.
   */
  private static evaluateCapabilityProof(
    jobCap: string,
    candidateProofPool: string[],
    candidate: CandidateProjection,
    context?: CandidateEvaluationContext
  ): { score: number; potentialScore: number; reason: string; matchedProof: string } {
    const jobLower = jobCap.toLowerCase().trim();

    // 0. Requirement-Aware Canonical Semantic Evidence Check
    if (candidate.semanticEvidence && candidate.semanticEvidence.length > 0) {
      const semResult = RequirementEvidenceAdapter.evaluateCapabilitySatisfaction(jobCap, candidate.semanticEvidence);
      if (semResult.satisfies) {
        const score = semResult.strength === "DIRECT_MATCH" ? 1.00 : 0.88;
        const potentialScore = semResult.strength === "DIRECT_MATCH" ? 1.00 : 0.95;
        return {
          score,
          potentialScore,
          reason: semResult.reason,
          matchedProof: semResult.matchedProof || jobCap
        };
      }
    }

    // 1. Direct Exact Substring Match
    for (const proof of candidateProofPool) {
      const proofLower = proof.toLowerCase().trim();
      if (jobLower === proofLower || proofLower.includes(jobLower) || jobLower.includes(proofLower)) {
        return { score: 1.00, potentialScore: 1.00, reason: "Direct Explicit Evidence Match", matchedProof: proof };
      }
    }

    // Check functional adjacency between candidate identity and job domain
    const candidateIdentity = (candidate.executiveThemes || []).join(" ").toLowerCase();
    const isCommercialCandidate = candidateIdentity.includes("commercial") || candidateIdentity.includes("marketing") || candidateIdentity.includes("growth");
    const isOrthogonalDomain = ["medical", "clinical", "hospital", "nuclear", "supply chain", "logistics", "procurement", "manufacturing", "site strategy"].some(d => jobLower.includes(d));

    // 2. Scope of Responsibility & Executive Altitude Ground
    // Generic executive keywords only grant transferability if the domain is not strictly orthogonal
    const isHighLevelExecutiveCap = ["leadership", "governance", "commercial", "transformation", "executive", "strategy", "management"].some(kw => jobLower.includes(kw));
    if (isHighLevelExecutiveCap && !(isCommercialCandidate && isOrthogonalDomain)) {
      if (candidate.decisionAuthority?.value === "ENTERPRISE" || candidate.commercialScope?.value === "ENTERPRISE") {
        return {
          score: 0.70,
          potentialScore: 0.92,
          reason: `Enterprise Scope Grounding (${candidate.decisionAuthority?.value || candidate.commercialScope?.value} Decision Authority proves ${jobCap})`,
          matchedProof: `Enterprise P&L Ownership & ${candidate.decisionAuthority?.value || "ENTERPRISE"} Board Decision Authority`
        };
      }
    }

    // 3. 4-Hop Operational Equivalence Cluster Traversal
    for (const [clusterKey, EquivalentTokens] of Object.entries(this.OPERATIONAL_EQUIVALENCE_CLUSTERS)) {
      if (jobLower.includes(clusterKey) || clusterKey.includes(jobLower)) {
        for (const proof of candidateProofPool) {
          const proofLower = proof.toLowerCase().trim();
          if (EquivalentTokens.some(tok => proofLower.includes(tok) || tok.includes(proofLower))) {
            return {
              score: 0.85,
              potentialScore: 0.95,
              reason: `Operational Equivalence (${proof} ➔ ${jobCap})`,
              matchedProof: proof
            };
          }
        }
      }
    }

    // 4. Ontological Relationship Graph Path
    const relGraph =
      (context?.compiledOntology?.ontology as any)?.relationshipGraph ||
      (executiveOntology as any).relationshipGraph ||
      [];
    for (const proof of candidateProofPool) {
      const proofLower = proof.toLowerCase().trim();
      const edge = relGraph.find((e: any) => {
        const src = e.source.toLowerCase();
        const tgt = e.target.toLowerCase();
        return (proofLower.includes(src) || src.includes(proofLower)) &&
               (jobLower.includes(tgt) || tgt.includes(jobLower));
      });

      if (edge) {
        const pathCost = edge.cost || 0.20;
        const score = Number(Math.exp(-1.5 * pathCost).toFixed(2));
        return { score, potentialScore: Math.min(1.0, score + 0.15), reason: `Graph Path Transferability (${edge.relation})`, matchedProof: proof };
      }
    }

    // 5. Conditional Potential Floor Equation:
    // Floor = Executive Altitude x Identity Overlap x Functional Adjacency
    const isExecutiveLevel = candidate.operatingLevel?.value === "EXECUTIVE" || candidate.commercialScope?.value === "ENTERPRISE";

    let baselinePotential = 0.20;
    if (isExecutiveLevel) {
      if (isCommercialCandidate && isOrthogonalDomain) {
        baselinePotential = 0.15; // Low floor for orthogonal non-commercial domains (e.g. Chief Medical Officer / Hospital Ops)
      } else if (isCommercialCandidate) {
        baselinePotential = 0.55; // High floor for functionally adjacent executive roles
      } else {
        baselinePotential = 0.35;
      }
    }

    return {
      score: 0.00,
      potentialScore: baselinePotential,
      reason: isOrthogonalDomain 
        ? "Orthogonal Domain Trajectory (Limited Leadership Transferability)" 
        : (isExecutiveLevel ? "Executive Capability Potential (Transferable Leadership Baseline)" : "Unproven Capability"),
      matchedProof: isOrthogonalDomain ? "Functional Divergence Warning" : (isExecutiveLevel ? "Executive Career Memory & Leadership Altitude" : "")
    };
  }

  public static evaluate(
    candidate: CandidateProjection,
    job: JobProjection,
    context?: CandidateEvaluationContext
  ): CapabilityAssessment {
    const richness = EvidenceRichnessCalculator.calculate(job.originalOpportunity);
    const jobCaps = job.capabilities || [];

    if (jobCaps.length === 0) {
      return {
        status: "FAILED",
        sufficiency: "INSUFFICIENT",
        evidenceState: "UNAVAILABLE",
        evidenceCount: 0,
        failureCode: "EMPTY_CAPABILITIES",
        evidenceSummary: { extractedSignals: 0, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 },
        overallFit: null, // Unknown - not neutral
        capabilityPotential: null,
        evidenceStrength: 0,
        matchingConfidence: 0,
        matchedCapabilities: [],
        missingCapabilities: [],
        matches: []
      };
    }

    // 1. Build Accumulated Candidate Proof Pool
    const candidateProofPool: string[] = Array.from(
      new Set([
        ...(candidate.coreCapabilities || []),
        ...(candidate.executiveThemes || []),
        candidate.commercialScope?.value || "",
        candidate.decisionAuthority?.value || "",
        candidate.operatingLevel?.value || ""
      ].filter(Boolean))
    );

    const matchedCapabilities: string[] = [];
    const missingCapabilities: string[] = [];
    const matches: EvidenceMatch[] = [];

    let totalEvidenceScoreSum = 0;
    let totalPotentialScoreSum = 0;
    let totalWeightSum = 0;

    const explicitCaps = jobCaps.filter(c => typeof c === "object" && c !== null && (c as any).source === "explicit");
    const capsToEvaluate = explicitCaps.length > 0 ? explicitCaps : jobCaps;

    capsToEvaluate.forEach((jobCapObj) => {
      const jobCapName = typeof jobCapObj === "string" ? jobCapObj : (jobCapObj as any)?.name || "";
      const tier: CapabilityTaxonomyTier = typeof jobCapObj === "string" ? "CORE_MANDATE" : ((jobCapObj as any)?.tier || "EXECUTION_CAPABILITY");
      
      let weight = 0.30;
      if (tier === "CORE_MANDATE") weight = 0.40;
      else if (tier === "EXECUTION_CAPABILITY") weight = 0.30;
      else if (tier === "TECHNOLOGY_STACK") weight = 0.15;
      else if (tier === "DOMAIN_FAMILIARITY") weight = 0.15;

      totalWeightSum += weight;

      const proofResult = this.evaluateCapabilityProof(jobCapName, candidateProofPool, candidate, context);

      totalEvidenceScoreSum += proofResult.score * weight;
      totalPotentialScoreSum += proofResult.potentialScore * weight;

      if (proofResult.score >= 0.40) {
        matchedCapabilities.push(`${jobCapName} [${tier}] (Proof: ${Math.round(proofResult.score * 100)}%, Potential: ${Math.round(proofResult.potentialScore * 100)}%)`);
        matches.push({
          jobCapability: jobCapName,
          candidateCapability: proofResult.matchedProof,
          confidence: proofResult.score,
          reason: proofResult.reason
        });
      } else {
        missingCapabilities.push(`${jobCapName} [${tier}]`);
      }
    });

    const evidenceStrength = totalWeightSum > 0 ? Number((totalEvidenceScoreSum / totalWeightSum).toFixed(3)) : 0.00;
    const capabilityPotential = totalWeightSum > 0 ? Number((totalPotentialScoreSum / totalWeightSum).toFixed(3)) : 0.50;

    // Dual-Vector Balanced Overall Fit: Potential x 0.70 + Evidence x 0.30
    const rawFit = Number((capabilityPotential * 0.70 + evidenceStrength * 0.30).toFixed(3));

    // Determine 3-state Capability Evidence
    const hasParsedCapabilities = capsToEvaluate.length > 0 && capsToEvaluate.some(c => c.name && c.name.length > 2);
    // If capabilities exist but job evidence richness is insufficient, still evaluate capabilities
    // UNAVAILABLE only when NO capabilities to evaluate
    const evidenceState = !hasParsedCapabilities 
      ? "UNAVAILABLE" 
      : (matchedCapabilities.length > 0 ? "SUFFICIENT" : "PARTIAL");

    // overallFit is null when evidence is unavailable (no capabilities to evaluate)
    const overallFit = evidenceState === "UNAVAILABLE" ? null : rawFit;

    const rawConf = Number((0.92 - (missingCapabilities.length * 0.02)).toFixed(2));
    const matchingConfidence = isNaN(rawConf) ? 0.80 : Math.max(0.20, rawConf);

    return {
      status: "COMPLETE",
      sufficiency: richness.sufficiency,
      evidenceState,
      evidenceCount: richness.count,
      matchingConfidence: Math.max(0.2, matchingConfidence),
      evidenceSummary: {
        extractedSignals: richness.count,
        inferredSignals: candidateProofPool.length,
        ignoredSignals: 0,
        conflictingSignals: 0
      },
      overallFit,
      capabilityPotential,
      evidenceStrength,
      matchedCapabilities,
      missingCapabilities,
      matches
    };
  }
}
