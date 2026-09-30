import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const modelState = vi.hoisted(() => ({
  handler: null as null | ((stage: string, instruction: string, input: any) => Promise<any>),
}));

vi.mock("../../src/pursuit/model", () => ({
  generateWithFallback: async (stage: string, instruction: string, input: any) => {
    if (!modelState.handler) return null;
    return modelState.handler(stage, instruction, input);
  },
}));

import { findSemanticInflation } from "../../src/pursuit/semantic/validate";
import { deriveDeterministicThesis, enrichThesis } from "../../src/pursuit/thesis";
import type { RoleBrief } from "../../src/pursuit/role-brief";
import type { CandidateArchetype, CandidateClaim, StyleProfile } from "../../src/pursuit/types";

const FIXTURES = path.join(__dirname, "../fixtures/pursuit");
const load = <T>(p: string): T =>
  JSON.parse(readFileSync(path.join(FIXTURES, p), "utf-8")) as T;

const claims = load<CandidateClaim[]>("candidate-claims.json");
const archetypes = load<CandidateArchetype[]>("archetypes.json");
const style: StyleProfile = {
  preferredPhrasings: [],
  promotedClaimIds: [],
  rejectedClaimIds: [],
  archetypeOverrides: [],
  observedEditCount: 0,
};

function deterministicFor(brief: RoleBrief) {
  return deriveDeterministicThesis({
    brief,
    claims,
    archetypes,
    style,
    seed: `enrichment-integrity|${brief.jobHash}`,
  });
}

function baseOutput(input: any, objections: any[]) {
  return {
    modelId: "bedrock-mantle:test-model",
    value: {
      targetMandate: input.deterministicDraft.targetMandate,
      winTheme: input.deterministicDraft.winTheme,
      recommendedPositioning: input.deterministicDraft.positioning,
      narrativesToAvoid: ["Do not imply experience that is not in the record."],
      proof: [],
      objections,
    },
  };
}

describe("Pursuit thesis enrichment integrity", () => {
  it("merges reordered model objections by stable objectionId rather than array position", async () => {
    const brief = load<RoleBrief>("globallogic-data-ai/role.json");
    const deterministic = deterministicFor(brief);
    expect(deterministic.objections.length).toBeGreaterThanOrEqual(2);

    modelState.handler = async (_stage, _instruction, input) => {
      const base = input.objectionCandidates.filter((candidate: any) => candidate.source === "DETERMINISTIC");
      const responses = base.map((candidate: any, index: number) => ({
        objectionId: candidate.objectionId,
        objection: candidate.objection,
        counterPosition: `Matched counter ${index + 1}; the gap remains to be tested.`,
        severity: candidate.severity,
        supportingClaimIds: candidate.supportingClaimIds,
      }));
      return baseOutput(input, responses.reverse());
    };

    const enriched = await enrichThesis(deterministic, {
      brief,
      claims,
      archetype: archetypes.find((a) => a.id === deterministic.archetypeId) ?? null,
      style,
    });

    expect(enriched.objections[0]?.counterPosition).toContain("Matched counter 1");
    expect(enriched.objections[1]?.counterPosition).toContain("Matched counter 2");
  });

  it("can add a trusted RoleBrief risk when deterministic objections miss it", async () => {
    const brief = load<RoleBrief>("weber-shandwick-vp-digital/role.json");
    const deterministic = deterministicFor(brief);

    modelState.handler = async (_stage, _instruction, input) => {
      const risk = input.objectionCandidates.find((candidate: any) => candidate.objectionId === "risk:primary");
      expect(risk).toBeTruthy();
      return baseOutput(input, [
        {
          objectionId: risk.objectionId,
          objection: risk.objection,
          counterPosition:
            "Integrated digital and commercial leadership is evidenced, while specialist earned-communications depth remains a gap that must be tested.",
          severity: "MINOR",
          supportingClaimIds: [claims.find((claim) => /\$8M pure agency fee book/i.test(claim.statement))!.id],
        },
      ]);
    };

    const enriched = await enrichThesis(deterministic, {
      brief,
      claims,
      archetype: archetypes.find((a) => a.id === deterministic.archetypeId) ?? null,
      style,
    });

    expect(enriched.objections.some((o) => o.objection === brief.primaryRisk)).toBe(true);
    const added = enriched.objections.find((o) => o.objection === brief.primaryRisk)!;
    expect(added.severity).toBe("MATERIAL");
    expect(added.counterPosition).toMatch(/earned-communications depth remains a gap/i);
  });

  it("rejects projected metrics rewritten as achieved results", () => {
    expect(findSemanticInflation("Secured a ₹36 Cr three-year service retainer.", claims)).toEqual([
      expect.stringMatching(/Projected metric/i),
    ]);
    expect(findSemanticInflation("The record contains a projected ₹36 Cr three-year service retainer.", claims)).toEqual([]);
  });

  it("rejects positive P&L ownership when the ledger has no P&L source fact", () => {
    expect(findSemanticInflation("Owned the P&L while scaling the account.", claims)).toEqual([
      expect.stringMatching(/P&L ownership/i),
    ]);
    expect(findSemanticInflation("Direct P&L ownership is not evidenced in the record.", claims)).toEqual([]);
  });

  it("falls back from semantically inflated model win-theme language", async () => {
    const brief = load<RoleBrief>("antal-managing-partner/role.json");
    const deterministic = deterministicFor(brief);

    modelState.handler = async (_stage, _instruction, input) => ({
      modelId: "bedrock-mantle:test-model",
      value: {
        targetMandate: input.deterministicDraft.targetMandate,
        winTheme: "Secured a ₹36 Cr three-year service retainer and owned the P&L.",
        recommendedPositioning: input.deterministicDraft.positioning,
        narrativesToAvoid: [],
        proof: [],
        objections: [],
      },
    });

    const enriched = await enrichThesis(deterministic, {
      brief,
      claims,
      archetype: archetypes.find((a) => a.id === deterministic.archetypeId) ?? null,
      style,
    });
    expect(enriched.winTheme).toBe(deterministic.winTheme);
  });
});
