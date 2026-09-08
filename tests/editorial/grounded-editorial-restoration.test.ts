import { describe, expect, it } from "vitest";
import type { Opportunity } from "@/data/opportunity-fixtures";
import { BriefCompositionEngine } from "@/lib/intelligence/editorial/BriefCompositionEngine";

function createProductionOpportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    jobHash: "test-hash",
    role: "Executive Role",
    company: "Test Corp",
    location: "Gurugram",
    scrapedFrom: "LinkedIn",
    dimensions: [],
    ...overrides,
  } as Opportunity;
}

describe("Grounded Editorial Restoration Integration", () => {
  const futureLeapOpp = createProductionOpportunity({
    jobHash: "futureleap-business-head",
    role: "Business Head",
    company: "FutureLeap Search",
    location: "Gurugram",
    primaryDriver: "Direct operational and commercial mandate to scale executive search and leadership advisory practices.",
    primaryRisk: "Recruitment market cyclic exposure and high revenue dependency on search placements.",
    positioning: "Position as an enterprise practice builder with proven executive search and leadership client management experience.",
    dimensions: [
      {
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Lead business growth, client relations, and delivery teams across key industry verticals.",
          evidence: [{ quote: "Lead business growth, client relations, and delivery teams across key industry verticals.", source: "JD" }],
        },
      },
      {
        key: "commercialAccountability",
        label: "Commercial Accountability",
        importance: "Core",
        bucket: "Missing",
        jdEvidence: { status: "Missing", value: "" },
      },
    ],
    engineRecommendation: {
      engineVerdict: "CONSIDER",
      qualityScore: 67,
      rawScore: 67,
      triggeredRuleIds: ["CONSIDER_VERIFY_BUDGET"],
      relativeDifferentiator: "Senior delivery and business practice scaling record",
    } as any,
  });

  const pinkertonOpp = createProductionOpportunity({
    jobHash: "pinkerton-ops-director",
    role: "Operations Director",
    company: "Pinkerton",
    location: "New Delhi",
    primaryDriver: "Regional operational stewardship with security, corporate intelligence, and risk mitigation command.",
    primaryRisk: "Strict global compliance reporting lines and matrixed multinational stakeholder coordination.",
    positioning: "Position as a disciplined operational commander with deep regional risk and crisis response track record.",
    primaryProof: {
      headline: "Transferable Experience",
      detail: "Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority",
    },
    dimensions: [
      {
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Direct comprehensive enterprise security operations and crisis intelligence teams across South Asia.",
          evidence: [{ quote: "Direct comprehensive enterprise security operations and crisis intelligence teams across South Asia.", source: "JD" }],
        },
        candidateProof: {
          headline: "Transferable Experience",
          detail: "Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority",
        },
      },
    ],
    engineRecommendation: {
      engineVerdict: "PURSUE",
      qualityScore: 78,
      rawScore: 78,
      triggeredRuleIds: ["REGIONAL_OPERATIONS_SCALE"],
      relativeDifferentiator: "Proven security intelligence and operations management",
    } as any,
  });

  const wppOpp = createProductionOpportunity({
    jobHash: "wpp-media-associate-director",
    role: "Associate Director, Client Services, India",
    company: "WPP Media",
    location: "Mumbai",
    primaryDriver: "Senior media agency leadership driving large-scale brand client relationships and integrated communications.",
    primaryRisk: "Matrixed holding group reporting and demanding cross-channel client retention pressure.",
    positioning: "Position as a consultative brand leader capable of growing enterprise agency accounts.",
    primaryProof: {
      headline: "Transferable Experience",
      detail: "marketing",
    },
    dimensions: [
      {
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Drive strategic client services, senior brand stakeholder management, and media campaign oversight.",
          evidence: [{ quote: "Drive strategic client services, senior brand stakeholder management, and media campaign oversight.", source: "JD" }],
        },
        candidateProof: {
          headline: "Transferable Experience",
          detail: "marketing",
        },
      },
    ],
    engineRecommendation: {
      engineVerdict: "PURSUE",
      qualityScore: 75,
      rawScore: 75,
      triggeredRuleIds: ["CLIENT_SERVICES_SCALE"],
      relativeDifferentiator: "Senior multi-account agency client leadership",
    } as any,
  });

  const socialBeatOpp = createProductionOpportunity({
    jobHash: "social-beat-influencer-director",
    role: "Director of Influencer Marketing",
    company: "Social Beat",
    location: "Gurugram",
    primaryDriver: "Fast-growing digital agency influencer marketing practice leadership across top-tier consumer brands.",
    primaryRisk: "High client campaign turnover and platform creator relationship volatility.",
    positioning: "Position as an influential digital growth strategist with established creator network and attribution rigor.",
    primaryProof: {
      headline: "Candidate precedent: Influencer marketing strategy",
      detail: "Led multi-market performance and creator-led growth programs.",
    },
    dimensions: [
      {
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Develop influencer marketing strategies, build creator partnerships, and analyze influencer campaign performance.",
          evidence: [{ quote: "Develop influencer marketing strategies, build creator partnerships, and analyze influencer campaign performance.", source: "JD" }],
        },
        candidateProof: {
          headline: "Candidate precedent: Influencer marketing strategy",
          detail: "Led multi-market performance and creator-led growth programs.",
        },
      },
    ],
    engineRecommendation: {
      engineVerdict: "PURSUE",
      qualityScore: 72,
      rawScore: 72,
      triggeredRuleIds: ["CAREER_STEP_UP"],
      relativeDifferentiator: "First director-level role in influencer marketing",
    } as any,
  });

  const allOpps = [futureLeapOpp, pinkertonOpp, wppOpp, socialBeatOpp];
  const briefs = allOpps.map((opp) =>
    BriefCompositionEngine.compose(opp, { canonicalEvidenceBound: true })
  );

  const [futureLeapBrief, pinkertonBrief, wppBrief, socialBeatBrief] = briefs;

  it("Test 1: Editorial diversity across the 4 fixtures", () => {
    const contextTheses = briefs.map((b) => b.structuredSections.context.thesis);
    expect(new Set(contextTheses).size).toBeGreaterThanOrEqual(3);

    const bottomLines = briefs.map((b) => b.oneMinuteTLDR.bottomLine);
    expect(new Set(bottomLines).size).toBeGreaterThanOrEqual(3);

    const strategyBodies = briefs.map((b) => b.structuredSections.strategy.body);
    expect(new Set(strategyBodies).size).toBeGreaterThanOrEqual(3);
  });

  it("Test 2: No bad boilerplate appears as central editorial thesis", () => {
    for (const brief of briefs) {
      const serialized = JSON.stringify({
        thesis: brief.structuredSections.context.thesis,
        mandateThesis: brief.structuredSections.mandate.thesis,
        bottomLine: brief.oneMinuteTLDR.bottomLine,
        opinion: brief.executiveOpinion,
      });

      expect(serialized).not.toContain("RADAR PURSUE assessment:");
      expect(serialized).not.toContain("RADAR CONSIDER assessment:");
      expect(serialized).not.toContain("Published mandate not established.");
      expect(serialized).not.toContain("No source-grounded proof point is recorded.");
    }
  });

  it("Test 3: Internal duplication check (headline, bottomLine, and opinion differ)", () => {
    for (const brief of briefs) {
      const distinct = new Set(
        [
          brief.structuredSections.context.thesis,
          brief.oneMinuteTLDR.bottomLine,
          brief.executiveOpinion,
        ].filter(Boolean),
      );
      expect(distinct.size).toBeGreaterThan(1);
    }
  });

  it("Test 4: Proof quality filters out raw taxonomy labels and preserves substantive claims", () => {
    // WPP: raw label "marketing" must be rejected
    expect(
      wppBrief.proofPoints.some(
        (proof) => proof.detail.trim().toLowerCase() === "marketing",
      ),
    ).toBe(false);

    // Pinkerton: compound classifier label must be rejected
    expect(
      pinkertonBrief.proofPoints.some((proof) =>
        /enterprise p&l ownership.*board decision authority/i.test(proof.detail),
      ),
    ).toBe(false);

    // Social Beat: substantive candidate achievement must survive
    expect(
      socialBeatBrief.proofPoints.some(
        (proof) =>
          proof.detail ===
          "Led multi-market performance and creator-led growth programs.",
      ),
    ).toBe(true);
  });

  it("Test 5: Employer fact safety rejects unsupported claims", () => {
    for (const brief of briefs) {
      const serialized = JSON.stringify(brief);
      expect(serialized).not.toMatch(
        /board-level commercial reporting|headcount hiring budget|25 FTE|founder-led processes|stealth-mandate/i,
      );
    }
  });

  it("Test 6: PURSUE consistency - no investigate/pause for pursue dossiers", () => {
    const pursueBriefs = [pinkertonBrief, wppBrief, socialBeatBrief];

    for (const brief of pursueBriefs) {
      expect(brief.pursuitStrategy.executiveLabel).toBe("Proceed with focused outreach");
      expect(brief.pursuitStrategy.pursuitMode).toBe("CLARIFY_SCOPE");

      const serialized = JSON.stringify(brief);
      expect(serialized).not.toContain("Investigate before investing");
      expect(serialized).not.toContain("INVESTIGATE_THEN_DECIDE");
    }
  });
});
