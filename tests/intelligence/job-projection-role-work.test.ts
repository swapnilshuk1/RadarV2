import { describe, expect, it } from "vitest";
import { toEvaluationJobProjection } from "../../src/lib/domain/job_projection";
import { JobProjectionBuilder } from "../../src/lib/intelligence/builders/JobProjectionBuilder";

function project(description: string, opportunityVersion = "opp-version-1") {
  JobProjectionBuilder.clearCache();
  return JobProjectionBuilder.build({
    id: opportunityVersion,
    opportunityVersion,
    jobHash: `job-${opportunityVersion}`,
    role: "Operations Director",
    company: "Neutral Employer",
    description,
    dimensions: [],
  });
}

describe("JobProjectionBuilder role-work retention", () => {
  it("retains bounded responsibilities and outcomes while excluding qualifications and corporate copy", () => {
    const projection = project(`
      About the company
      Neutral Employer is a global service network supporting complex clients.

      Key Responsibilities:
      • Own vendor performance, corrective actions, QBRs and service-delivery escalations.
      • Achieve on-time delivery, margin and client-retention targets across the programme.
      • Reports to the regional operating leader.

      Requirements:
      • Strong experience in performance marketing and paid media.
      • 10+ years of experience in operations leadership.
    `);

    expect(projection.roleWorkEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "RESPONSIBILITY",
        statement: "Own vendor performance, corrective actions, QBRs and service-delivery escalations.",
        sourceQuote: "Own vendor performance, corrective actions, QBRs and service-delivery escalations.",
        sourceRegion: "RESPONSIBILITIES",
      }),
      expect.objectContaining({
        kind: "OUTCOME",
        statement: "Achieve on-time delivery, margin and client-retention targets across the programme.",
      }),
      expect.objectContaining({
        kind: "ROLE_CONTEXT",
        statement: "Reports to the regional operating leader.",
      }),
    ]));

    const statements = projection.roleWorkEvidence?.map((item) => item.statement).join(" ") ?? "";
    expect(statements).not.toMatch(/global service network|performance marketing|10\+ years/i);
  });

  it("uses source identity rather than extractor region for stable evidence IDs", () => {
    const statement = "This person will own vendor performance, corrective actions, QBRs and service-delivery escalations.";
    const underResponsibilityHeading = project(`Key Responsibilities:\n${statement}`, "same-version");
    const underSummary = project(statement, "same-version");

    expect(underResponsibilityHeading.roleWorkEvidence).toHaveLength(1);
    expect(underSummary.roleWorkEvidence).toHaveLength(1);
    expect(underResponsibilityHeading.roleWorkEvidence?.[0]?.sourceRegion).toBe("RESPONSIBILITIES");
    expect(underSummary.roleWorkEvidence?.[0]?.sourceRegion).toBe("SUMMARY");
    expect(underResponsibilityHeading.roleWorkEvidence?.[0]?.id).toBe(underSummary.roleWorkEvidence?.[0]?.id);
  });

  it("keeps role-work evidence unavailable to the evaluation projection view", () => {
    const projection = project("Key Responsibilities:\nOwn vendor performance and service-delivery escalation management.");
    const evaluationProjection = toEvaluationJobProjection(projection);

    expect(projection.roleWorkEvidence?.length).toBeGreaterThan(0);
    expect("roleWorkEvidence" in evaluationProjection).toBe(false);
    expect("roleWorkEvidenceVersion" in evaluationProjection).toBe(false);
    expect(projection.projectionVersion).toBe(JobProjectionBuilder.PROJECTION_VERSION);
  });

  it("does not manufacture role work from unstructured capability labels", () => {
    const projection = project("Marketing\nSales\nCommercial leadership");
    expect(projection.roleWorkEvidence).toEqual([]);
  });

  it("rejects employer culture and workplace copy that uses role-like language", () => {
    const projection = project(`
      In this role it will be critical to embrace our shared core values and
      lead collectively to inspire transformational creativity.
      Life at Neutral Employer includes investing in employee growth so people
      can do their best work.
      The working style for this role is four days in the office and one day
      working from home.
    `);

    expect(projection.roleWorkEvidence).toEqual([]);
  });

  it("fails closed on common corporate, equal-opportunity, qualification, and heading propositions", () => {
    const projection = project(`
      Why Neutral Employer? We are a vibrant community of solvers.
      Equal Opportunity Employer: We celebrate diversity and are committed to inclusion.
      The role offers excellent growth opportunities.
      Backed by leading investors, the company is building a category-defining brand.
      This role is ideal for someone with extensive commercial experience.
      Excellent communication and problem-solving are essential for success.
      What makes the role successful:
      Demonstrated line-management experience and experience leading through influence.
      ResponsibilitiesHOW YOU WILL MAKE AN IMPACTYour role is important.
      What Deliverables You Will Take Ownership OfThe annual operating plan and market prioritization framework.
      Location – this role is based in Gurgaon. Equal Opportunities: we are committed to inclusion.
      Digital Commerce Partnership Partner with sales teams on category direction Provide strategic inputs into product pricing and assortment principles for online channels Digital-first launch planning Partner with commerce teams ensuring sharper proposition inputs and adoption across all customer journeys.
    `);

    expect(projection.roleWorkEvidence).toEqual([]);
  });

  it("distinguishes assigned duties from explicit employer success states", () => {
    const projection = project(`
      Key Responsibilities:
      • Monitor revenue and retention metrics.
      • Own the P&L and revenue forecast.
      • Use analytics to improve conversion.
      • Achieve a 20% revenue-growth target.
      • Reduce churn below the agreed threshold.
      • Deliver within the approved budget.
    `);

    const byStatement = new Map(
      projection.roleWorkEvidence?.map((atom) => [atom.statement, atom.kind]),
    );
    expect(byStatement.get("Monitor revenue and retention metrics.")).toBe("RESPONSIBILITY");
    expect(byStatement.get("Own the P&L and revenue forecast.")).toBe("RESPONSIBILITY");
    expect(byStatement.get("Use analytics to improve conversion.")).toBe("RESPONSIBILITY");
    expect(byStatement.get("Achieve a 20% revenue-growth target.")).toBe("OUTCOME");
    expect(byStatement.get("Reduce churn below the agreed threshold.")).toBe("OUTCOME");
    expect(byStatement.get("Deliver within the approved budget.")).toBe("OUTCOME");
  });

  it("retains every valid source atom instead of truncating early evidence", () => {
    const responsibilities = Array.from(
      { length: 14 },
      (_, index) => `• Own operating workstream ${index + 1} and deliver the agreed service level.`,
    );
    const projection = project(`Key Responsibilities:\n${responsibilities.join("\n")}`);

    expect(projection.roleWorkEvidence).toHaveLength(14);
  });

  it("atomizes flattened headings and numbered bullets without admitting adjacent qualification text", () => {
    const projection = project(
      "Key Responsibilities:1. Own vendor performance and service-delivery escalations.2. Achieve retention and margin targets. What You Bring: Strong experience in performance marketing and paid media. Show more Show less",
    );

    expect(projection.roleWorkEvidence).toEqual([
      expect.objectContaining({
        kind: "RESPONSIBILITY",
        statement: "Own vendor performance and service-delivery escalations.",
      }),
      expect.objectContaining({
        kind: "OUTCOME",
        statement: "Achieve retention and margin targets.",
      }),
    ]);
  });
});
