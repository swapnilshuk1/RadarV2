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
    expect(projection.presentationQualificationEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ statement: "Strong experience in performance marketing and paid media.", sourceRegion: "REQUIREMENTS" }),
      expect.objectContaining({ statement: "10+ years of experience in operations leadership.", sourceRegion: "REQUIREMENTS" }),
    ]));
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

  it("uses canonical-source occurrence ordinals to distinguish identical source atoms", () => {
    const statement = "Own vendor performance, corrective actions, QBRs and service-delivery escalations.";
    const projection = project(`Key Responsibilities:\n${statement}\n${statement}`, "duplicate-source-version");

    expect(projection.roleWorkEvidence).toEqual([
      expect.objectContaining({ statement, ordinal: 1 }),
      expect.objectContaining({ statement, ordinal: 2 }),
    ]);
    expect(projection.roleWorkEvidence?.[0]?.id).not.toBe(projection.roleWorkEvidence?.[1]?.id);
  });

  it("keeps role-work evidence unavailable to the evaluation projection view", () => {
    const projection = project("Key Responsibilities:\nOwn vendor performance and service-delivery escalation management.");
    const evaluationProjection = toEvaluationJobProjection(projection);

    expect(projection.roleWorkEvidence?.length).toBeGreaterThan(0);
    expect("roleWorkEvidence" in evaluationProjection).toBe(false);
    expect("roleWorkEvidenceVersion" in evaluationProjection).toBe(false);
    expect("presentationQualificationEvidence" in evaluationProjection).toBe(false);
    expect("presentationQualificationEvidenceVersion" in evaluationProjection).toBe(false);
    expect(projection.projectionVersion).toBe(JobProjectionBuilder.PROJECTION_VERSION);
  });

  it("extracts presentation role work from pinned source without rebuilding a projection", () => {
    JobProjectionBuilder.clearCache();
    JobProjectionBuilder.resetMetrics();

    const evidence = JobProjectionBuilder.extractRoleWorkEvidenceForPresentation(
      "Key Responsibilities: Own vendor performance and service-delivery escalations.",
      "pinned-opportunity-version",
      [{
        name: "Vendor Performance",
        source: "explicit",
        tier: "EXECUTION_CAPABILITY",
        confidence: 0.9,
      }],
    );

    expect(evidence).toEqual([
      expect.objectContaining({
        kind: "RESPONSIBILITY",
        statement: "Own vendor performance and service-delivery escalations.",
      }),
    ]);
    expect(JobProjectionBuilder.getBuildCount()).toBe(0);
  });

  it("does not manufacture role work from unstructured capability labels", () => {
    const projection = project("Marketing\nSales\nCommercial leadership");
    expect(projection.roleWorkEvidence).toEqual([]);
  });

  it("rejects generic meta headings instead of publishing them as responsibilities", () => {
    const projection = project("Key Responsibilities:\nUse cases\nOwn vendor performance and service-delivery escalations.");
    expect(projection.roleWorkEvidence?.map((atom) => atom.statement)).toEqual([
      "Own vendor performance and service-delivery escalations.",
    ]);
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
      • Deliver a weekly MIS to the Board.
      • Deliver live instructor-led sessions to cohorts.
      • Deliver excellent customer service to all employees.
      • Maintain a healthy sales pipeline and provide regular forecasts while consistently achieving annual revenue targets.
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
    expect(byStatement.get("Deliver a weekly MIS to the Board.")).toBe("RESPONSIBILITY");
    expect(byStatement.get("Deliver live instructor-led sessions to cohorts.")).toBe("RESPONSIBILITY");
    expect(byStatement.get("Deliver excellent customer service to all employees.")).toBe("RESPONSIBILITY");
    expect(byStatement.get("Maintain a healthy sales pipeline and provide regular forecasts while consistently achieving annual revenue targets.")).toBe("RESPONSIBILITY");
  });

  it("retains only standalone reporting, team, and base-location context facts", () => {
    const projection = project(`
      Reports to the regional CEO.
      Team size: 12 direct reports.
      Base location: Gurugram, with regional travel.
      How to Apply: submit your application. Pay: competitive. Work Location: in person.
      Base Location: Gurugram (with regional travel) Team: Build from zero.
    `);

    expect(projection.roleWorkEvidence).toEqual([
      expect.objectContaining({ kind: "ROLE_CONTEXT", statement: "Reports to the regional CEO.", confidence: 0.9 }),
      expect.objectContaining({ kind: "ROLE_CONTEXT", statement: "Team size: 12 direct reports.", confidence: 0.9 }),
      expect.objectContaining({ kind: "ROLE_CONTEXT", statement: "Base location: Gurugram, with regional travel.", confidence: 0.9 }),
    ]);
  });

  it("keeps direct reporting structures as context rather than published work", () => {
    const projection = project(`
      Reports To: Board of Directors.
      You will report directly to the Pod Leader.
    `);

    expect(projection.roleWorkEvidence).toEqual([
      expect.objectContaining({ kind: "ROLE_CONTEXT", statement: "Reports To: Board of Directors." }),
      expect.objectContaining({ kind: "ROLE_CONTEXT", statement: "You will report directly to the Pod Leader." }),
    ]);
  });

  it("rejects candidate-subject qualifications and summary promises without assigned work", () => {
    const projection = project(`
      Professionals must be ready to travel extensively and must also have strong design sensibility.
      This person will have expertise in an array of advertising strategies.
      If you care about solving real problems, you'll feel at home here.
      You'll have opportunities to work on real-world marketing campaigns.
      You'll be there at the beginning.
      You will help build both.
      THE STANDARDWe expect everyone to demonstrate professional excellence.
    `);

    expect(projection.roleWorkEvidence).toEqual([]);
  });

  it("rejects candidate promises, employer disclaimers, cultural propositions, and fused boundaries", () => {
    const projection = project(`
      You will have the opportunity to solve problems and generate bold ideas.
      We provide you with a great learning ground and an opportunity to work with clients.
      Additionally, you will get the opportunity to enjoy a collaborative work environment.
      Here, you will find a culture guided by inclusion, benefits, and career development opportunities.
      Here you will collaborate with multi-national teams and have an opportunity to learn and grow.
      No matter where you are located, you will join a dedicated community.
      Join our Team About this opportunity to grow professionally.
      As a product specialist, you will join our close-knit department and gain customer-service experience.
      As a member of our team, you'll have the unique opportunity to sell at the forefront of technology.
      Once you join our team you will have the opportunity to learn and grow.
      Cvent is not responsible for losses or damages arising from this posting.
      You will exemplify Microsoft Values, Culture, and Leadership Principles.
      Role OverviewAs Vice President you will lead the commercial function.
      Benefits realizationOversee large-scale transformation delivery.
      Manage strategic vendorsRead more about us.
      Direct Mentorship: Work directly alongside senior leadership and interact with executives.
      Oversee what is delivered by the squad and when Apply design-thinking to understand user engagement.
    `);

    expect(projection.roleWorkEvidence).toEqual([]);
  });

  it("classifies each bounded atom once instead of letting a requirements heading turn duties into qualifications", () => {
    const projection = project(`
      Requirements:
      The ideal candidate will be responsible for leading regional sales.
      The ideal candidate will have 10+ years of regional sales experience.
      Coordinate with technical teams when required.
      Ability to coordinate effectively with technical teams.
      Company-sponsored insurance and weekends off.
      6:30 pm to 3:30 am. If you are proactive, we encourage you to apply for this exciting opportunity.
      You will manage a portfolio of high-value clients.
      You will be responsible for building cloud-native applications.
      While we operate globally, we provide market intelligence to clients worldwide.
      Required Skills & Qualifications Education: B.
      Strong leadership skills Preferred Qualifications: Bachelor’s degree required.
      Experience: SaaS sales: 1 year. Work Location: Hybrid remote.
      By applying to this position you may choose a preferred work location.
      This role will be required to work during EST hours.
      Work Experience Experience with enterprise SaaS and multimedia formats.
      Work on Your Terms: Enjoy flexible working with uncapped earning potential.
      Work-Life Integration: Enjoy a rewarding career with a company that values employee well-being.
      Availability: six working days per week.
      Availability on Saturdays and Sundays is essential.
      Be a Part of Something Big: Join a fast-growing company making an impact.
      Make a Difference: Contribute to a meaningful mission.
      Work on groundbreaking projects that are shaping the future.
      Maintain traceability between design and delivery Required Skills & Experience
      Lead customer service operations Problem Solving
      Drive resolution of escalations Interaction:
      Work with engineering to deliver the migration.
      What You Bring
      WHAT YOU BRING
      Who You Are8–12 years of enterprise sales experience.
      What We're Looking For 3+ years of CRO experience.
      What You Can Expect Leads regional portfolio strategy.
      Educational Qualification: Graduate (Masters Preferred) Job Overview We are seeking a leader.
      Strong experience in transformation consulting. What are we looking for?
      You will work with a high-density talent team solving large-scale problems.
      Real Portfolio Projects: Work on campaigns that can strengthen your portfolio.
      Work/Life Balance We value work-life harmony.
      Build for the future.
      Work with passion and persistence.
      Deliver results you're proud of.
      Partner across geography, generations, and teams.
      Direct, regular access to the founders.
      Create and review: GA drawings, Value engineering Cross Functional Collaboration : Work with Sales.
      Required Experience, Skills and Qualifications Graduate with 15+ years of relevant experience; Masters preferred.
      Required Skills2–5 years of hands-on experience in PPC.
      We prioritize your well-being, providing benefits and resources to support your personal journey.
      Flexi Pay empowers employees with the choice to customize salary components and optimize tax benefits.
      Your recruiting contact can share the salary range during the hiring process.
      If you are primarily looking for a fixed-salary position, this opportunity may not be suitable.
      Previous customer service experience is beneficial.2Q: What is the salary range?
      A: The salary is competitive and discussed during interview.
      Working Conditions: Regular computer usage and ability to perform essential functions.
      Ensure compliance with applicable employment and safety regulations.
      To build the strategy KRA2 To manage the channel KRA3 To achieve profitability.
      To build the regional sales strategy.
      AECOM is a Fortune 500 infrastructure consulting firm with global revenue operations.
      Mandatory Day-1 office onboarding is required.
      Learn more at aecom.com.
      If you have ideas, ingenuity and passion for making a difference, come and be a part of our team.
      Confidentiality Notice: do not distribute this posting.
      Anchoring the RFP responses for client needs and supporting the detailed solution run-through during the sales cycle.
      To liaise with relationship teams and product specialists.
      To add relevant wealth-management opportunities to the client plan.
      To actively review portfolio performance and client suitability.
      To work with internal stakeholders on client servicing.
    `);

    expect(projection.roleWorkEvidence?.map((atom) => atom.statement)).toEqual([
      "The ideal candidate will be responsible for leading regional sales.",
      "Coordinate with technical teams when required.",
      "You will manage a portfolio of high-value clients.",
      "You will be responsible for building cloud-native applications.",
      "Work with engineering to deliver the migration.",
      "Ensure compliance with applicable employment and safety regulations.",
      "To build the regional sales strategy.",
      "Anchoring the RFP responses for client needs and supporting the detailed solution run-through during the sales cycle.",
      "To liaise with relationship teams and product specialists.",
      "To add relevant wealth-management opportunities to the client plan.",
      "To actively review portfolio performance and client suitability.",
      "To work with internal stakeholders on client servicing.",
    ]);
    expect(projection.presentationQualificationEvidence?.map((atom) => atom.statement)).toEqual([
      "The ideal candidate will have 10+ years of regional sales experience.",
      "Ability to coordinate effectively with technical teams.",
      "8–12 years of enterprise sales experience.",
      "3+ years of CRO experience.",
      "Graduate with 15+ years of relevant experience; Masters preferred.",
      "2–5 years of hands-on experience in PPC.",
    ]);
  });

  it("strips a recoverable qualification heading after a preceding source sentence", () => {
    const projection = project(
      "Role overview.Required Experience, Skills and Qualifications Graduate with 15+ years of relevant experience; Masters preferred. Required Skills2–5 years of hands-on experience in PPC.",
    );

    expect(projection.presentationQualificationEvidence?.map((atom) => atom.statement)).toEqual([
      "Graduate with 15+ years of relevant experience; Masters preferred.",
      "2–5 years of hands-on experience in PPC.",
    ]);
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
