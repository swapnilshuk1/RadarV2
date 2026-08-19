/**
 * tests/candidate-truth-integrity.test.ts
 *
 * RADAR V4 — Candidate Truth-Preservation Adversarial Test Suite (Phase 8.2B Hardened)
 * Covers Cases A through L (and extended T) and verifies fail-closed gate behavior,
 * the Six-State Candidate Truth Taxonomy, and mechanical certification invariants.
 */

import { describe, it, expect } from "vitest";
import { CandidateEvidenceGraph } from "../../src/lib/intelligence/execution/CandidateEvidenceGraph";
import { ExecutionEvidenceGate } from "../../src/lib/intelligence/execution/ExecutionEvidenceGate";
import { TruthPreservingRewriteEngine } from "../../src/lib/intelligence/execution/TruthPreservingRewriteEngine";
import { ExecutionEngine } from "../../src/lib/intelligence/engines/ExecutionEngine";
import candidateProfileData from "../../src/data/candidate-profile.json";
import { JobProjection } from "../../src/domain/job_projection";
import {
  ExecutionPackage,
  isRenderableClassification,
  isBlockedClassification,
  SixStateCandidateTruthClassification
} from "../../src/lib/intelligence/execution/types";

describe("Candidate Truth-Preservation Architecture (Phase 8.2B Hardened)", () => {
  const evidenceGraph = new CandidateEvidenceGraph(candidateProfileData);

  const baseJob: JobProjection = {
    jobHash: "test_job_123",
    company: "SkanAI",
    role: "VP of Marketing",
    trueExecutiveMandate: "TRANSFORMATION",
    operatingLevel: { value: "ENTERPRISE", confidence: 0.9, reasoning: "Enterprise test" },
    workNature: { value: "HYBRID", confidence: 0.9, reasoning: "Hybrid test" },
    decisionAuthority: { value: "FULL_PL", confidence: 0.9, reasoning: "PL test" },
    commercialScope: { value: "GLOBAL", confidence: 0.9, reasoning: "Global test" },
    mandateFit: { score: 85, summary: "Strong fit", confidence: 0.85 },
    capabilities: [{ name: "CRM Transformation" }, { name: "Commercial Growth" }],
    boardExposure: { value: "HIGH", confidence: 0.9, reasoning: "Board test" },
    teamScale: { value: "DIRECT_50_PLUS", confidence: 0.9, reasoning: "Scale test" },
    location: "Bengaluru",
    workModel: "HYBRID"
  };

  // Case A: Unsupported Current Title (Title Inflation)
  it("Case A: Intercepts unsupported inflated title (Executive Vice President)", () => {
    expect(evidenceGraph.isVerifiedTitle("Vice President")).toBe(true);
    expect(evidenceGraph.isVerifiedTitle("VP")).toBe(true);
    expect(evidenceGraph.isVerifiedTitle("Executive Vice President")).toBe(false);
    expect(evidenceGraph.isVerifiedTitle("EVP")).toBe(false);

    const headline = "Executive Vice President | Commercial Scale & Enterprise Transformation";
    const violation = ExecutionEvidenceGate.auditCandidateAssertion(headline, "SkanAI", evidenceGraph);
    expect(violation).not.toBeNull();
    expect(violation?.type).toBe("TITLE_INFLATION");
    expect(violation?.token).toContain("Executive Vice President");
  });

  // Case B: Unsupported Executive Title (CMO / Managing Director)
  it("Case B: Intercepts unsupported executive title (CMO / Managing Director)", () => {
    expect(evidenceGraph.isVerifiedTitle("Chief Marketing Officer")).toBe(false);
    expect(evidenceGraph.isVerifiedTitle("CMO")).toBe(false);
    expect(evidenceGraph.isVerifiedTitle("Managing Director")).toBe(false);

    const cmoHeadline = "Chief Marketing Officer | Enterprise Growth";
    const violation = ExecutionEvidenceGate.auditCandidateAssertion(cmoHeadline, "SkanAI", evidenceGraph);
    expect(violation).not.toBeNull();
    expect(violation?.type).toBe("TITLE_INFLATION");
  });

  // Case C: Unsupported Capability
  it("Case C: Flags unverified capability assertions", () => {
    expect(evidenceGraph.isVerifiedCapability("CRM")).toBe(true);
    expect(evidenceGraph.isVerifiedCapability("Salesforce")).toBe(true);
    expect(evidenceGraph.isVerifiedCapability("Performance Marketing")).toBe(true);
    expect(evidenceGraph.isVerifiedCapability("Bioinformatics Pipeline")).toBe(false);
    expect(evidenceGraph.isVerifiedCapability("Quantum Cryptography")).toBe(false);
  });

  // Case D: Unsupported Employer Association
  it("Case D: Blocks unverified employer association (Ex-SkanAI, Ex-Google)", () => {
    expect(evidenceGraph.isVerifiedEmployer("Ford")).toBe(true);
    expect(evidenceGraph.isVerifiedEmployer("BMW")).toBe(true);
    expect(evidenceGraph.isVerifiedEmployer("TVS Motor Company")).toBe(true);
    expect(evidenceGraph.isVerifiedEmployer("SkanAI")).toBe(false);
    expect(evidenceGraph.isVerifiedEmployer("Google")).toBe(false);

    const leak = "Spearheaded enterprise transformation roadmap at SkanAI";
    const violation = ExecutionEvidenceGate.auditCandidateAssertion(leak, "SkanAI", evidenceGraph);
    expect(violation).not.toBeNull();
    expect(violation?.type).toBe("TARGET_EMPLOYER_LEAK");
  });

  // Case E: Unsupported Scale
  it("Case E: Intercepts unverified scale ($100M ARR, 500-member team)", () => {
    expect(evidenceGraph.isVerifiedMetric("40-member")).toBe(true);
    expect(evidenceGraph.isVerifiedMetric("13")).toBe(true);
    expect(evidenceGraph.isVerifiedMetric("500-member")).toBe(false);
    expect(evidenceGraph.isVerifiedMetric("$100M")).toBe(false);
  });

  // Case F: Unsupported P&L ($50M P&L / $12M+ budget)
  it("Case F: Blocks unsupported $50M P&L or $12M+ budget claims", () => {
    expect(evidenceGraph.isVerifiedMetric("$8M")).toBe(true);
    expect(evidenceGraph.isVerifiedMetric("₹36 Cr")).toBe(true);
    expect(evidenceGraph.isVerifiedMetric("$12M+")).toBe(false);
    expect(evidenceGraph.isVerifiedMetric("$50M")).toBe(false);

    const unverifiedPl = "Held full enterprise P&L responsibility ($12M+ annual budget).";
    const violation = ExecutionEvidenceGate.auditCandidateAssertion(unverifiedPl, "SkanAI", evidenceGraph);
    expect(violation).not.toBeNull();
    expect(violation?.type).toBe("FABRICATED_METRIC");
  });

  // Case G: Unsupported Technology Experience
  it("Case G: Blocks unverified technology experience outside candidate evidence", () => {
    expect(evidenceGraph.isVerifiedCapability("Salesforce")).toBe(true);
    expect(evidenceGraph.isVerifiedCapability("CDP")).toBe(true);
    expect(evidenceGraph.isVerifiedCapability("Kubernetes Cluster Admin")).toBe(false);
  });

  // Case H: Candidate Assertion Detector Contract
  it("Case H: Deterministic candidate assertion detector identifies factual claims", () => {
    // True candidate assertions
    expect(evidenceGraph.isCandidateAssertion("I led enterprise transformation programs")).toBe(true);
    expect(evidenceGraph.isCandidateAssertion("Over the past two decades, my focus has been on scaling")).toBe(true);
    expect(evidenceGraph.isCandidateAssertion("Managed an $8M commercial portfolio at Ford")).toBe(true);
    expect(evidenceGraph.isCandidateAssertion("Built and scaled a 40-member Performance CoE")).toBe(true);
    expect(evidenceGraph.isCandidateAssertion("Spearheaded GTM operations")).toBe(true);

    // Safe generic positioning (No candidate-specific factual assertions)
    expect(evidenceGraph.isCandidateAssertion("What is the primary reporting line and P&L mandate for this executive role at SkanAI?")).toBe(false);
    expect(evidenceGraph.isCandidateAssertion("In your view, what is the single biggest operational bottleneck standing between SkanAI and its 24-month targets?")).toBe(false);
  });

  // Case I: Generic Positioning That Is Safe
  it("Case I: Generic panel question contains no candidate assertion and is renderable", () => {
    const safeQuestion = "What explicit success metrics determine the first 12-month performance review for transformation?";
    expect(evidenceGraph.isCandidateAssertion(safeQuestion)).toBe(false);
    expect(isRenderableClassification("SAFE_GENERIC_POSITIONING")).toBe(true);
  });

  // Case J: Evidence-Backed Synthesis That Is Safe
  it("Case J: Evidence-backed rewrite includes candidate evidence IDs and verbatim quotes", () => {
    const pkgResult = TruthPreservingRewriteEngine.generateExecutionPackage(evidenceGraph, baseJob);
    expect(pkgResult.renderedUnsafeCount).toBe(0);
    expect(pkgResult.unsupportedInferenceRendered).toBe(0);

    const rewrites = pkgResult.package.resumeGaps.filter(g => g.suggestionType === "TRUTH_PRESERVING_REWRITE");
    expect(rewrites.length).toBeGreaterThan(0);
    rewrites.forEach(r => {
      expect(r.candidateEvidenceIds.length).toBeGreaterThan(0);
      expect(r.candidateEvidenceQuotes.length).toBeGreaterThan(0);
      expect(r.suggestedRevision).not.toContain("SkanAI");
      expect(r.suggestedRevision).not.toContain("$12M");
    });
  });

  // Case K: Explicit Evidence-Gap Coaching
  it("Case K: When evidence is absent, generates clean Evidence-Gap Coaching", () => {
    const emptyGraph = new CandidateEvidenceGraph({
      identity: { name: "Candidate", currentTitle: "Vice President" },
      evidence: [],
      experience: { achievements: [] }
    });

    const pkgResult = TruthPreservingRewriteEngine.generateExecutionPackage(emptyGraph, baseJob);
    expect(pkgResult.renderedUnsafeCount).toBe(0);
    expect(pkgResult.package.resumeGaps.every(g => g.suggestionType === "EVIDENCE_GAP_COACHING")).toBe(true);
    pkgResult.package.resumeGaps.forEach(g => {
      expect(g.coachingGuidance).toContain("Evidence Gap Advisory");
    });
  });

  // Case L: Target Company Contextual Reference (Role Inquiry vs Candidate Assertion)
  it("Case L: Target company reference in role inquiries is permitted, but forbidden in candidate history", () => {
    // In role inquiry / panel question: Allowed
    const panelQuestion = `"In your view, what is the single biggest operational bottleneck currently standing between SkanAI and its 24-month transformation targets?"`;
    expect(ExecutionEvidenceGate.containsUnverifiedEmployerAssertion(panelQuestion, "SkanAI", evidenceGraph)).toBe(false);

    // In candidate history: Strictly blocked
    const candidateHistoryClaim = `Spearheaded enterprise transformation roadmap at SkanAI`;
    expect(ExecutionEvidenceGate.containsUnverifiedEmployerAssertion(candidateHistoryClaim, "SkanAI", evidenceGraph)).toBe(true);
  });

  // Six-State Taxonomy Invariants
  it("Taxonomy: Enforces strict renderable vs blocked classification boundaries", () => {
    const renderableStates: SixStateCandidateTruthClassification[] = [
      "EVIDENCE_BACKED_REFRAMING",
      "EVIDENCE_BACKED_EMPHASIS",
      "SAFE_GENERIC_POSITIONING",
      "EVIDENCE_GAP_COACHING"
    ];
    const blockedStates: SixStateCandidateTruthClassification[] = [
      "UNSUPPORTED_INFERENCE",
      "FABRICATED_ASSERTION"
    ];

    renderableStates.forEach(s => {
      expect(isRenderableClassification(s)).toBe(true);
      expect(isBlockedClassification(s)).toBe(false);
    });

    blockedStates.forEach(s => {
      expect(isRenderableClassification(s)).toBe(false);
      expect(isBlockedClassification(s)).toBe(true);
    });
  });

  // Complete Fail-Closed Execution Package Test
  it("Fail-Closed Gate: Intercepts all unsafe synthetic claims and guarantees 0 rendered unsafe", () => {
    const unsafePkg: ExecutionPackage = {
      recommendationConditions: ["Condition"],
      screeningQuestions: [{ question: "Q", whyItMatters: "M" }],
      resumeGaps: [
        {
          category: "Commercial Scope",
          currentNarrative: "Narrative",
          targetRoleRequirement: "Requirement",
          suggestionType: "TRUTH_PRESERVING_REWRITE",
          suggestedRevision: "Managed an unverified $45M budget at SkanAI.",
          candidateEvidenceIds: ["cand_ach_1"],
          candidateEvidenceQuotes: ["Managed an $8M Ford commercial portfolio"],
          jdRequirementIds: ["jd_req_1"],
          targetEmployerLeak: false,
          unverifiedMetrics: [],
          fabricationRisk: "ZERO"
        }
      ],
      linkedInStrategy: {
        recommendedHeadline: "Executive Vice President | Ex-SkanAI Trajectory",
        executiveAboutFraming: "About framing.",
        provenance: {
          groundedInCandidateAchievements: true,
          verifiedEmployerList: ["Ford"],
          verifiedMetricsUsed: [],
          authoritativeTitleUsed: "Vice President"
        }
      },
      interviewPrep: {
        openingHook: "Hook",
        keyThemeToEmphasize: "Theme",
        panelQuestion: "Panel Q",
        prepDistinction: { candidateProofPoint: "Proof", targetRoleBoundaryToClarify: "Boundary" }
      },
      integrityValidation: {
        isTruthPreserving: true,
        targetEmployerLeakageCount: 0,
        fabricatedMetricCount: 0,
        fabricatedEmployerAssociationCount: 0,
        jdAsPastExperienceCount: 0,
        jdAsCandidateOwnershipCount: 0,
        unsupportedHighRiskVerbsCount: 0,
        unsupportedInferenceRendered: 0,
        ungroundedCandidateAssertionsRendered: 0,
        interceptedAndCoachedCount: 0,
        fabricationRisk: "ZERO"
      }
    };

    const gateResult = ExecutionEvidenceGate.validateAndEnforce(unsafePkg, evidenceGraph, {
      jobHash: "test_job_123",
      company: "SkanAI"
    });

    expect(gateResult.generatedUnsafeCount).toBeGreaterThan(0);
    expect(gateResult.interceptedUnsafeCount).toBe(gateResult.generatedUnsafeCount);
    expect(gateResult.renderedUnsafeCount).toBe(0);
    expect(gateResult.unsupportedInferenceRendered).toBe(0);
    expect(gateResult.ungroundedCandidateAssertionsRendered).toBe(0);
    expect(gateResult.package.resumeGaps[0].suggestionType).toBe("EVIDENCE_GAP_COACHING");
    expect(gateResult.package.linkedInStrategy.recommendedHeadline).not.toContain("Executive Vice President");
    expect(gateResult.package.linkedInStrategy.recommendedHeadline).not.toContain("SkanAI");
  });
});
