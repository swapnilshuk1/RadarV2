/**
 * DeterministicScorer
 * 
 * The core of the Recommendation Engine.
 * 
 * Architecture:
 *   CandidateProfile + Opportunity (Knowledge Graph slice) + RecommendationPolicy
 *       ↓
 *   DeterministicScorer
 *       ↓
 *   OpportunityAssessment (immutable, persisted)
 * 
 * Rules:
 * - NEVER reads raw text or HTML
 * - NEVER calls an LLM
 * - NEVER mutates an assessment; always creates a new version
 * - Consumes ExtractionResult dimensions only
 */

import type {
  CandidateProfile,
  OpportunityAssessment,
  RecommendationReason,
  MissingEvidence,
} from "../../domain/entities";
import type { RecommendationPolicy } from "./RecommendationPolicy";
import { randomUUID } from "crypto";
import { DimensionResolver, type ResolvedEvidence } from "./DimensionResolver";

/** The knowledge graph slice for a single job that the scorer consumes. */
export interface JobSlice {
  jobId: string;
  jobHash: string;    // Fingerprint of the extraction, for cache key
  graphVersion: string;
  dimensions: Record<string, DimensionValue>;
}

export interface DimensionValue {
  value: string | number | boolean | null;
  confidence?: number;
  evidence?: string; // Human-readable reference to the JD text
}

export interface ScorerInput {
  profile: CandidateProfile;
  policy: RecommendationPolicy;
  job: JobSlice;
  recommendationRunId: string;
}

export class DeterministicScorer {
  private resolver = new DimensionResolver();

  score(input: ScorerInput): OpportunityAssessment {
    const { profile, policy, job, recommendationRunId } = input;
    const reasons: RecommendationReason[] = [];
    const missingEvidence: MissingEvidence[] = [];

    let rawScore = 0;
    let maxPossibleScore = 0;

    // === HARD CONSTRAINTS (deal-breakers) ===
    for (const constraint of profile.hardConstraints) {
      const violated = this.checkHardConstraint(constraint, job, profile);
      if (violated) {
        reasons.push({
          type: "Risk",
          severity: "High",
          dimension: "HardConstraint",
          score: -100,
          message: `Hard constraint violated: ${constraint}`,
        });
        return this.buildAssessment({
          recommendationRunId,
          job,
          profile,
          rawScore: 0,
          maxPossibleScore: 100,
          decision: "Weak Fit",
          reasons,
          missingEvidence,
        });
      }
    }

    // === DIMENSION SCORING (based on policy weights) ===
    for (const [dimension, weight] of Object.entries(policy.weights)) {
      maxPossibleScore += weight;

      const evidence = this.resolver.resolve(dimension, job, profile);

      if (evidence.source === "none" || evidence.value === undefined || evidence.value === null) {
        // Not in JD — mark as missing, don't penalise
        const category = this.classifyMissingEvidence(dimension);
        missingEvidence.push({ dimension, category });
        continue;
      }

      const [dimScore, reason] = this.scoreDimension(dimension, evidence, weight, profile, policy);
      rawScore += dimScore;
      reasons.push(reason);
    }

    // === CONFIDENCE BREAKDOWN ===
    const totalDimensions = Object.keys(policy.weights).length;
    const extractedCount = totalDimensions - missingEvidence.length;

    // Data confidence: how much of what we need do we have?
    const dataConfidence = totalDimensions > 0
      ? Math.round((extractedCount / totalDimensions) * 100)
      : 0;

    // Model confidence: we're fully deterministic, so always high
    const modelConfidence = 95;

    // Recommendation confidence: geometric mean of data and model confidence
    const recommendationConfidence = Math.round(
      Math.sqrt(dataConfidence * modelConfidence)
    );

    // === NORMALISE SCORE ===
    const normalisedScore = maxPossibleScore > 0
      ? Math.round((rawScore / maxPossibleScore) * 100)
      : 0;

    let decision: OpportunityAssessment["decision"];
    const confidenceCutoff = policy.thresholds?.confidenceCutoff ?? 50;
    if (dataConfidence < confidenceCutoff) {
      decision = "Needs More Evidence";
    } else {
      decision = this.scoreToDecision(normalisedScore, policy);
    }

    return this.buildAssessment({
      recommendationRunId,
      job,
      profile,
      rawScore: normalisedScore,
      maxPossibleScore: 100,
      dataConfidence,
      modelConfidence,
      recommendationConfidence,
      decision,
      reasons,
      missingEvidence,
    });
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private scoreDimension(
    dimension: string,
    evidence: ResolvedEvidence,
    weight: number,
    profile: CandidateProfile,
    policy: RecommendationPolicy
  ): [number, RecommendationReason] {
    const value = String(evidence.value ?? "").toLowerCase();

    // === Leadership Level ===
    if (dimension === "leadershipLevel") {
      const seniorTerms = ["ceo", "coo", "cto", "cfo", "president", "vp", "svp", "evp", "md", "director", "chief"];
      const isMatch = seniorTerms.some(t => value.includes(t));
      return [
        isMatch ? weight : Math.round(weight * 0.4),
        {
          type: isMatch ? "Strength" : "Gap",
          severity: isMatch ? "High" : "Medium",
          dimension,
          score: isMatch ? weight : Math.round(weight * 0.4),
          message: isMatch
            ? `Senior leadership role (${evidence.value}) — strong match`
            : `Leadership level (${evidence.value}) may be below target seniority`,
        },
      ];
    }

    // === Transformation ===
    if (dimension === "transformation") {
      const isPresent = value && value !== "none" && value !== "n/a";
      return [
        isPresent ? weight : Math.round(weight * 0.3),
        {
          type: isPresent ? "Strength" : "Gap",
          severity: isPresent ? "High" : "Low",
          dimension,
          score: isPresent ? weight : Math.round(weight * 0.3),
          message: isPresent
            ? `Transformation mandate present: ${evidence.value}`
            : "No clear transformation mandate identified",
        },
      ];
    }

    // === Geography ===
    if (dimension === "geography") {
      const geoScoring = (policy as any).geographyScoring || { exact: 1.0, regional: 0.75, country: 0.5, remote: 0.8 };
      let factor = geoScoring.country;
      
      const profileLocations = (profile.preferences?.locations || []).map((l: string) => l.toLowerCase());
      const jobLoc = value.toLowerCase();
      
      if (profileLocations.some((l: string) => l.includes(jobLoc) || jobLoc.includes(l))) {
        factor = geoScoring.exact;
      } else if (["global", "international", "worldwide", "apac", "emea", "americas", "regional"].some(t => jobLoc.includes(t))) {
        factor = geoScoring.regional;
      } else if (jobLoc.includes("remote")) {
        factor = geoScoring.remote;
      }

      const dimScore = Math.round(weight * factor);
      return [
        dimScore,
        {
          type: factor >= 0.75 ? "Strength" : "Info",
          severity: factor >= 0.75 ? "Medium" : "Low",
          dimension,
          score: dimScore,
          message: `Geography match level: ${factor * 100}% (${evidence.value})`,
        },
      ];
    }

    // === Technology Stack ===
    if (dimension === "technologyStack") {
      const profileTech = profile.technology.map(t => t.toLowerCase());
      const jobTech = value.split(/[\s,/;]+/).map(t => t.trim()).filter(Boolean);
      const overlap = jobTech.filter(t => profileTech.some(p => p.includes(t) || t.includes(p)));
      
      const intersection = overlap.length;
      const denominator = Math.min(profileTech.length, jobTech.length);
      const ratio = denominator > 0 ? intersection / denominator : 0;
      const dimScore = Math.round(weight * ratio);
      
      return [
        dimScore,
        {
          type: ratio > 0.5 ? "Strength" : "Info",
          severity: ratio > 0.5 ? "Medium" : "Low",
          dimension,
          score: dimScore,
          message: `Tech overlap: ${overlap.join(", ") || "minimal"} (${Math.round(ratio * 100)}% match)`,
        },
      ];
    }

    // === Functional Scope ===
    if (dimension === "functionalScope") {
      const profileFunc = profile.functions.map(f => f.toLowerCase());
      const jobFunc = value.split(/[\s,/;]+/).map(f => f.trim()).filter(Boolean);
      
      const overlap = jobFunc.filter(f => profileFunc.some(p => p.includes(f) || f.includes(p)));
      const unionSet = new Set([...profileFunc, ...jobFunc]);
      const ratio = unionSet.size > 0 ? overlap.length / unionSet.size : 0;
      const dimScore = Math.round(weight * ratio);

      return [
        dimScore,
        {
          type: ratio > 0.4 ? "Strength" : "Info",
          severity: ratio > 0.4 ? "Medium" : "Low",
          dimension,
          score: dimScore,
          message: `Functional scope overlap: ${overlap.join(", ") || "none"} (${Math.round(ratio * 100)}% Jaccard)`,
        },
      ];
    }

    // Default: present = full score, absent/unknown = 50%
    const isPresent = value && value !== "none" && value !== "n/a" && value !== "unknown";
    const dimScore = isPresent ? weight : Math.round(weight * 0.5);
    return [
      dimScore,
      {
        type: isPresent ? "Strength" : "Info",
        severity: "Low",
        dimension,
        score: dimScore,
        message: `${dimension}: ${evidence.value ?? "not specified"}`,
      },
    ];
  }

  private checkHardConstraint(constraint: string, job: JobSlice, profile: CandidateProfile): boolean {
    const lc = constraint.toLowerCase();
    if (lc === "no_individual_contributor") {
      const evidence = this.resolver.resolve("leadershipLevel", job, profile);
      const ll = evidence.value;
      const isIC = ll && String(ll).toLowerCase().match(/individual|engineer|analyst|associate/);
      return !!isIC;
    }
    return false;
  }

  private classifyMissingEvidence(dimension: string): MissingEvidence["category"] {
    const critical = ["leadershipLevel", "mandate", "commercialAccountability"];
    const nicetohave = ["technologyStack", "workModel", "geography"];
    if (critical.includes(dimension)) return "Critical";
    if (nicetohave.includes(dimension)) return "Nice to Have";
    return "Unknown";
  }

  private scoreToDecision(score: number, policy: RecommendationPolicy): OpportunityAssessment["decision"] {
    const thresholds = policy.decisionThresholds || { excellent: 80, good: 60, average: 40 };
    if (score >= thresholds.excellent) return "Excellent";
    if (score >= thresholds.good) return "Good";
    if (score >= thresholds.average) return "Average";
    return "Weak Fit";
  }

  private buildAssessment(params: {
    recommendationRunId: string;
    job: JobSlice;
    profile: CandidateProfile;
    rawScore: number;
    maxPossibleScore: number;
    dataConfidence?: number;
    modelConfidence?: number;
    recommendationConfidence?: number;
    decision: OpportunityAssessment["decision"];
    reasons: RecommendationReason[];
    missingEvidence: MissingEvidence[];
  }): OpportunityAssessment {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      jobId: params.job.jobId,
      candidateProfileId: params.profile.id,
      recommendationRunId: params.recommendationRunId,
      score: params.rawScore,
      dataConfidence: params.dataConfidence ?? 0,
      modelConfidence: params.modelConfidence ?? 95,
      recommendationConfidence: params.recommendationConfidence ?? 0,
      decision: params.decision,
      reasons: params.reasons,
      missingEvidence: params.missingEvidence,
      createdAt: now,
      updatedAt: now,
      provenance: {
        schemaVersion: "1.0",
        timestamp: now,
      } as any,
    };
  }
}
