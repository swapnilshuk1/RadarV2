import { describe, expect, it } from "vitest";
import type { EditorialIntelligenceContract } from "@/lib/intelligence/editorial/EditorialIntelligenceContract";
import {
  composeEditorialIntelligenceV2,
  determineEditorialCompositionMode,
} from "@/lib/intelligence/editorial/EditorialPropositionComposer";

function contract(overrides: Partial<EditorialIntelligenceContract> = {}): EditorialIntelligenceContract {
  return {
    version: "editorial-intelligence-v2",
    verdict: "PURSUE",
    qualityScore: 72,
    careerCase: null,
    principalRisk: null,
    careerTradeoff: null,
    whyNow: null,
    capabilityMatches: [],
    candidateCapabilities: [{
      capability: "CRM and retention operations",
      statement: "Built lifecycle CRM programs that improved retention across consumer portfolios.",
      confidence: 0.91,
      evidenceIds: ["candidate:crm"],
      provenance: "CANDIDATE_FACT",
      capabilityKeys: ["crm", "retention"],
    }],
    candidateFitEvidence: [],
    candidatePrecedents: [{
      capability: "CRM and retention operations",
      statement: "Built lifecycle CRM programs that improved retention across consumer portfolios.",
      evidenceIds: ["candidate:crm"],
      confidence: 0.91,
      provenance: "CANDIDATE_FACT",
    }],
    publishedRoleWork: [{
      kind: "RESPONSIBILITY",
      statement: "Own lifecycle retention and CRM execution across priority customer segments.",
      sourceEvidenceId: "role:lifecycle",
      capabilityKeys: ["crm", "lifecycle"],
    }, {
      kind: "OUTCOME",
      statement: "Improve retention outcomes through disciplined lifecycle measurement.",
      sourceEvidenceId: "role:retention-outcome",
      capabilityKeys: ["retention", "measurement"],
    }],
    roleContext: [{
      kind: "ROLE_CONTEXT",
      statement: "Reports to the Chief Growth Officer.",
      sourceEvidenceId: "role:context",
      capabilityKeys: [],
    }],
    qualificationRequirements: [{
      capability: "CRM",
      statement: "Strong experience with CRM, lifecycle measurement, and retention strategy.",
      materiality: "CORE",
      sourceEvidenceIds: ["qualification:crm"],
    }],
    canonicalSignals: [{
      id: "signal:verdict",
      kind: "VERDICT",
      value: "PURSUE",
      provenance: "CANONICAL_EVALUATION",
    }, {
      id: "signal:scope",
      kind: "COMMERCIAL_SCOPE",
      value: "Commercial ownership is evaluated at enterprise scope.",
      provenance: "CANONICAL_EVALUATION",
    }],
    decisionDrivers: {
      strengths: [],
      constraints: [],
      unknowns: [],
      hinges: [],
      availability: "SCALAR_ONLY",
    },
    synthesisInputs: [],
    publishedRoleOutcomes: [],
    decisionHinges: [],
    positioningAngles: [],
    recommendedAction: null,
    provenance: [],
    ...overrides,
  };
}

describe("EditorialPropositionComposer", () => {
  it("keeps employer facts, candidate facts, canonical facts, and RADAR inferences provenance-distinct", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      candidateFitEvidence: [{
        id: "trace:crm",
        candidateEvidenceIds: ["candidate:crm"],
        jobEvidenceIds: ["role:lifecycle"],
        jobEvidence: [{ id: "role:lifecycle", statement: "Own lifecycle retention and CRM execution across priority customer segments.", kind: "ROLE_WORK" }],
        canonicalSignalId: "signal:scope",
        candidateCapabilityKey: "CRM",
        jobCapabilityKey: "CRM",
        relationship: "MATCH",
      }],
    }));
    const employer = composed.propositions.find((item) => item.kind === "EMPLOYER_FACT" && item.text.includes("lifecycle retention"));
    const candidate = composed.propositions.find((item) => item.kind === "CANDIDATE_FACT" && item.text.includes("Built lifecycle CRM"));
    const inference = composed.propositions.find((item) => item.kind === "RADAR_INFERENCE" && item.text.includes("Position"));

    expect(employer?.roleEvidenceIds).toEqual(["role:lifecycle"]);
    expect(employer?.candidateEvidenceIds).toEqual([]);
    expect(candidate?.candidateEvidenceIds).toEqual(["candidate:crm"]);
    expect(candidate?.roleEvidenceIds).toEqual([]);
    expect(inference?.roleEvidenceIds).toEqual(["role:lifecycle"]);
    expect(inference?.candidateEvidenceIds).toEqual(["candidate:crm"]);
  });

  it("does not fabricate a historical score explanation for SCALAR_ONLY evaluations", () => {
    const composed = composeEditorialIntelligenceV2(contract());
    const rendered = JSON.stringify(composed);

    expect(rendered).not.toMatch(/score is|awarded|because capability/i);
    expect(composed.coverage.scalarOnly).toBe(true);
    expect(composed.sections.hero.propositions[0]?.kind).toBe("RADAR_INFERENCE");
    expect(composed.sections.hero.propositions[0]?.roleEvidenceIds).toContain("role:lifecycle");
  });

  it("builds positioning as a recommendation from independently grounded facts rather than candidate proof of employer work", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      candidateFitEvidence: [{
        id: "trace:crm",
        candidateEvidenceIds: ["candidate:crm"],
        jobEvidenceIds: ["role:lifecycle"],
        jobEvidence: [{ id: "role:lifecycle", statement: "Own lifecycle retention and CRM execution across priority customer segments.", kind: "ROLE_WORK" }],
        canonicalSignalId: "signal:scope",
        candidateCapabilityKey: "CRM",
        jobCapabilityKey: "CRM",
        relationship: "MATCH",
      }],
    }));
    const candidateFact = composed.sections.candidatePositioning.propositions[0];
    const positioning = composed.sections.howToWin.propositions[0];

    expect(candidateFact?.kind).toBe("CANDIDATE_FACT");
    expect(candidateFact?.roleEvidenceIds).toEqual([]);
    expect(positioning?.kind).toBe("RADAR_INFERENCE");
    expect(positioning?.text).toMatch(/Position .* evaluator-linked/i);
    expect(positioning?.text).toMatch(/Confirm the employer's required scope/i);
    expect(positioning?.roleEvidenceIds).toContain("role:lifecycle");
    expect(positioning?.candidateEvidenceIds).toContain("candidate:crm");
    expect(composed.positioningRelations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "EVALUATOR_RELATION", basis: "CANONICAL_EVALUATION" }),
    ]));
    expect(positioning?.text).not.toMatch(/proves|direct match|establishes the employer/i);
  });

  it("keeps qualification requirements separate from published role work", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      publishedRoleWork: [],
      candidatePrecedents: [],
      candidateCapabilities: [],
    }));

    expect(composed.sections.mandate.propositions.map((item) => item.text)).toContain(
      "Strong experience with CRM, lifecycle measurement, and retention strategy.",
    );
    expect(composed.sections.mandate.propositions.every((item) => item.kind === "EMPLOYER_FACT")).toBe(true);
    expect(composed.sections.hero.propositions[0]).toEqual(expect.objectContaining({
      kind: "RADAR_INFERENCE",
      roleEvidenceIds: ["qualification:crm"],
    }));
    expect(composed.sections.bottomLine.propositions[0]).toEqual(expect.objectContaining({
      kind: "RADAR_INFERENCE",
      roleEvidenceIds: ["qualification:crm"],
    }));
    expect(composed.sections.bottomLine.propositions[0]?.text).toMatch(/screening bar|role requirements/i);
    expect(composed.sections.bottomLine.propositions[0]?.text).not.toMatch(/owns|responsibilit/i);
  });

  it("uses role context substantively without inventing an operating mandate", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      publishedRoleWork: [],
      qualificationRequirements: [],
      roleContext: [{
        kind: "ROLE_CONTEXT",
        statement: "Reports to the regional CEO.",
        sourceEvidenceId: "context:reports-to",
        capabilityKeys: [],
      }],
      candidateCapabilities: [],
      candidatePrecedents: [],
    }));

    expect(composed.sections.hero.propositions[0]).toEqual(expect.objectContaining({
      kind: "RADAR_INFERENCE",
      roleEvidenceIds: ["context:reports-to"],
    }));
    expect(composed.sections.bottomLine.propositions[0]).toEqual(expect.objectContaining({
      kind: "RADAR_INFERENCE",
      roleEvidenceIds: ["context:reports-to"],
    }));
    expect(composed.sections.hero.headline).toMatch(/limited concrete ownership/i);
    expect(composed.sections.hero.headline).not.toMatch(/owns|mandate is/i);
  });

  it("uses evidence limitation only after work, qualifications, context, and trace evidence are exhausted", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      publishedRoleWork: [],
      qualificationRequirements: [],
      roleContext: [],
      candidateCapabilities: [],
      candidatePrecedents: [],
      candidateFitEvidence: [],
      canonicalSignals: [],
    }));

    expect(composed.sections.hero.propositions[0]?.kind).toBe("EVIDENCE_LIMITATION");
    expect(composed.sections.bottomLine.propositions[0]?.kind).toBe("EVIDENCE_LIMITATION");
  });

  it("uses role-sensitive evidence rather than company or title branches", () => {
    const commercial = contract({
      publishedRoleWork: [{
        kind: "RESPONSIBILITY",
        statement: "Own growth P&L, revenue forecasts, pricing, and unit economics.",
        sourceEvidenceId: "role:pnl",
        capabilityKeys: ["pnl", "revenue"],
      }],
    });
    const operating = contract({
      publishedRoleWork: [{
        kind: "RESPONSIBILITY",
        statement: "Manage vendor performance, service delivery, and corrective actions.",
        sourceEvidenceId: "role:vendor",
        capabilityKeys: ["vendor", "service-delivery"],
      }],
      qualificationRequirements: [],
    });

    expect(determineEditorialCompositionMode(commercial)).toBe("COMMERCIAL_LEADERSHIP");
    expect(determineEditorialCompositionMode(operating)).toBe("OPERATING_LEADERSHIP");
    expect(composeEditorialIntelligenceV2(commercial).sections.hero.headline).toMatch(/commercially accountable/i);
    expect(composeEditorialIntelligenceV2(operating).sections.hero.headline).toMatch(/operating mandate/i);
  });

  it("is useful but evidence-limited when employer work, requirements, and context are absent", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      publishedRoleWork: [],
      qualificationRequirements: [],
      roleContext: [],
      candidatePrecedents: [],
      candidateCapabilities: [],
      canonicalSignals: [{
        id: "signal:verdict",
        kind: "VERDICT",
        value: "CONSIDER",
        provenance: "CANONICAL_EVALUATION",
      }],
    }));

    expect(composed.compositionMode).toBe("SPARSE_AMBIGUOUS");
    expect(composed.sections.bottomLine.propositions[0]?.kind).toBe("EVIDENCE_LIMITATION");
    expect(JSON.stringify(composed)).not.toMatch(/Strong match|Relevant leadership experience|portfolio story/i);
  });

  it("does not turn a global candidate capability inventory into role positioning without a structured relationship", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      candidatePrecedents: [],
      candidateCapabilities: [{
        capability: "Performance Marketing",
        statement: "Built performance marketing operations across consumer accounts.",
        confidence: 0.94,
        evidenceIds: ["candidate:performance"],
        provenance: "CANDIDATE_FACT",
        capabilityKeys: ["performance-marketing"],
      }],
      publishedRoleWork: [{
        kind: "RESPONSIBILITY",
        statement: "Manage vendor performance, corrective actions, QBRs, and service-delivery escalations.",
        sourceEvidenceId: "role:vendor",
        capabilityKeys: ["vendor-management", "service-delivery"],
      }],
    }));

    expect(composed.sections.candidatePositioning.propositions).toEqual([]);
    expect(composed.sections.howToWin.propositions[0]?.text).toMatch(/Lead the conversation with the published mandate/i);
    expect(JSON.stringify(composed)).not.toMatch(/Performance Marketing as relevant operating evidence/i);
  });

  it("uses only trace-linked candidate facts in Why this reached your desk", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      candidateFitEvidence: [{
        id: "trace:crm", candidateEvidenceIds: ["candidate:crm"], jobEvidenceIds: ["role:lifecycle"],
        jobEvidence: [{ id: "role:lifecycle", statement: "Own lifecycle retention and CRM execution across priority customer segments.", kind: "ROLE_WORK" }],
        candidateCapabilityKey: "CRM", jobCapabilityKey: "CRM", relationship: "MATCH",
      }],
      candidatePrecedents: [{
        capability: "Unrelated sales", statement: "Ran unrelated sales operations.", evidenceIds: ["candidate:sales"], confidence: 0.9, provenance: "CANDIDATE_FACT",
      }],
    }));
    const rendered = JSON.stringify(composed.sections.candidatePositioning);
    expect(rendered).toContain("Built lifecycle CRM");
    expect(rendered).not.toContain("Ran unrelated sales operations");
  });

  it("selects one strongest resolved endpoint without fanning a trace into multiple employer relationships", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      candidateFitEvidence: [{
        id: "trace:two-work-items", candidateEvidenceIds: ["candidate:crm"],
        jobEvidenceIds: ["role:lifecycle", "role:retention-outcome"],
        jobEvidence: [
          { id: "role:lifecycle", statement: "Own lifecycle retention and CRM execution across priority customer segments.", kind: "ROLE_WORK" },
          { id: "role:retention-outcome", statement: "Improve retention outcomes through disciplined lifecycle measurement.", kind: "ROLE_WORK" },
        ], candidateCapabilityKey: "CRM", jobCapabilityKey: "CRM", relationship: "MATCH",
      }],
    }));
    expect(composed.positioningRelations).toHaveLength(1);
    expect(composed.positioningRelations[0]?.roleEvidenceIds).toEqual(expect.arrayContaining(["role:lifecycle", "role:retention-outcome"]));
    expect(composed.sections.howToWin.propositions[0]?.text).toContain("Improve retention outcomes");
  });

  it("suppresses opaque canonical enum values from reader-facing propositions", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      canonicalSignals: [{
        id: "signal:work-nature",
        kind: "WORK_NATURE",
        value: "EXECUTIVE_WORK",
        provenance: "CANONICAL_EVALUATION",
      }],
      publishedRoleWork: [],
      qualificationRequirements: [],
      roleContext: [],
      candidatePrecedents: [],
      candidateCapabilities: [],
    }));

    expect(JSON.stringify(composed)).not.toContain("EXECUTIVE_WORK");
  });

  it("gives every RADAR inference a source, candidate, or canonical reference", () => {
    const composed = composeEditorialIntelligenceV2(contract());
    for (const item of composed.propositions.filter((proposition) => proposition.kind === "RADAR_INFERENCE")) {
      expect(item.roleEvidenceIds.length + item.candidateEvidenceIds.length + item.canonicalSignalIds.length).toBeGreaterThan(0);
    }
  });

  it("keeps a future persisted evaluator trace distinct from editorial positioning", () => {
    const traceRich = composeEditorialIntelligenceV2(contract({
      decisionDrivers: {
        strengths: [{
          id: "driver:commercial",
          kind: "DIMENSION",
          value: "Commercial operating depth",
          provenance: "CANONICAL_EVALUATION",
        }],
        constraints: [], unknowns: [], hinges: [], availability: "PERSISTED_DRIVER_DETAIL",
      },
      candidateFitEvidence: [{
        id: "trace:crm",
        candidateEvidenceIds: ["candidate:crm"],
        jobEvidenceIds: ["role:lifecycle"],
        jobEvidence: [{ id: "role:lifecycle", statement: "Own lifecycle retention and CRM execution across priority customer segments.", kind: "ROLE_WORK" }],
        canonicalSignalId: "signal:capability",
        candidateCapabilityKey: "CRM",
        jobCapabilityKey: "CRM",
        relationship: "MATCH",
      }],
      canonicalSignals: [{
        id: "signal:capability",
        kind: "CAPABILITY",
        value: "CRM and lifecycle ownership",
        provenance: "CANONICAL_EVALUATION",
        capabilityKeys: ["crm", "lifecycle"],
      }],
    }));

    const traceExplanation = traceRich.propositions.find((item) =>
      item.kind === "CANONICAL_EVALUATION" && item.candidateEvidenceIds.includes("candidate:crm"),
    );
    expect(traceExplanation?.text).toMatch(/stored evaluator trace links/i);
    expect(traceExplanation?.canonicalSignalIds).toEqual(["trace:crm", "signal:capability"]);
    expect(traceRich.sections.howToWin.propositions[0]?.kind).toBe("RADAR_INFERENCE");
  });

  it("does not treat a single generic performance token as editorial positioning evidence", () => {
    const composed = composeEditorialIntelligenceV2(contract({
      candidatePrecedents: [],
      candidateCapabilities: [{
        capability: "Performance Marketing",
        statement: "Built performance marketing operations across consumer accounts.",
        confidence: 0.94,
        evidenceIds: ["candidate:performance"],
        provenance: "CANDIDATE_FACT",
        capabilityKeys: ["performance marketing"],
      }],
      publishedRoleWork: [{
        kind: "RESPONSIBILITY",
        statement: "Manage vendor performance, corrective actions, and service-delivery escalations.",
        sourceEvidenceId: "role:vendor",
        capabilityKeys: ["vendor operations"],
      }],
    }));

    expect(composed.positioningRelations).toEqual([]);
    expect(JSON.stringify(composed)).not.toMatch(/Performance Marketing as relevant operating evidence/i);
  });

  it("does not reuse the same proposition across major editorial sections", () => {
    const composed = composeEditorialIntelligenceV2(contract());
    const sectionIds = Object.values(composed.sections)
      .flatMap((section) => section.propositions.map((item) => item.id));

    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });

  it("has no raw-source, evaluator, or projection-builder imports", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/intelligence/editorial/EditorialPropositionComposer.ts", "utf8"),
    );
    expect(source).not.toMatch(/rawContent|rawDescription|JobProjectionBuilder|SemanticResolutionEngine|runEngineSingleIntrinsic|DeterministicScorer/);
  });
});
