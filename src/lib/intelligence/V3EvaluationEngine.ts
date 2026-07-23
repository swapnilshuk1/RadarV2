/**
 * V3EvaluationEngine.ts
 *
 * Implements Phase 5 (Stateless Evaluation Engine).
 * A pure, stateless domain compiler that evaluates a candidate snapshot against opportunity.
 *
 * Invariant: Always produces identical metrics, findings, and recommendations for the same input.
 */

import { CapabilityRegistry } from "../capability/Registry";
import type { CandidateProjection } from "../domain/candidate";
import type { CandidateIntent } from "../domain/intent";
import type { OpportunityIdentity } from "../domain/opportunity";
import type { EvaluationResult, EvaluationMetrics, EvaluationFindings } from "../domain/evaluation";

export class V3EvaluationEngine {
  /**
   * Evaluates Candidate Snapshots, Intent, and Job Requirements to output structured match evaluations.
   */
  public static evaluate(
    candidate: CandidateProjection,
    intent: CandidateIntent,
    opportunity: OpportunityIdentity
  ): EvaluationResult {
    const jobHash = opportunity.id;

    // 1. Calculate Capability Fit
    const matchedCapabilities: string[] = [];
    const unmatchedCapabilities: string[] = [];
    const strengths: EvaluationFindings["strengths"] = [];
    const gaps: EvaluationFindings["gaps"] = [];

    // Map candidate skills to capability IDs using registry for fast O(1) synonym mapping
    const candidateCapIds = new Set<string>();
    for (const skill of candidate.skills) {
      const match = CapabilityRegistry.lookup(skill);
      if (match) {
        candidateCapIds.add(match.id);
      }
    }

    // Map candidate claims to capability IDs
    for (const claim of candidate.claims) {
      const match = CapabilityRegistry.lookup(claim.statement);
      if (match) {
        candidateCapIds.add(match.id);
      }
    }

    const requiredCaps = opportunity.requiredCapabilities.length > 0 
      ? opportunity.requiredCapabilities 
      : ["cap_crm_strategy"]; // Default fallback if job lists nothing

    for (const capId of requiredCaps) {
      const registryEntry = CapabilityRegistry.lookup(capId);
      const capName = registryEntry ? registryEntry.name : capId;

      if (candidateCapIds.has(capId)) {
        matchedCapabilities.push(capId);
        
        // Find matching claims and evidence
        const matchingClaims = candidate.claims.filter(c => {
          const m = CapabilityRegistry.lookup(c.statement);
          return m && m.id === capId;
        });

        const matchedEvidenceIds = Array.from(new Set(matchingClaims.flatMap(c => c.evidenceIds)));

        strengths.push({
          capability: capName,
          statement: matchingClaims[0]?.statement || `Demonstrated capacity in ${capName}.`,
          matchingEvidenceIds: matchedEvidenceIds
        });
      } else {
        unmatchedCapabilities.push(capId);
        gaps.push({
          capability: capName,
          description: `No active claims found confirming hands-on skill in ${capName}.`,
          severity: "MODERATE"
        });
      }
    }

    let capabilityFitScore = Math.round((matchedCapabilities.length / requiredCaps.length) * 100);

    // Apply capability fit scale discount for sparse descriptions to reflect unverified data risk
    if (requiredCaps.length === 1) {
      capabilityFitScore = Math.round(capabilityFitScore * 0.70);
    } else if (requiredCaps.length === 2) {
      capabilityFitScore = Math.round(capabilityFitScore * 0.85);
    }

    // 2. Calculate Alignment Score (Intent matching) with deep, granular executive attributes
    let locationMatchScore = 0;
    if (opportunity.location) {
      const jobLocLower = opportunity.location.toLowerCase();
      const isRemote = jobLocLower.includes("remote");
      const isIndianMetro = ["india", "mumbai", "bengaluru", "bangalore", "gurugram", "gurgaon", "delhi", "noida", "hyderabad", "pune", "chennai"].some(city => jobLocLower.includes(city));
      const isMiddleEastOrAPAC = ["apac", "middle east", "dubai", "singapore", "malaysia", "thailand", "vietnam", "indonesia"].some(region => jobLocLower.includes(region));

      if (isRemote) {
        locationMatchScore = 35; // Perfect match
      } else if (isIndianMetro) {
        locationMatchScore = 32; // Excellent local target alignment
      } else if (isMiddleEastOrAPAC) {
        locationMatchScore = 28; // Standard target region
      } else {
        locationMatchScore = 5; // Onsite in unpreferred geography (heavy mismatch penalty)
      }
    } else {
      locationMatchScore = 35; // default remote/unstated
    }

    const locationMatch = locationMatchScore >= 25;

    let roleMatchScore = 0;
    const titleLower = opportunity.canonicalTitle.toLowerCase();
    const roleLower = titleLower;

    // Executive Seniority mapping
    const hasCSuite = ["chief", "cmo", "cgo", "cco", "coo"].some(kw => roleLower.includes(kw) || titleLower.includes(kw));
    const hasVP = ["vp", "vice president", "svp", "avp"].some(kw => roleLower.includes(kw) || titleLower.includes(kw));
    const hasDirector = ["director"].some(kw => roleLower.includes(kw) || titleLower.includes(kw));
    const hasHead = ["head"].some(kw => roleLower.includes(kw) || titleLower.includes(kw));

    // Target Marketing/Commercial/Strategy Domains
    const hasMarketingGrowth = ["marketing", "growth", "commercial", "acquisition", "demand", "brand", "sales"].some(kw => roleLower.includes(kw) || titleLower.includes(kw));
    const hasStrategyTransformation = ["strategy", "transformation", "pivot", "migration"].some(kw => roleLower.includes(kw) || titleLower.includes(kw));

    // IC / Junior Penalties
    const isJuniorOrIC = ["associate", "analyst", "intern", "specialist", "coordinator", "consultant"].some(kw => roleLower.includes(kw) || titleLower.includes(kw)) ||
      ((roleLower.includes("executive") || titleLower.includes("executive")) && !["chief", "director", "head", "vp", "senior"].some(kw => roleLower.includes(kw) || titleLower.includes(kw)));

    if (isJuniorOrIC) {
      roleMatchScore = 5; // Heavy individual contributor penalty
    } else if (hasMarketingGrowth || hasStrategyTransformation) {
      if (hasCSuite) {
        roleMatchScore = 35; // Perfect alignment for a prospective CCO track
      } else if (hasVP) {
        roleMatchScore = 33;
      } else if (hasDirector) {
        roleMatchScore = 28;
      } else if (hasHead) {
        roleMatchScore = 22;
      } else {
        roleMatchScore = 15; // Manager
      }
    } else {
      // General senior leadership but not core growth domain
      if (hasCSuite || hasVP) {
        roleMatchScore = 20;
      } else if (hasDirector || hasHead) {
        roleMatchScore = 15;
      } else {
        roleMatchScore = 8;
      }
    }

    const roleMatch = roleMatchScore >= 15;

    let salaryMatch = true;
    if (opportunity.salaryBounds && opportunity.salaryBounds.max) {
      // Check if job's max is below candidate's min preference
      if (opportunity.salaryBounds.max < intent.salaryBand.min) {
        salaryMatch = false;
      }
    }

    let alignmentScoreSum = locationMatchScore + roleMatchScore;
    if (salaryMatch) alignmentScoreSum += 30;
    const alignmentScore = alignmentScoreSum;

    // 3. Evidence Sufficiency Index (ESI) & Certainty
    // ESI represents % of matched capabilities that have valid proof anchors (confidence >= 0.90)
    const strongClaimsCount = strengths.filter(s => s.matchingEvidenceIds.length > 0).length;
    const evidenceSufficiencyIndex = matchedCapabilities.length > 0 
      ? Math.round((strongClaimsCount / matchedCapabilities.length) * 100) / 100
      : 1.0;

    const certainty = 0.90; // Lexical confidence constant

    // 4. Overall Score
    const overallScore = Math.round((0.5 * capabilityFitScore) + (0.5 * alignmentScore));

    // 5. Build Metrics
    const metrics: EvaluationMetrics = {
      overallScore,
      capabilityFitScore,
      alignmentScore,
      evidenceSufficiencyIndex,
      certainty
    };

    // 6. Build Findings
    const contextualRisks: string[] = [];
    if (!salaryMatch) {
      contextualRisks.push("Opportunity salary bounds are below preferred minimum salary target.");
    }
    if (!locationMatch) {
      contextualRisks.push("Location does not match preferred geographical intent.");
    }
    if (gaps.length > 0) {
      contextualRisks.push(`Missing core competency validation for ${unmatchedCapabilities.length} required capability domains.`);
    }

    const findings: EvaluationFindings = {
      strengths,
      gaps,
      contextualRisks,
      marketUrgencyNotes: opportunity.postingWindow ? `Job is highly active, posted ${opportunity.postingWindow}.` : undefined
    };

    // 7. Resolve Recommendation Verb
    let verb: "PURSUE" | "CONSIDER" | "PASS" = "PASS";
    let rationale = "";
    let primaryConcern: string | undefined = undefined;

    if (overallScore >= 75 && evidenceSufficiencyIndex >= 0.40) {
      verb = "PURSUE";
      rationale = `Exceptional matching profile. Strong capability match (${capabilityFitScore}%) and complete alignment with active future career intent.`;
    } else if (overallScore >= 45) {
      verb = "CONSIDER";
      rationale = `Moderate match score. Fits career boundaries, but has competency development gaps or unstated salary brackets.`;
      if (gaps.length > 0) {
        primaryConcern = `Competency gaps in: ${gaps.map(g => g.capability).join(", ")}`;
      }
    } else {
      verb = "PASS";
      rationale = `Insufficient overall alignment with capability expectations and career target bounds.`;
      if (!roleMatch) {
        primaryConcern = "Functional role title mismatch.";
      } else if (!locationMatch) {
        primaryConcern = "Geographical location mismatch.";
      } else {
        primaryConcern = "Low competency fit score.";
      }
    }

    return {
      jobHash,
      metrics,
      findings,
      recommendation: {
        verb,
        rationale,
        primaryConcern
      },
      evaluatedAt: new Date().toISOString()
    };
  }
}
