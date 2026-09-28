import { bindMemoReferences } from "../../src/dossier/bound-memo-schema";
import { describe, it, expect } from "vitest";
import { dossier, stagedEvaluation } from "../fixtures/staged-rich-dossier";
import {
  assertMemoIntegrity,
  validateMemoPlan,
  validateTargetedPlanRepair,
} from "../../src/dossier/memo-integrity";
import { assertFactualReviewProvenance } from "../../src/dossier/factual-review-integrity";

describe("executive memo coverage", () => {
  it("constrains reference fields to the supplied catalog without constraining prose", () => {
    const schema: any = {
      properties: {
        text: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
      },
    };
    const bounded: any = bindMemoReferences(schema, {
      claimIds: ["JD-1"],
      requirementIds: [],
      resolutionFields: [],
    });
    expect(bounded.properties.evidenceRefs.items.enum).toEqual(["JD-1"]);
    expect(bounded.properties.text).toEqual({ type: "string" });
    expect(schema.properties.evidenceRefs.items.enum).toBeUndefined();
  });
  it("requires every mapped requirement to survive as a fit row", () => {
    const value = dossier();
    value.candidateFit[0].requirementIds = ["invented"];
    expect(() => assertMemoIntegrity(value)).toThrow("MEMO_FIT_COVERAGE_INVALID");
  });
  it("retains distinct precedents without inventing a requirement association", () => {
    const value = dossier();
    value.candidateFit.push({
      label: "Related precedent",
      requirementIds: [],
      assessment: {
        ...value.candidateFit[0].assessment,
        text: "Establish your operating ownership.",
      },
    });
    expect(() => assertMemoIntegrity(value)).not.toThrow();
  });
  it("binds the visible scope table to the immutable decision trace", () => {
    const value = structuredClone(dossier());
    value.resolutions = structuredClone(value.resolutions);
    value.resolutions[0].question = "An altered authority question";
    expect(() => assertMemoIntegrity(value)).toThrow("MEMO_SCOPE_TRACE_MISMATCH");
  });
  it("rejects a semantic fit signal changed independently of its canonical mapping", () => {
    const value = dossier();
    value.verdict.requirements[0].status = "DIRECT";
    expect(() => assertMemoIntegrity(value)).toThrow("MEMO_MAPPING_TRACE_MISMATCH");
  });
  it("requires decision hinges in the writing plan and resulting conditions", () => {
    const value = dossier();
    value.narrativePlan.memoPoints = value.narrativePlan.memoPoints!.filter(
      (p) => p.section !== "decisionConditions",
    );
    expect(() =>
      validateMemoPlan(
        { claims: value.evidence.roleClaims, narrativePlan: value.narrativePlan },
        stagedEvaluation,
      ),
    ).toThrow("MEMO_PLAN_DECISION_COVERAGE");
    const missing = dossier();
    missing.decisionConditions[0].requirementIds = [];
    expect(() => assertMemoIntegrity(missing)).toThrow("MEMO_CONDITION_COVERAGE_INVALID");
  });
  it("rejects a targeted plan repair that rewrites existing point semantics", () => {
    const previous = structuredClone(dossier().narrativePlan);
    const next = structuredClone(previous);
    next.memoPoints![0].point = "A rewritten point that was not part of the repair target.";
    expect(() =>
      validateTargetedPlanRepair(previous, next, {
        sections: [next.memoPoints![0].section],
        requirementIds: [],
        resolutionFields: [],
      }),
    ).toThrow("MEMO_PLAN_REPAIR_REWROTE_POINT");
  });
  it("rejects a targeted plan repair that adds an unrelated reference", () => {
    const previous = structuredClone(dossier().narrativePlan);
    const next = structuredClone(previous);
    next.memoPoints![0].resolutionFields.push("unrequested-field");
    expect(() =>
      validateTargetedPlanRepair(previous, next, {
        sections: [next.memoPoints![0].section],
        requirementIds: [],
        resolutionFields: [],
      }),
    ).toThrow("MEMO_PLAN_REPAIR_ADDED_UNREQUESTED_FIELD");
  });
  it("allows a new targeted repair point to reuse already validated references", () => {
    const previous = structuredClone(dossier().narrativePlan);
    const existingRequirement = previous.memoPoints!
      .flatMap((point) => point.requirementIds)
      .find(Boolean)!;
    const next = structuredClone(previous);
    next.memoPoints!.push({
      id: "repair-company-size",
      section: "decisionConditions",
      point: "Clarify company size before deciding.",
      claimIds: [],
      requirementIds: [existingRequirement],
      resolutionFields: ["companySize"],
    });
    expect(() =>
      validateTargetedPlanRepair(previous, next, {
        sections: ["decisionConditions"],
        requirementIds: [],
        resolutionFields: ["companySize"],
      }),
    ).not.toThrow();
  });
  it("allows a targeted new point to use another canonical requirement while adding the requested field", () => {
    const previous = structuredClone(dossier().narrativePlan);
    const next = structuredClone(previous);
    next.memoPoints!.push({
      id: "repair-company-size",
      section: "decisionConditions",
      point: "Resolve company scale before treating the mandate as equivalent scope.",
      claimIds: ["JD-1-1"],
      requirementIds: ["REQ-002"],
      resolutionFields: ["companySize"],
    });
    expect(() =>
      validateTargetedPlanRepair(previous, next, {
        sections: ["decisionConditions"],
        requirementIds: [],
        resolutionFields: ["companySize"],
        allowedRequirementIds: ["REQ-001", "REQ-002"],
        allowedResolutionFields: ["companySize"],
      }),
    ).not.toThrow();

    const invalid = structuredClone(next);
    invalid.memoPoints![invalid.memoPoints!.length - 1].requirementIds = ["REQ-NOT-CANONICAL"];
    expect(() =>
      validateTargetedPlanRepair(previous, invalid, {
        sections: ["decisionConditions"],
        requirementIds: [],
        resolutionFields: ["companySize"],
        allowedRequirementIds: ["REQ-001", "REQ-002"],
        allowedResolutionFields: ["companySize"],
      }),
    ).toThrow("MEMO_PLAN_REPAIR_NEW_POINT_UNREQUESTED_REQUIREMENT");
  });

  it("rejects a plan altered after factual and editorial review", () => {
    const value = dossier();
    value.narrativePlan.memoPoints![0].point = "A different argument";
    expect(() => assertFactualReviewProvenance(value)).toThrow("MEMO_COVERAGE_REVIEW_REQUIRED");
  });
});
