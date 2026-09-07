import { describe, expect, it } from "vitest";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import { present } from "@/lib/intelligence/present";
import { BriefCompositionEngine } from "@/lib/intelligence/editorial/BriefCompositionEngine";

describe("recommended action editorial wiring", () => {
  it("carries synthesized action through presenter into the partial dossier", () => {
    const source = {
      jobHash: "action-wiring-non-benchmark",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      scrapedFrom: "LinkedIn",
      dimensions: [],
    } as OpportunitySource;
    const record = {
      jobHash: source.jobHash,
      engineVersion: "4.3",
      recommendationVersion: "test",
      verb: "PURSUE",
      qualityScore: 72,
      rawScore: 72,
      priority: 72,
      vetoed: false,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.8,
      decisionSummary: { careerValue: 1, shortlistingPotential: 1, pursuitFriction: 1 },
      decisionDrivers: [],
      decisionRisks: [],
      confidences: { parsing: 0.8, matching: 0.8, recommendation: 0.8 },
      stability: "High",
      comparison: { higherThan: [], lowerThan: [] },
      explanation: { missingEvidence: ["reporting line"], contradictionFlags: [] },
      trace: { pipeline: [], evidenceMapping: [], careerValueBreakdown: {} },
      headspace: { finalVerb: "PURSUE", downgraded: false },
    } as unknown as RecommendationRecord;

    const presented = present(source, record);
    const brief = BriefCompositionEngine.compose(presented.opportunity);

    expect(presented.opportunity.recommendedAction).not.toBe("PURSUE");
    expect(presented.opportunity.recommendedAction).toMatch(/Proceed|Request|screening/i);
    expect(presented.opportunity.hiringRisk).not.toBe(presented.opportunity.recommendedAction);
    const action = presented.opportunity.recommendedAction;
    expect(action).toBeTruthy();
    expect(brief.memory.recommendedAction).toBe(action);
    expect(brief.structuredSections.strategy.thesis).toBe(action);
    expect(brief.pursuitStrategy.immediateNextAction).toBe(action);
    expect(brief.strategy.heroAnchor).toBe(action);
    expect(brief.verdictGuidance.actionNotice).toBe(action);
    expect(brief.directives?.action).toBe(action);

    const actionFields = JSON.stringify({
      memory: brief.memory.recommendedAction,
      section: brief.structuredSections.strategy.thesis,
      pursuit: brief.pursuitStrategy.immediateNextAction,
      hero: brief.strategy.heroAnchor,
      notice: brief.verdictGuidance.actionNotice,
      directive: brief.directives?.action,
    });
    expect(actionFields).not.toContain("Some published role facts remain unconfirmed");
    expect(actionFields).not.toContain("INVESTIGATE");
  });
});
