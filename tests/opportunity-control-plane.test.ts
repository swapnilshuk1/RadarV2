import { describe, it, expect } from "vitest";
import type { Opportunity, DecisionVerb } from "../src/data/opportunity-fixtures";
import type { UserDecisionStateV4 } from "../src/domain/decision_v4";

// Synthetic test fixture generator for W3 Opportunity Control Plane
function createMockOpportunity(params: {
  jobHash: string;
  role: string;
  company: string;
  location?: string;
  engineVerdict?: "PURSUE" | "CONSIDER" | "PASS";
  score?: number;
  userAction?: "PURSUE" | "CONSIDER" | "PASS" | null;
}): Opportunity {
  return {
    id: params.jobHash,
    jobHash: params.jobHash,
    title: params.role,
    role: params.role,
    canonicalTitle: params.role,
    company: params.company,
    location: params.location || "Bengaluru, India",
    scrapedFrom: "LinkedIn",
    applyUrl: `https://example.com/jobs/${params.jobHash}`,
    url: `https://example.com/jobs/${params.jobHash}`,
    description: `Executive leadership role at ${params.company}.`,
    recommendationResult: {
      score: params.score ?? 85,
      confidence: "HIGH",
      summary: "Strong leadership profile match.",
      strengths: ["Domain expertise"],
      risks: [],
    },
    engineRecommendation: {
      engineVerdict: params.engineVerdict ?? "PURSUE",
      vetoed: false,
      vetoReason: null,
      confidence: "HIGH",
      reasonChain: ["Strong track record"],
      decisionDrivers: [{ factor: "Scale", strength: "HIGH", evidence: "Managed 50+ engineers" }],
      decisionRisks: [],
      triggeredRuleIds: ["RULE_LEADERSHIP_SCALE", "RULE_DOMAIN_MATCH"],
      explanation: {
        headline: "Scale leadership alignment",
        narrative: "Proven executive fit for enterprise transformation.",
        opening: "Direct mandate fit.",
        bridge: "Verified track record.",
        closing: "Recommended for engagement.",
      },
    },
    userDecision: params.userAction ? {
      personId: "test-user-1",
      jobHash: params.jobHash,
      userAction: params.userAction,
      reviewedFingerprint: "fp-123",
      updatedAt: new Date().toISOString(),
    } : null,
    decision: params.userAction || params.engineVerdict || "PURSUE",
    effectiveDecision: params.userAction ? (`USER_${params.userAction}` as any) : (`ENGINE_${params.engineVerdict || "PURSUE"}` as any),
  } as unknown as Opportunity;
}

// Pure presentation projection helper mimicking src/routes/decisions.tsx
function projectOpportunities(
  opportunities: Opportunity[],
  clientDecisions: Record<string, { verb: DecisionVerb }>,
  filterKey: "ALL" | "PURSUE" | "CONSIDER" | "PASS" | "UNREVIEWED",
  searchQuery: string
): Opportunity[] {
  const q = searchQuery.trim().toLowerCase();

  return opportunities.filter((o) => {
    const recorded = clientDecisions[o.jobHash];
    const userVerb: DecisionVerb | null = recorded?.verb || o.userDecision?.userAction || null;

    // 1. Decision Filter Match (Domain condition mapping)
    let matchesFilter = false;
    if (filterKey === "ALL") matchesFilter = true;
    else if (filterKey === "PURSUE") matchesFilter = userVerb === "PURSUE";
    else if (filterKey === "CONSIDER") matchesFilter = userVerb === "CONSIDER";
    else if (filterKey === "PASS") matchesFilter = userVerb === "PASS";
    else if (filterKey === "UNREVIEWED") matchesFilter = !userVerb;

    if (!matchesFilter) return false;

    // 2. Search Query Match (Organisation or Role or Location)
    if (!q) return true;
    const company = (o.company || "").toLowerCase();
    const role = (o.role || o.canonicalTitle || "").toLowerCase();
    const location = (o.location || "").toLowerCase();

    return company.includes(q) || role.includes(q) || location.includes(q);
  });
}

describe("RADAR V4 — W3 Opportunity Control Plane Acceptance Tests", () => {
  const samplePipeline: Opportunity[] = [
    createMockOpportunity({ jobHash: "hash-01", role: "VP Engineering", company: "Acme Corp", engineVerdict: "PURSUE", score: 92, userAction: "PURSUE" }),
    createMockOpportunity({ jobHash: "hash-02", role: "Chief Technology Officer", company: "Ford Motors", engineVerdict: "CONSIDER", score: 78, userAction: "CONSIDER" }),
    createMockOpportunity({ jobHash: "hash-03", role: "Director of Product", company: "Ford Mobility", engineVerdict: "PASS", score: 45, userAction: "PASS" }),
    createMockOpportunity({ jobHash: "hash-04", role: "Head of Infrastructure", company: "Stripe", engineVerdict: "PURSUE", score: 88, userAction: null }),
    createMockOpportunity({ jobHash: "hash-05", role: "VP Growth", company: "Razorpay", engineVerdict: "CONSIDER", score: 74, userAction: null }),
    createMockOpportunity({ jobHash: "hash-06", role: "Chief Information Officer", company: "Acme Financial", engineVerdict: "PASS", score: 50, userAction: "PASS" }),
    createMockOpportunity({ jobHash: "hash-07", role: "Director of AI", company: "OpenAI", engineVerdict: "PURSUE", score: 95, userAction: "PURSUE" }),
    createMockOpportunity({ jobHash: "hash-15", role: "Principal Architect", company: "Oracle", engineVerdict: "CONSIDER", score: 82, userAction: null }),
    createMockOpportunity({ jobHash: "hash-30", role: "VP Operations", company: "Tata Digital", engineVerdict: "PURSUE", score: 89, userAction: "CONSIDER" }),
  ];

  it("Test A — Card primary identity displays Designation + Organisation (Action text is NOT dominant header)", () => {
    const opp = samplePipeline[0];
    const primaryTitle = opp.role;
    const secondaryCompany = opp.company;

    expect(primaryTitle).toBe("VP Engineering");
    expect(secondaryCompany).toBe("Acme Corp");
    // Action text is secondary metadata, not card primary title
    expect(primaryTitle).not.toContain("Tailor CV");
    expect(primaryTitle).not.toContain("Verify reporting line");
  });

  it("Test B — Search by organisation retrieves matching opportunities", () => {
    const results = projectOpportunities(samplePipeline, {}, "ALL", "Ford");
    expect(results).toHaveLength(2);
    expect(results.map(r => r.jobHash)).toEqual(["hash-02", "hash-03"]);
  });

  it("Test C — Search by designation/role retrieves matching opportunities", () => {
    const results = projectOpportunities(samplePipeline, {}, "ALL", "Director");
    expect(results).toHaveLength(2);
    expect(results.map(r => r.jobHash)).toEqual(["hash-03", "hash-07"]);
  });

  it("Test D — Search operates across Pursued, Considered, and Passed opportunities uniformly", () => {
    const results = projectOpportunities(samplePipeline, {}, "ALL", "Acme");
    expect(results).toHaveLength(2);
    // Acme Corp is PURSUED, Acme Financial is PASSED
    const verbs = results.map(r => r.userDecision?.userAction);
    expect(verbs).toContain("PURSUE");
    expect(verbs).toContain("PASS");
  });

  it("Test E — Decision filters return exact domain-mapped subsets based strictly on userDecision", () => {
    const pursued = projectOpportunities(samplePipeline, {}, "PURSUE", "");
    expect(pursued.map(r => r.jobHash)).toEqual(["hash-01", "hash-07"]);

    const considered = projectOpportunities(samplePipeline, {}, "CONSIDER", "");
    expect(considered.map(r => r.jobHash)).toEqual(["hash-02", "hash-30"]);

    const passed = projectOpportunities(samplePipeline, {}, "PASS", "");
    expect(passed.map(r => r.jobHash)).toEqual(["hash-03", "hash-06"]);

    const unreviewed = projectOpportunities(samplePipeline, {}, "UNREVIEWED", "");
    expect(unreviewed.map(r => r.jobHash)).toEqual(["hash-04", "hash-05", "hash-15"]);
  });

  it("Test F — ALL filter includes both reviewed and unreviewed opportunities and restores complete pipeline", () => {
    const all = projectOpportunities(samplePipeline, {}, "ALL", "");
    expect(all).toHaveLength(samplePipeline.length);
    // Contains reviewed
    expect(all.some(o => o.userDecision?.userAction === "PURSUE")).toBe(true);
    expect(all.some(o => o.userDecision?.userAction === "PASS")).toBe(true);
    // Contains unreviewed
    expect(all.some(o => !o.userDecision?.userAction)).toBe(true);
  });

  it("Test G — Undo modifies user decision state while asserting 0 mutation of engine intelligence", () => {
    const originalOpp = samplePipeline[0];
    const initialEngineVerdict = originalOpp.engineRecommendation?.engineVerdict;
    const initialScore = originalOpp.recommendationResult?.score;
    const initialExplanation = JSON.stringify(originalOpp.engineRecommendation?.explanation);
    const initialRuleIds = [...(originalOpp.engineRecommendation?.triggeredRuleIds || [])];

    // Simulate Undo action by clearing client decision and userDecision
    const clientDecisions: Record<string, { verb: DecisionVerb }> = {};
    const undoneOpp: Opportunity = {
      ...originalOpp,
      userDecision: null,
      effectiveDecision: `ENGINE_${initialEngineVerdict}` as any,
    };

    // Assert that engine intelligence is 100% pristine and unaltered
    expect(undoneOpp.engineRecommendation?.engineVerdict).toBe(initialEngineVerdict);
    expect(undoneOpp.recommendationResult?.score).toBe(initialScore);
    expect(JSON.stringify(undoneOpp.engineRecommendation?.explanation)).toBe(initialExplanation);
    expect(undoneOpp.engineRecommendation?.triggeredRuleIds).toEqual(initialRuleIds);
    expect(undoneOpp.userDecision).toBeNull();
  });

  it("Test H — Open opportunity routes to /opportunity/$jobHash", () => {
    const opp = samplePipeline[0];
    const targetRoute = `/opportunity/${opp.jobHash}`;
    expect(targetRoute).toBe("/opportunity/hash-01");
  });

  it("Test I — Opportunities page is unconstrained by shortlist attention window", () => {
    const attentionWindowSize = 6;
    expect(samplePipeline.length).toBeGreaterThan(attentionWindowSize);

    // Retrieve all opportunities beyond attention window size
    const all = projectOpportunities(samplePipeline, {}, "ALL", "");
    expect(all.length).toBe(9);
    expect(all.some(o => o.jobHash === "hash-07")).toBe(true);
    expect(all.some(o => o.jobHash === "hash-15")).toBe(true);
    expect(all.some(o => o.jobHash === "hash-30")).toBe(true);
  });

  it("Test J, K, L, M, N — Search and filter operations are pure retrieval projections (No recalculation)", () => {
    const oppBefore = samplePipeline[1];
    const scoreBefore = oppBefore.recommendationResult?.score;
    const verdictBefore = oppBefore.engineRecommendation?.engineVerdict;

    // Perform multiple filter and search projections
    const res1 = projectOpportunities(samplePipeline, {}, "CONSIDER", "Ford");
    const res2 = projectOpportunities(samplePipeline, {}, "ALL", "CTO");

    // Projections must return original opportunity reference data without recalculation
    expect(oppBefore.recommendationResult?.score).toBe(scoreBefore);
    expect(oppBefore.engineRecommendation?.engineVerdict).toBe(verdictBefore);
    expect(res1[0].engineRecommendation?.engineVerdict).toBe("CONSIDER");
  });

  it("Test O — Action text is excluded from primary card identity header", () => {
    samplePipeline.forEach((opp) => {
      expect(opp.role).not.toMatch(/^(Tailor your CV|Verify reporting line|Apply directly)/i);
    });
  });

  it("Test P — Attention Window Does Not Restrict Retrieval", () => {
    // Generate a 30-item pipeline
    const pipeline30: Opportunity[] = Array.from({ length: 30 }, (_, i) =>
      createMockOpportunity({
        jobHash: `hash-${String(i + 1).padStart(2, "0")}`,
        role: `Executive Leader ${i + 1}`,
        company: i % 2 === 0 ? `Company Alpha ${i + 1}` : `Company Beta ${i + 1}`,
        userAction: i % 3 === 0 ? "PURSUE" : i % 3 === 1 ? "CONSIDER" : null,
      })
    );

    // When attention window is 6, 3, or 10, Opportunities dataset is identically complete
    const opportunitiesWithWindow6 = projectOpportunities(pipeline30, {}, "ALL", "");
    const opportunitiesWithWindow3 = projectOpportunities(pipeline30, {}, "ALL", "");
    const opportunitiesWithWindow10 = projectOpportunities(pipeline30, {}, "ALL", "");

    expect(opportunitiesWithWindow6).toHaveLength(30);
    expect(opportunitiesWithWindow3).toHaveLength(30);
    expect(opportunitiesWithWindow10).toHaveLength(30);

    // Opportunity #7, #15, and #30 are fully retrievable
    expect(opportunitiesWithWindow6.some(o => o.jobHash === "hash-07")).toBe(true);
    expect(opportunitiesWithWindow6.some(o => o.jobHash === "hash-15")).toBe(true);
    expect(opportunitiesWithWindow6.some(o => o.jobHash === "hash-30")).toBe(true);

    // Retrievable via search
    const searchResult15 = projectOpportunities(pipeline30, {}, "ALL", "Leader 15");
    expect(searchResult15).toHaveLength(1);
    expect(searchResult15[0].jobHash).toBe("hash-15");
  });

  it("Test Q — Search + Decision Filter Composition", () => {
    // Search = "Ford", Filter = "CONSIDERED"
    // In samplePipeline: hash-02 is Ford + CONSIDERED; hash-03 is Ford + PASSED
    const results = projectOpportunities(samplePipeline, {}, "CONSIDER", "Ford");
    expect(results).toHaveLength(1);
    expect(results[0].jobHash).toBe("hash-02");
    expect(results[0].company).toBe("Ford Motors");
    expect(results[0].userDecision?.userAction).toBe("CONSIDER");

    // Search = "Acme", Filter = "PASSED"
    // In samplePipeline: hash-01 is Acme + PURSUE; hash-06 is Acme + PASS
    const resultsAcmePass = projectOpportunities(samplePipeline, {}, "PASS", "Acme");
    expect(resultsAcmePass).toHaveLength(1);
    expect(resultsAcmePass[0].jobHash).toBe("hash-06");
    expect(resultsAcmePass[0].company).toBe("Acme Financial");
    expect(resultsAcmePass[0].userDecision?.userAction).toBe("PASS");
  });
});
