import { describe, it, expect } from "vitest";
import {
  isCanonicalIntrinsicEvaluation,
  serveEvaluation,
  CanonicalIntrinsicEvaluationPayload,
} from "../../src/lib/intelligence/serving/EvaluationServingEngine";

describe("EvaluationServingEngine Read Routing", () => {
  const dummyCandCtx = { personId: "p1", attentionWindow: 5, activePursuits: 1 };
  const dummyOppCtx = { jobHash: "job_123", role: "CEO" };

  it("identifies and serves canonical v4.2-intrinsic payload", () => {
    const payload: CanonicalIntrinsicEvaluationPayload = {
      schemaVersion: "v4.2-intrinsic",
      jobHash: "job_123",
      intrinsicVerdict: "CONSIDER",
      intrinsicQualityScore: 85,
      dimensions: [],
      baseNarrative: {
        whyNow: "Expansion mode",
        positioning: ["Strong leader"],
        primaryProof: "Proven track record",
        baseRecommendationProse: "Consider candidate",
      },
      decisionRisks: [],
      decisionDrivers: [],
      vetoed: false,
    };

    expect(isCanonicalIntrinsicEvaluation(payload)).toBe(true);
    const opp = serveEvaluation(payload, dummyCandCtx, dummyOppCtx, null);
    expect(opp.engineRecommendation.engineVerdict).toBe("CONSIDER");
    expect(opp.engineRecommendation.qualityScore).toBe(85);
  });

  it("rejects unknown or invalid structures from isCanonicalIntrinsicEvaluation", () => {
    expect(isCanonicalIntrinsicEvaluation(null)).toBe(false);
    expect(isCanonicalIntrinsicEvaluation({})).toBe(false);
    expect(isCanonicalIntrinsicEvaluation({ schemaVersion: "v5-future" })).toBe(false);
    expect(
      isCanonicalIntrinsicEvaluation({
        schemaVersion: "v4.2-intrinsic",
        jobHash: "job_123",
        // missing intrinsicVerdict and baseNarrative
      })
    ).toBe(false);
  });
});
