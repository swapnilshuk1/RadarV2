import { describe, expect, it } from "vitest";
import { InvariantAssertions } from "@/lib/intelligence/evaluation/InvariantAssertions";
import type { RecommendationRecord } from "@/lib/intelligence/record";

const baseRecord = {
  jobHash: "job-1",
  engineVersion: "1",
  recommendationVersion: "1",
  verb: "CONSIDER",
  qualityScore: 70,
  priority: 70,
  decisionSummary: { careerValue: 1, shortlistingPotential: 1, pursuitFriction: 1 },
  decisionDrivers: [],
  decisionRisks: [],
  confidences: { parsing: 1, matching: 1, recommendation: 1 },
  stability: {} as RecommendationRecord["stability"],
  headspace: {} as RecommendationRecord["headspace"],
  comparison: {} as RecommendationRecord["comparison"],
  explanation: {} as RecommendationRecord["explanation"],
  trace: {} as RecommendationRecord["trace"],
} as RecommendationRecord;

describe("Canonical invariant assertions", () => {
  it("fails closed when required gates are absent", () => {
    expect(InvariantAssertions.verifyExecutionGate(baseRecord).passed).toBe(false);
    expect(InvariantAssertions.verifyCompatibilityGate(baseRecord).passed).toBe(false);
  });

  it("fails closed when evaluated records lack presentation", () => {
    expect(InvariantAssertions.verifyEditorialPresence(baseRecord).passed).toBe(false);
  });

  it("accepts a sparse record without a presentation payload", () => {
    const sparse = { ...baseRecord, verb: "SPARSE_SPEC" } as RecommendationRecord;
    expect(InvariantAssertions.verifyEditorialPresence(sparse).passed).toBe(true);
  });
});
