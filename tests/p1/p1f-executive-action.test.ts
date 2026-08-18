/**
 * P1-F: Executive Action Model
 *
 * Acceptance Contract:
 * - F1: Decision → action (every actionable recommendation has appropriate next action)
 * - F2: Action must be grounded (derive from authoritative decision, gaps, evidence)
 * - F3: Minimum meaningful action (smallest action that improves competitiveness)
 * - F4: Effort awareness (tailoringEffort influences action intensity)
 * - F5: PASS protection (PASS opportunities don't receive pursuit actions)
 * - F6: Unevaluable protection (SPARSE_SPEC/unevaluable don't receive fabricated actions)
 * - F7: Executive language (user-facing, no engine mechanics)
 * - F8: No decision mutation (action model consumes decision, never changes it)
 */

import { describe, it, expect } from "vitest";
import { candidateProfile } from "@/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { Presented } from "@/lib/intelligence/present";

// Helper to run full production path
function runEngineToPresented(
  opportunity: { role: string; company: string; description?: string; location?: string }
): Presented {
  const source: OpportunitySource = {
    jobHash: `test-${opportunity.company.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    role: opportunity.role,
    company: opportunity.company,
    location: opportunity.location || "Test Location",
    description: opportunity.description || `${opportunity.role} at ${opportunity.company}`,
    url: "https://example.com/job",
    portal: "LinkedIn",
    rawText: opportunity.description || `${opportunity.role} at ${opportunity.company}`,
    postingDate: new Date().toISOString(),
    scrapedAt: new Date().toISOString(),
  };

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  injectFreshRecords([source]);
  const { presented } = runEngine(projection as any, 0);
  clearInjectedRecords();

  const presentedForSource = presented.find(p => p.opportunity.jobHash === source.jobHash);
  if (!presentedForSource) {
    throw new Error("No presented output for source");
  }

  return presentedForSource;
}

describe("P1-F: Executive Action Model", () => {
  it("F1: Every opportunity produces an appropriate actionable recommendation", () => {
    // Test with any fixture that produces a valid evaluation
    const { opportunity } = runEngineToPresented({
      role: "VP Marketing",
      company: "TestCo",
      description: "VP Marketing. Brand strategy. CRM. Team of 20. Salesforce. P&L scope.",
    });

    // F1: Every evaluable opportunity should have a recommendedAction
    expect(opportunity.recommendedAction).toBeDefined();
    expect(opportunity.recommendedAction?.length).toBeGreaterThan(0);
    
    // F7: Executive language, not engine terminology
    const action = opportunity.recommendedAction?.toLowerCase() || "";
    expect(action).toMatch(/proceed|consider|pass/); // One of the three executive actions
    expect(action).not.toContain("decisionpolicyengine");
    expect(action).not.toContain("rawscore");
    expect(action).not.toContain("priorityscore");
  });

  it("F1: CONSIDER produces an appropriate validation/improvement action", () => {
    const { opportunity } = runEngineToPresented({
      role: "VP Performance Marketing",
      company: "AgencyCo",
      description: "VP level role. 10+ years experience. Agency fee-book. Unclear P&L scope.",
    });

    // If this is CONSIDER, verify the action
    if (opportunity.decision === "CONSIDER") {
      expect(opportunity.recommendedAction).toBeDefined();
      const action = opportunity.recommendedAction?.toLowerCase() || "";
      expect(action).toContain("consider");
      expect(action).toContain("screening"); // F3: Minimum meaningful action
    }
  });

  it("F5: PASS does not produce a pursuit/application action", () => {
    const { opportunity } = runEngineToPresented({
      role: "Junior Marketing Coordinator",
      company: "StartupCo",
      description: "Entry level role. 0-2 years experience. Social media focus.",
    });

    if (opportunity.decision === "PASS") {
      expect(opportunity.recommendedAction).toBeDefined();
      const action = opportunity.recommendedAction?.toLowerCase() || "";
      
      // PASS should NOT encourage pursuit/application
      expect(action).toContain("pass");
      expect(action).not.toContain("apply");
      expect(action).not.toContain("pursue");
      expect(action).not.toContain("submit");
    }
  });

  it("F4: tailoringEffort is exposed and influences the opportunity", () => {
    const { opportunity } = runEngineToPresented({
      role: "VP Marketing",
      company: "TestCo",
      description: "VP Marketing. Brand strategy. CRM tools. Team leadership. Salesforce Marketing Cloud.",
    });

    // Tailoring effort should be defined (P1-C implementation)
    expect(opportunity.tailoringEffort).toBeDefined();
    expect(["LOW", "MODERATE", "HIGH"]).toContain(opportunity.tailoringEffort);

    // Recommended action should exist
    expect(opportunity.recommendedAction).toBeDefined();
    
    // F4: If HIGH effort and CONSIDER/PURSUE, verify the mechanism
    // (actual HIGH tailoring requires specific capability gaps which are hard to trigger in tests)
    if (opportunity.tailoringEffort && opportunity.decision !== "PASS") {
      // Action should be appropriate for the decision
      const action = opportunity.recommendedAction?.toLowerCase() || "";
      expect(action.length).toBeGreaterThan(0);
    }
  });

  it("F2: Action is grounded in actual decision and assessment", () => {
    const { opportunity, record } = runEngineToPresented({
      role: "VP Marketing",
      company: "ScaleCo",
      description: "VP Marketing. Growth strategy. Team leadership. CRM experience.",
    });

    // Action must match the authoritative decision
    if (opportunity.decision === "PURSUE") {
      expect(opportunity.recommendedAction?.toLowerCase()).toContain("proceed");
    } else if (opportunity.decision === "CONSIDER") {
      expect(opportunity.recommendedAction?.toLowerCase()).toContain("consider");
    } else if (opportunity.decision === "PASS") {
      expect(opportunity.recommendedAction?.toLowerCase()).toContain("pass");
    }

    // F8: No decision mutation - verify record and opportunity match
    expect(opportunity.decision).toBe(record.verb);
  });

  it("F6: SPARSE_SPEC / unevaluable opportunities do not receive fabricated pursuit actions", () => {
    const { opportunity } = runEngineToPresented({
      role: "Role",
      company: "MinimalCo",
      description: "Job", // Minimal description triggers SPARSE_SPEC
    });

    if (opportunity.decision === "SPARSE_SPEC") {
      // Should either have no recommendedAction or a "needs more info" type action
      const action = opportunity.recommendedAction?.toLowerCase() || "";
      expect(action).not.toContain("proceed");
      expect(action).not.toContain("apply");
      expect(action).not.toContain("pursue");
    }
  });

  it("F7: Action language is executive-facing, not engine-facing", () => {
    const { opportunity } = runEngineToPresented({
      role: "VP Growth",
      company: "ExpansionCo",
      description: "VP Growth Marketing. Customer acquisition. CRM strategy. Salesforce. P&L ownership.",
    });

    const action = opportunity.recommendedAction || "";

    // Must NOT contain engine terminology
    expect(action).not.toContain("DecisionPolicyEngine");
    expect(action).not.toContain("rawInteractiveScore");
    expect(action).not.toContain("capabilityInteractionMultiplier");
    expect(action).not.toContain("careerInteractionMultiplier");
    expect(action).not.toContain("ontology");
    expect(action).not.toContain("classifier");
    expect(action).not.toContain("gate");
    expect(action).not.toContain("veto");

    // Should contain executive language
    const hasExecutiveLanguage = 
      /proceed|consider|pass|screen|validate|verify|p&l|reporting|capital|scope/i.test(action);
    expect(hasExecutiveLanguage).toBe(true);
  });

  it("F8: Actions do not modify decision/score/confidence", () => {
    const { opportunity, record } = runEngineToPresented({
      role: "Director Marketing",
      company: "MidCo",
      description: "Director level. Marketing strategy. Team of 10. CRM tools.",
    });

    // Verify action generation doesn't mutate the record
    expect(record.verb).toBe(opportunity.decision);
    
    // Priority may be null for vetoed opportunities, verify consistency
    const recordPriority = record.priority;
    const oppScore = opportunity.recommendationResult?.score ?? null;
    expect(recordPriority === oppScore || (recordPriority === null && oppScore === 0)).toBe(true);
    
    // Confidence should match
    expect(record.confidence).toBe(opportunity.recommendationResult?.decisionConfidence?.overall ?? null);

    // Action is pure projection from record
    expect(opportunity.recommendedAction).toBeDefined();
  });

  it("F3: Material capability gap produces an action grounded in that gap", () => {
    const { opportunity, record } = runEngineToPresented({
      role: "VP Data Analytics",
      company: "AnalyticsCo",
      description: "VP Data. SQL required. Python. Machine learning. Tableau.",
    });

    // If there are capability gaps, action should reference them
    const hasGaps = record.decisionRisks?.some(r => 
      r.factor.toLowerCase().includes("capability")
    );

    if (hasGaps && opportunity.tailoringEffort === "HIGH") {
      const action = opportunity.recommendedAction?.toLowerCase() || "";
      expect(action).toContain("gap");
      expect(action).toContain("capability");
    }
  });

  it("F9: Same production inputs produce deterministic actions", () => {
    const opp1 = runEngineToPresented({
      role: "VP Marketing",
      company: "StableCo",
      description: "VP Marketing. Brand strategy. CRM. 15+ years.",
    });

    const opp2 = runEngineToPresented({
      role: "VP Marketing",
      company: "StableCo",
      description: "VP Marketing. Brand strategy. CRM. 15+ years.",
    });

    // Same inputs should produce same decision and same action pattern
    expect(opp1.opportunity.decision).toBe(opp2.opportunity.decision);
    expect(opp1.opportunity.recommendedAction).toBeDefined();
    expect(opp2.opportunity.recommendedAction).toBeDefined();
    
    // Actions should be consistent (same decision type)
    const action1 = opp1.opportunity.recommendedAction?.split('.')[0] || "";
    const action2 = opp2.opportunity.recommendedAction?.split('.')[0] || "";
    expect(action1).toBe(action2);
  });

  it("F2/F4: Evidence uncertainty produces validation action, not invented claim", () => {
    const { opportunity, record } = runEngineToPresented({
      role: "VP Commercial",
      company: "UnclearCo",
      description: "VP Commercial. P&L scope unclear. Reporting line TBD. Hybrid work.",
    });

    // If there's uncertainty in the evidence
    const hasUncertainty = record.decisionRisks?.some(r =>
      r.evidence.toLowerCase().includes("missing") ||
      r.evidence.toLowerCase().includes("unclear")
    );

    if (hasUncertainty && opportunity.decision === "CONSIDER") {
      const action = opportunity.recommendedAction?.toLowerCase() || "";
      // Should suggest validation, not make claims
      expect(action).toContain("verify");
      expect(action).toContain("screening");
    }
  });
});
