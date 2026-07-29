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
  DecisionConfidence,
  DecisionImpact,
} from "../../domain/entities";
import { DimensionResolver, type ResolvedEvidence } from "./DimensionResolver";
import type { RecommendationPolicy } from "./RecommendationPolicy";

function generateUUID(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}


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
  calibrationConfig: any; // injected, no fs reads
}

export class DeterministicScorer {
  private resolver = new DimensionResolver();

  score(input: ScorerInput): OpportunityAssessment {
    const { profile, policy, job, recommendationRunId, calibrationConfig } = input;

    // 1. Compute Raw Scores deterministically
    const {
      rawScore,
      maxPossibleScore,
      normalisedScore,
      reasons,
      missingEvidence,
    } = this.computeRawScores(job, profile, policy);

    // 2. Determine initial decision
    let decision: OpportunityAssessment["decision"];
    const totalDimensions = Object.keys(policy.weights).length;
    const dataConfidence = totalDimensions > 0
      ? Math.round(((totalDimensions - missingEvidence.length) / totalDimensions) * 100)
      : 0;
    const confidenceCutoff = policy.thresholds?.confidenceCutoff ?? 50;

    if (dataConfidence < confidenceCutoff) {
      decision = "Needs More Evidence";
    } else {
      decision = this.scoreToDecision(normalisedScore, policy);
    }

    // 3. Calibrate Decision Confidence Layer (Sprint 12)
    const decisionConfidence = this.calculateDecisionConfidence(job, profile, policy, normalisedScore, decision, calibrationConfig);

    return this.buildAssessment({
      recommendationRunId,
      job,
      profile,
      rawScore: normalisedScore,
      maxPossibleScore: 100,
      dataConfidence,
      modelConfidence: 95,
      recommendationConfidence: Math.round(decisionConfidence.overall * 100),
      decision,
      reasons,
      missingEvidence,
      decisionConfidence,
    });
  }

  // ============================================================================
  // Core Scoring Engine Logic (Splitted for Perturbation Isolation)
  // ============================================================================

  private computeRawScores(
    job: JobSlice,
    profile: CandidateProfile,
    policy: RecommendationPolicy
  ): {
    rawScore: number;
    maxPossibleScore: number;
    normalisedScore: number;
    reasons: RecommendationReason[];
    missingEvidence: MissingEvidence[];
  } {
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
        return {
          rawScore: 0,
          maxPossibleScore: 100,
          normalisedScore: 0,
          reasons,
          missingEvidence,
        };
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

    const normalisedScore = maxPossibleScore > 0
      ? Math.round((rawScore / maxPossibleScore) * 100)
      : 0;

    return {
      rawScore,
      maxPossibleScore,
      normalisedScore,
      reasons,
      missingEvidence,
    };
  }

  // ============================================================================
  // Sprint 12 — Decision Confidence Layer (Calibration & Perturbation)
  // ============================================================================

  private calculateDecisionConfidence(
    job: JobSlice,
    profile: CandidateProfile,
    policy: RecommendationPolicy,
    baseScore: number,
    baseDecision: OpportunityAssessment["decision"],
    config: any
  ): DecisionConfidence {
    const limitingDimensions: DecisionImpact[] = [];
    let sumCalibratedConfidence = 0;
    let sumWeights = 0;

    const dimensions = Object.keys(policy.weights);

    for (const dimension of dimensions) {
      const evidence = this.resolver.resolve(dimension, job, profile);
      const policyWeight = policy.weights[dimension] ?? 0;

      const coeff = config.coefficients[dimension] || { inferredWeight: 0.70 };
      const inferredWeight = coeff.inferredWeight;

      let dimConfidence = 1.0; // Default for explicit/observed facts

      if (evidence.source === "none" || evidence.value === undefined || evidence.value === null) {
        dimConfidence = 0.0;
      } else if (evidence.source === "llm" || evidence.source === "derived") {
        dimConfidence = inferredWeight; // calibrated discount coefficient
      }

      sumCalibratedConfidence += dimConfidence * policyWeight;
      sumWeights += policyWeight;

      // Deterministic Perturbation Invariant Loop (No LLM participation)
      const admissibleValues = this.getAdmissibleValuesForDimension(dimension);
      let maxDelta = 0;
      let flipped = false;

      for (const val of admissibleValues) {
        const perturbedJob: JobSlice = {
          ...job,
          dimensions: {
            ...job.dimensions,
            [dimension]: {
              value: val,
              confidence: 1.0,
            }
          }
        };

        const result = this.computeRawScores(perturbedJob, profile, policy);
        const delta = Math.abs(result.normalisedScore - baseScore);
        if (delta > maxDelta) {
          maxDelta = delta;
        }

        const perturbedDecision = result.normalisedScore >= (policy.thresholds?.confidenceCutoff ?? 50)
          ? this.scoreToDecision(result.normalisedScore, policy)
          : "Needs More Evidence";

        if (perturbedDecision !== baseDecision) {
          flipped = true;
        }
      }

      const impactScore = maxDelta / 100;

      if (impactScore >= config.thresholds.highImpactThreshold || flipped) {
        limitingDimensions.push({
          attribute: dimension,
          impactScore: Math.round(impactScore * 100) / 100,
          direction: baseDecision === "Weak Fit" || baseDecision === "Needs More Evidence" ? "UP" : "DOWN",
          narrative: flipped
            ? `Verifying this would flip your recommendation from ${baseDecision}.`
            : `Highly sensitive to ${dimension} verification.`,
        });
      }
    }

    // Sort limiting dimensions by decision impact score descending
    limitingDimensions.sort((a, b) => b.impactScore - a.impactScore);

    // Limit to maxQuestions to enforce the Minimal Fact Rule
    const limitedQuestions = limitingDimensions.slice(0, config.thresholds.maxHighImpactQuestions);

    const overall = sumWeights > 0 ? sumCalibratedConfidence / sumWeights : 1.0;

    // Discount stability according to high-impact gaps
    let stability = 1.0;
    for (const ld of limitedQuestions) {
      stability -= ld.impactScore * 0.4;
    }
    stability = Math.max(0.1, Math.min(1.0, stability));

    // Plain-English Advice Explanation (Asymmetric UI principle)
    let explanation = "";
    if (overall >= 0.85 && stability >= 0.85) {
      explanation = "All core criteria are explicitly verified. Highly stable recommendation.";
    } else if (limitedQuestions.length > 0) {
      const listStr = limitedQuestions.map(q => q.attribute).join(" and ");
      explanation = `Recommended as ${baseDecision}, but this relies heavily on assumptions about ${listStr}. Confirm these to verify fit.`;
    } else {
      explanation = `Recommendation is stable, but based on partial evidence. Overall decision confidence is ${Math.round(overall * 100)}%.`;
    }

    return {
      overall: Math.round(overall * 100) / 100,
      stability: Math.round(stability * 100) / 100,
      limitingDimensions: limitedQuestions,
      explanation,
    };
  }



  private getAdmissibleValuesForDimension(dimension: string): any[] {
    switch (dimension) {
      case "leadershipLevel":
        return ["Director", "VP", "SVP", "EVP", "CEO", "None"];
      case "transformation":
        return ["transformation mandate derived from mandate", "true", "none"];
      case "geography":
        return ["Remote", "Onsite", "Hybrid", "none"];
      case "technologyStack":
        return ["Core", "None"];
      case "functionalScope":
        return ["Full", "Partial", "None"];
      case "budgetOwnership":
        return ["Full", "Shared", "None"];
      case "teamLeadership":
        return ["Direct", "Indirect", "None"];
      case "reportingLine":
        return ["CEO", "CFO", "MD", "None"];
      default:
        return ["true", "false", "none"];
    }
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
    decisionConfidence?: DecisionConfidence;
  }): OpportunityAssessment {
    const now = new Date().toISOString();
    return {
      id: generateUUID(),
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
      decisionConfidence: params.decisionConfidence,
      provenance: {
        schemaVersion: "1.0",
        timestamp: now,
      } as any,
    };
  }
}
