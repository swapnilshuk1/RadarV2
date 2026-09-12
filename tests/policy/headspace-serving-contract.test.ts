import { describe, test, expect, beforeAll } from "vitest";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import { serveEvaluation, adaptLegacyEvaluation } from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import type { CanonicalIntrinsicEvaluationPayload } from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import { getRepositories } from "../../src/data/sqlite/provider";

describe("Headspace Serving Contract Regression Suite", () => {
  const userId = "ms6i7e3y-4x0chy5fy";

  beforeAll(async () => {
    const repos = getRepositories();

    // 1. Seed candidate projection with attention window 5
    const { CandidateProjectionBuilderImpl } = await import("../../src/lib/intelligence/builders/CandidateProjectionBuilder");
    const { candidateProfile } = await import("../../src/data/candidate-profile");
    const baseProj = new CandidateProjectionBuilderImpl().fromProfile(candidateProfile);
    await repos.people.saveProjection(userId, {
      ...baseProj,
      attentionWindow: 5,
    });

    // 2. Seed 6 active pursuits to saturate headspace (activePursuits = 6 > attentionWindow = 5)
    for (let i = 1; i <= 6; i++) {
      await repos.decisions.recordUserDecision(userId, `j-active-${i}`, "PURSUE");
    }

    // 3. Seed the two evaluated opportunities
    const jobs = [
      { jobHash: "j-099437e80b44", score: 79 },
      { jobHash: "j-9d2006e16aba", score: 76 },
    ];

    for (const job of jobs) {
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash: job.jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: `fp_${job.jobHash}`,
        engineVerdict: "PURSUE",
        engineQualityScore: job.score,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash: job.jobHash,
          personId: userId,
          evaluationInputHash: `fp_${job.jobHash}`,
          policyVersion: "v4.3",
          ontologyVersion: "v4.0",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "PURSUE",
          intrinsicQualityScore: job.score,
          parsingConfidence: 0.95,
          vetoed: false,
          vetoReason: null,
          triggeredRuleIds: ["R-PURSUE"],
          decisionRisks: [],
          decisionDrivers: [],
          evaluationStatus: "COMPLETE",
          dimensions: [],
          esi: 80,
          diligenceStatus: "VERIFIED",
          baseNarrative: {
            baseRecommendationProse: "Exceptional mandate match.",
          },
          auditTrace: {
            verb0: "PURSUE",
            careerValue: 80,
            shortlistingPotential: 80,
            pursuitFriction: 20,
            rawScore: job.score,
            evidenceMappingCount: 5,
          },
        }),
      });
    }
  });

  test("A. j-099437e80b44: Intrinsic PURSUE (79%) served as PURSUE with saturated Headspace advisory", async () => {
    const opp = await OpportunityService.getForUser(userId, "j-099437e80b44");

    expect(opp).toBeDefined();
    expect(opp!.engineRecommendation).toBeDefined();

    // 1. Intrinsic score and verdict must be preserved
    expect(opp!.engineRecommendation?.qualityScore).toBe(79);
    expect(opp!.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(opp!.engineRecommendation?.verb0).toBe("PURSUE");
    expect(opp!.decision).toBe("PURSUE");
    expect(opp!.effectiveDecision).toBe("ENGINE_PURSUIT");

    // 2. Headspace advisory metadata must be present
    expect(opp!.engineRecommendation?.headspaceVerdict).toBe("CONSIDER");
    expect(opp!.engineRecommendation?.headspaceDowngraded).toBe(true);
    expect(opp!.engineRecommendation?.headspaceReason).toContain("You are at capacity");

    // 3. Presentation badge must reflect intrinsic PURSUE
    expect(opp!.uiBadge.label).toBe("Recommended");
    expect(opp!.uiBadge.variant).toBe("signal");
  });

  test("B. j-9d2006e16aba: Intrinsic PURSUE (76%) served as PURSUE with saturated Headspace advisory", async () => {
    const opp = await OpportunityService.getForUser(userId, "j-9d2006e16aba");

    expect(opp).toBeDefined();
    expect(opp!.engineRecommendation).toBeDefined();

    // 1. Intrinsic score and verdict must be preserved
    expect(opp!.engineRecommendation?.qualityScore).toBe(76);
    expect(opp!.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(opp!.engineRecommendation?.verb0).toBe("PURSUE");
    expect(opp!.decision).toBe("PURSUE");
    expect(opp!.effectiveDecision).toBe("ENGINE_PURSUIT");

    // 2. Headspace advisory metadata must be present
    expect(opp!.engineRecommendation?.headspaceVerdict).toBe("CONSIDER");
    expect(opp!.engineRecommendation?.headspaceDowngraded).toBe(true);
    expect(opp!.engineRecommendation?.headspaceReason).toContain("You are at capacity");

    // 3. Presentation badge must reflect intrinsic PURSUE
    expect(opp!.uiBadge.label).toBe("Recommended");
    expect(opp!.uiBadge.variant).toBe("signal");
  });

  test("C. Genuine intrinsic CONSIDER opportunity remains CONSIDER regardless of Headspace", () => {
    const cachedConsider: CanonicalIntrinsicEvaluationPayload = {
      schemaVersion: "v4.2-intrinsic",
      jobHash: "test-consider-job",
      personId: userId,
      evaluationInputHash: "hash-consider",
      policyVersion: "v4.3",
      ontologyVersion: "v4.0",
      evaluatedAt: new Date().toISOString(),
      intrinsicVerdict: "CONSIDER",
      intrinsicQualityScore: 62,
      parsingConfidence: 0.85,
      vetoed: false,
      vetoReason: null,
      triggeredRuleIds: ["R-CONSIDER"],
      decisionRisks: [],
      decisionDrivers: [],
      evaluationStatus: "COMPLETE",
      dimensions: [],
      esi: 65,
      diligenceStatus: "COMPLETE",
      baseNarrative: {
        baseRecommendationProse: "Verify team scale before advancing.",
      },
      auditTrace: {
        verb0: "CONSIDER",
        careerValue: 60,
        shortlistingPotential: 62,
        pursuitFriction: 20,
        rawScore: 62,
        evidenceMappingCount: 5,
      },
    };

    // Saturated headspace
    const servedSaturated = serveEvaluation(
      cachedConsider,
      { personId: userId, attentionWindow: 5, activePursuits: 10 },
      { jobHash: "test-consider-job", role: "VP Engineering", company: "Acme Corp" },
      null
    );

    expect(servedSaturated.engineRecommendation?.engineVerdict).toBe("CONSIDER");
    expect(servedSaturated.engineRecommendation?.verb0).toBe("CONSIDER");
    expect(servedSaturated.engineRecommendation?.headspaceVerdict).toBe("CONSIDER");
    expect(servedSaturated.engineRecommendation?.headspaceDowngraded).toBe(false);
    expect(servedSaturated.uiBadge.label).toBe("Consider");
    expect(servedSaturated.uiBadge.variant).toBe("caution");
  });

  test("D. Intrinsic PURSUE opportunity with non-saturated Headspace serves PURSUE without downgrade", () => {
    const cachedPursue: CanonicalIntrinsicEvaluationPayload = {
      schemaVersion: "v4.2-intrinsic",
      jobHash: "test-pursue-job",
      personId: userId,
      evaluationInputHash: "hash-pursue",
      policyVersion: "v4.3",
      ontologyVersion: "v4.0",
      evaluatedAt: new Date().toISOString(),
      intrinsicVerdict: "PURSUE",
      intrinsicQualityScore: 88,
      parsingConfidence: 0.9,
      vetoed: false,
      vetoReason: null,
      triggeredRuleIds: ["R-PURSUE-HIGH"],
      decisionRisks: [],
      decisionDrivers: [],
      evaluationStatus: "COMPLETE",
      dimensions: [],
      esi: 85,
      diligenceStatus: "COMPLETE",
      baseNarrative: {
        baseRecommendationProse: "Exceptional mandate fit.",
      },
      auditTrace: {
        verb0: "PURSUE",
        careerValue: 88,
        shortlistingPotential: 90,
        pursuitFriction: 10,
        rawScore: 88,
        evidenceMappingCount: 8,
      },
    };

    // Non-saturated headspace (2 active / 5 capacity)
    const servedUnsaturated = serveEvaluation(
      cachedPursue,
      { personId: userId, attentionWindow: 5, activePursuits: 2 },
      { jobHash: "test-pursue-job", role: "Chief Commercial Officer", company: "GrowthCo" },
      null
    );

    expect(servedUnsaturated.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(servedUnsaturated.engineRecommendation?.verb0).toBe("PURSUE");
    expect(servedUnsaturated.engineRecommendation?.headspaceVerdict).toBe("PURSUE");
    expect(servedUnsaturated.engineRecommendation?.headspaceDowngraded).toBe(false);
    expect(servedUnsaturated.uiBadge.label).toBe("Recommended");
    expect(servedUnsaturated.uiBadge.variant).toBe("signal");
  });

  test("E. adaptLegacyEvaluation follows the exact same contract", () => {
    const legacyOpp = {
      jobHash: "legacy-job-01",
      decision: "PURSUE",
      recommendationResult: { score: 80 },
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 80,
      },
      recommendation: "Strong candidate match.",
    };

    const adapted = adaptLegacyEvaluation(
      legacyOpp,
      { personId: userId, attentionWindow: 5, activePursuits: 20 }, // Saturated
      { jobHash: "legacy-job-01", role: "Managing Director", company: "Legacy Capital" },
      null
    );

    expect(adapted.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(adapted.engineRecommendation?.verb0).toBe("PURSUE");
    expect(adapted.engineRecommendation?.headspaceVerdict).toBe("CONSIDER");
    expect(adapted.engineRecommendation?.headspaceDowngraded).toBe(true);
    expect(adapted.engineRecommendation?.headspaceReason).toContain("You are at capacity");
  });

  test("F. Invariance Verification: DB records and queue eligibility are unchanged", async () => {
    const repos = getRepositories();

    // 1. Verify candidate_evaluations table in Turso Cloud DB directly
    const dbEval1 = await repos.evaluations.getEvaluation(userId, "j-099437e80b44");
    expect(dbEval1).toBeDefined();
    expect(dbEval1?.engineVerdict).toBe("PURSUE");

    // 2. Verify total evaluated and unresolved count
    const list = await OpportunityService.listForUser(userId);
    const totalEvaluated = await repos.evaluations.listEvaluationsForUser(userId);
    const userDecisionsDB = await repos.decisions.getUserDecisions(userId);

    const userDecidedJobHashes = new Set(
      Object.values(userDecisionsDB)
        .filter((d) => d.verb === "PURSUE" || d.verb === "CONSIDER" || d.verb === "PASS")
        .map((d) => d.jobHash)
    );

    const expectedUnresolvedCount = totalEvaluated.filter((e) => !userDecidedJobHashes.has(e.jobHash)).length;

    // List count should equal unresolved evaluated population
    expect(list.length).toBe(expectedUnresolvedCount);
  });
});
