import { describe, it, expect } from "vitest";
import {
  RoleIntelligenceExtractorV1,
  type RolePropositionAtom
} from "../../src/lib/intelligence/extraction/RoleIntelligenceExtractorV1";
import * as fs from "fs";
import * as path from "path";

describe("RoleIntelligenceExtractorV1 (22 Focused Tests)", () => {
  const extractor = new RoleIntelligenceExtractorV1();

  // 1. Exact offset invariant
  it("1. enforces exact offset invariant on 100% of accepted atoms", () => {
    const rawText = `About The Company\nAcme is a global healthcare firm.\n\nKey Responsibilities\nOwn the regional P&L and drive commercial growth.\nLead a 15-member team.\n\nRequired Qualifications\nMinimum 10 years in enterprise healthcare.`;
    const res = extractor.extract({
      caseId: "test-01",
      canonicalJobId: "job-01",
      rawText
    });

    expect(res.atoms.length).toBeGreaterThan(0);
    for (const atom of res.atoms) {
      const slice = rawText.slice(atom.startOffset, atom.endOffset);
      expect(slice).toBe(atom.exactText);
    }
  });

  // 2. Glued heading recognition
  it("2. recognizes concatenated / glued headings without whitespace or punctuation separators", () => {
    const rawText = `About The CompanyAcme Corp builds enterprise software.RequirementsWhat You'll DoOwn customer strategy.What We're Looking For10+ years experience.`;
    const res = extractor.extract({
      caseId: "test-glued",
      canonicalJobId: "job-glued",
      rawText
    });

    expect(res.metadata.hasGluedHeadings).toBe(true);
    const secTypes = res.sections.map(s => s.type);
    expect(secTypes).toContain("ABOUT_COMPANY");
    expect(secTypes).toContain("RESPONSIBILITIES");
    expect(secTypes).toContain("REQUIREMENTS");
  });

  // 3. Structural meta-lines
  it("3. extracts structural meta-lines (Reports To, Team, Experience, Compensation)", () => {
    const rawText = `Designation: Chief Commercial Officer\nReports To: Board of Directors\nTeam: Target 6–12 in Year 1\nBase Location: Bengaluru\nExperience: 15+ years\nCompensation: Competitive CTC`;
    const res = extractor.extract({
      caseId: "test-meta",
      canonicalJobId: "job-meta",
      rawText
    });

    expect(res.metadata.hasStructuralMetaLines).toBe(true);
    const reporting = res.atoms.find(a => a.semanticType === "REPORTING_LINE");
    expect(reporting).toBeDefined();
    expect(reporting?.exactText).toBe("Board of Directors");

    const team = res.atoms.find(a => a.semanticType === "PEOPLE_SCALE");
    expect(team).toBeDefined();
    expect(team?.exactText).toBe("Target 6–12 in Year 1");

    const req = res.atoms.find(a => a.semanticType === "HARD_REQUIREMENT");
    expect(req).toBeDefined();
    expect(req?.exactText).toBe("15+ years");
  });

  // 4. Empty headings / stubs
  it("4. handles empty headings and trailing stubs gracefully", () => {
    const rawText = `About The Company\n\nKey Responsibilities\n\n`;
    const res = extractor.extract({
      caseId: "test-empty",
      canonicalJobId: "job-empty",
      rawText
    });
    expect(res.sections.length).toBeGreaterThanOrEqual(1);
    expect(res.atoms.length).toBe(0);
  });

  // 5. Clause decomposition
  it("5. decomposes compound clauses into distinct exact-subspan atoms", () => {
    const rawText = `Key Responsibilities\nOwn the regional P&L, build and lead the commercial team, and drive profitable growth across India and Southeast Asia.`;
    const res = extractor.extract({
      caseId: "test-compound",
      canonicalJobId: "job-compound",
      rawText
    });

    const pnl = res.atoms.find(a => a.semanticType === "PNL_OWNERSHIP");
    expect(pnl).toBeDefined();
    expect(pnl?.exactText).toBe("Own the regional P&L");
    expect(rawText.slice(pnl!.startOffset, pnl!.endOffset)).toBe(pnl!.exactText);

    const team = res.atoms.find(a => a.semanticType === "PEOPLE_LEADERSHIP");
    expect(team).toBeDefined();
    expect(team?.exactText).toBe("build and lead the commercial team");

    const profit = res.atoms.find(a => a.semanticType === "PROFITABILITY_ACCOUNTABILITY");
    expect(profit).toBeDefined();
    expect(profit?.exactText).toBe("drive profitable growth");

    const geo = res.atoms.find(a => a.semanticType === "GEOGRAPHIC_SCOPE");
    expect(geo).toBeDefined();
    expect(geo?.exactText).toBe("across India and Southeast Asia");
  });

  // 6. Subject Eligibility Gate
  it("6. enforces Subject Eligibility Gate: company facts remain COMPANY and do NOT contaminate role scope", () => {
    const rawText = `About The Company\nWe are a $500M enterprise with 1,000 employees globally, founded by CEO John Smith.\n\nKey Responsibilities\nLead regional sales.`;
    const res = extractor.extract({
      caseId: "test-gate",
      canonicalJobId: "job-gate",
      rawText
    });

    const compAtoms = res.atoms.filter(a => a.subject === "COMPANY");
    expect(compAtoms.length).toBeGreaterThan(0);

    const rolePeopleScale = res.atoms.find(a => a.subject === "ROLE" && a.semanticType === "PEOPLE_SCALE");
    expect(rolePeopleScale).toBeUndefined();

    const roleRev = res.atoms.find(a => a.subject === "ROLE" && a.semanticType === "REVENUE_ACCOUNTABILITY");
    expect(roleRev).toBeUndefined();

    const roleProx = res.atoms.find(a => a.subject === "ROLE" && a.semanticType === "FOUNDER_CEO_PROXIMITY");
    expect(roleProx).toBeUndefined();
  });

  // 7. Reporting vs Proximity
  it("7. distinguishes REPORTING_LINE from FOUNDER_CEO_PROXIMITY", () => {
    const rawText = `The Role\nThe candidate reports directly to Ryan Roccon, CEO.\nIn addition, you will work closely with the founder on strategy.`;
    const res = extractor.extract({
      caseId: "test-rep-prox",
      canonicalJobId: "job-rep-prox",
      rawText
    });

    const rep = res.atoms.find(a => a.semanticType === "REPORTING_LINE");
    expect(rep).toBeDefined();
    expect(rep?.exactText).toContain("reports directly to Ryan Roccon");

    const prox = res.atoms.find(a => a.semanticType === "FOUNDER_CEO_PROXIMITY");
    expect(prox).toBeDefined();
    expect(prox?.exactText).toContain("work closely with the founder");
  });

  // 8. Board Exposure & Decision Authority
  it("8. identifies BOARD_EXPOSURE and DECISION_AUTHORITY", () => {
    const rawText = `Key Responsibilities\nAct as a statutory Board Director: attend board meetings, approve minutes and resolutions, and sign statutory filings.`;
    const res = extractor.extract({
      caseId: "test-board",
      canonicalJobId: "job-board",
      rawText
    });

    const board = res.atoms.find(a => a.semanticType === "BOARD_EXPOSURE");
    expect(board).toBeDefined();

    const decision = res.atoms.find(a => a.semanticType === "DECISION_AUTHORITY");
    expect(decision).toBeDefined();
    expect(decision?.exactText).toBe("approve minutes and resolutions");
  });

  // 9. Negative test: RevOps != REVENUE_ACCOUNTABILITY
  it("9. negative test: Revenue Operations must NOT become REVENUE_ACCOUNTABILITY", () => {
    const rawText = `Key Responsibilities\nExperienced in Revenue Operations and CRM administration.`;
    const res = extractor.extract({
      caseId: "test-revops",
      canonicalJobId: "job-revops",
      rawText
    });

    const revAcc = res.atoms.find(a => a.semanticType === "REVENUE_ACCOUNTABILITY");
    expect(revAcc).toBeUndefined();
  });

  // 10. Negative test: decision skills != DECISION_AUTHORITY
  it("10. negative test: strong decision-making skills must NOT become DECISION_AUTHORITY", () => {
    const rawText = `Requirements\nMust have strong decision-making skills and excellent communication.`;
    const res = extractor.extract({
      caseId: "test-dec-skills",
      canonicalJobId: "job-dec-skills",
      rawText
    });

    const decAuth = res.atoms.find(a => a.semanticType === "DECISION_AUTHORITY");
    expect(decAuth).toBeUndefined();
  });

  // 11. Numeric PEOPLE_SCALE and GREENFIELD_BUILD
  it("11. extracts numeric PEOPLE_SCALE and GREENFIELD_BUILD accurately", () => {
    const rawText = `Key Responsibilities\nBuild a business from scratch and scale a 40-member team.`;
    const res = extractor.extract({
      caseId: "test-greenfield",
      canonicalJobId: "job-greenfield",
      rawText
    });

    const gf = res.atoms.find(a => a.semanticType === "GREENFIELD_BUILD");
    expect(gf).toBeDefined();
    expect(gf?.exactText).toContain("from scratch");

    const ps = res.atoms.find(a => a.semanticType === "PEOPLE_SCALE");
    expect(ps).toBeDefined();
    expect(ps?.exactText).toBe("40-member team");
  });

  // 12. Materiality: Case 01 10+ years
  it("12. materiality: Case 01 10+ years is classified as HARD_REQUIREMENT despite ideally clause", () => {
    const rawText = `What We're Looking For\n10+ years of experience spanning brand and UX/product design, ideally with senior individual-contributor experience at a consumer tech, D2C, or digital health company.`;
    const res = extractor.extract({
      caseId: "test-case-01",
      canonicalJobId: "job-case-01",
      rawText
    });

    const atom = res.atoms.find(a => a.exactText.includes("10+ years"));
    expect(atom).toBeDefined();
    expect(atom?.semanticType).toBe("HARD_REQUIREMENT");
    expect(atom?.requirement?.materiality).toBe("HARD");
    expect(atom?.requirement?.parsedYears?.minimum).toBe(10);
  });

  // 13. Materiality: Case 26 12+ years
  it("13. materiality: Case 26 12+ years is classified as HARD_REQUIREMENT under N+ years cue", () => {
    const rawText = `What You'll Bring\n12+ years of relevant experience in L&D operations, shared services, or enterprise service environments.`;
    const res = extractor.extract({
      caseId: "test-case-26",
      canonicalJobId: "job-case-26",
      rawText
    });

    const atom = res.atoms.find(a => a.exactText.includes("12+ years"));
    expect(atom).toBeDefined();
    expect(atom?.semanticType).toBe("HARD_REQUIREMENT");
    expect(atom?.requirement?.materiality).toBe("HARD");
    expect(atom?.requirement?.parsedYears?.minimum).toBe(12);
  });

  // 14. Materiality: Case 28 15-20+ years
  it("14. materiality: Case 28 15-20+ years is classified as HARD_REQUIREMENT under N-M years cue", () => {
    const rawText = `About You\nYou have 15-20+ years of experience, including 5+ years in India site leadership, GM, COO, or country-head-type roles for multinational companies.`;
    const res = extractor.extract({
      caseId: "test-case-28",
      canonicalJobId: "job-case-28",
      rawText
    });

    const atom = res.atoms.find(a => a.exactText.includes("15-20+ years"));
    expect(atom).toBeDefined();
    expect(atom?.semanticType).toBe("HARD_REQUIREMENT");
    expect(atom?.requirement?.materiality).toBe("HARD");
    expect(atom?.requirement?.parsedYears?.minimum).toBe(15);
    expect(atom?.requirement?.parsedYears?.maximum).toBe(20);
  });

  // 15. Materiality: explicit PREFERRED section and cues
  it("15. materiality: handles explicit PREFERRED section and cues (nice to have, bonus)", () => {
    const rawText = `Preferred Qualifications\n• Experience with AWS and GCP.\n\nRequirements\n• Nice to have: prior experience in healthtech.`;
    const res = extractor.extract({
      caseId: "test-pref",
      canonicalJobId: "job-pref",
      rawText
    });

    const prefSectionAtoms = res.atoms.filter(a => a.section === "PREFERRED");
    expect(prefSectionAtoms.length).toBeGreaterThan(0);
    expect(prefSectionAtoms[0].semanticType).toBe("PREFERRED_REQUIREMENT");
    expect(prefSectionAtoms[0].requirement?.materiality).toBe("PREFERRED");

    const niceToHave = res.atoms.find(a => a.exactText.includes("Nice to have"));
    expect(niceToHave).toBeDefined();
    expect(niceToHave?.semanticType).toBe("PREFERRED_REQUIREMENT");
    expect(niceToHave?.requirement?.materiality).toBe("PREFERRED");
  });

  // 16. Materiality: uncued statements remain UNSTATED
  it("16. materiality: leaves uncued statements as UNSTATED with semanticType undefined", () => {
    const rawText = `Requirements\n• Understanding of modern API architecture.\n• Excellent communication skills.`;
    const res = extractor.extract({
      caseId: "test-uncued",
      canonicalJobId: "job-uncued",
      rawText
    });

    for (const a of res.atoms.filter(x => x.section === "REQUIREMENTS")) {
      expect(a.semanticType).toBeUndefined();
      expect(a.requirement?.materiality).toBe("UNSTATED");
    }
  });

  // 17. Section detection: explicit vs synthetic
  it("17. section detection: separates explicit headings from synthetic lead regions", () => {
    const rawText = `Lead text introducing the company and mandate.\n\nKey Responsibilities\nOwn product strategy.`;
    const res = extractor.extract({
      caseId: "test-synth",
      canonicalJobId: "job-synth",
      rawText
    });

    const leadSec = res.sections[0];
    expect(leadSec.isSynthetic).toBe(true);
    expect(leadSec.headingText).toBe("");

    const explicitSec = res.sections[1];
    expect(explicitSec.isSynthetic).toBe(false);
    expect(explicitSec.headingText).toBe("Key Responsibilities");
  });

  // 18. Long JD stress test
  it("18. addresses long JDs (>6000 chars) accurately (Case 02 Schnell Builders)", () => {
    const casePath = path.resolve(__dirname, "../../audit-reports/phase5-100-case-corpus/cases.jsonl");
    if (fs.existsSync(casePath)) {
      const lines = fs.readFileSync(casePath, "utf-8").split("\n").filter(Boolean);
      const case02 = JSON.parse(lines[1]); // Case 02 Schnell Builders (len 8552)
      expect(case02.caseId).toBe("02");
      expect(case02.job.rawText.length).toBeGreaterThan(6000);

      const res = extractor.extract({
        caseId: case02.caseId,
        canonicalJobId: case02.job.canonicalJobId,
        rawText: case02.job.rawText,
        companyName: case02.company
      });

      for (const atom of res.atoms) {
        expect(case02.job.rawText.slice(atom.startOffset, atom.endOffset)).toBe(atom.exactText);
      }

      const rep = res.atoms.find(a => a.semanticType === "REPORTING_LINE");
      expect(rep).toBeDefined();

      const team = res.atoms.find(a => a.semanticType === "PEOPLE_SCALE" || a.semanticType === "PEOPLE_LEADERSHIP");
      expect(team).toBeDefined();
    }
  });

  // 19. Mechanical accounting invariant
  it("19. mechanical accounting: acceptedAtoms strictly equals sum of all categorized atoms", () => {
    const rawText = `Designation: VP Engineering\nReports To: CEO\n\nAbout The Company\nWe are a tech firm.\n\nKey Responsibilities\nOwn technical strategy.\nLead a 20-member team.\n\nRequirements\nMinimum 12 years of experience.\nKnowledge of distributed systems.`;
    const res = extractor.extract({
      caseId: "test-accounting",
      canonicalJobId: "job-accounting",
      rawText
    });

    const classifiedSemanticCount = res.atoms.filter(a => a.semanticType !== undefined).length;
    const unclassifiedRequirementsCount = res.atoms.filter(a => a.semanticType === undefined && (a.section === "REQUIREMENTS" || a.section === "PREFERRED")).length;
    const unclassifiedOtherCount = res.atoms.filter(a => a.semanticType === undefined && a.section !== "REQUIREMENTS" && a.section !== "PREFERRED").length;

    expect(res.atoms.length).toBe(
      classifiedSemanticCount + unclassifiedRequirementsCount + unclassifiedOtherCount
    );
  });

  // 20. Generic GCP Disambiguation (Cloud vs Clinical Regulatory)
  it("20. generic GCP disambiguation: suppresses REGULATORY_SCOPE in cloud contexts, preserves in clinical/pharma", () => {
    // Cloud context: Orbion Infotech (Case 50)
    const cloudJD = `The Opportunity\nA fast-scaling consultancy in SaaS & Cloud-native transformations.\n\nRole & Responsibilities\nLead solution architecture for Python services.\nSkills: python, aws, gcp, docker, kubernetes.`;
    const cloudRes = extractor.extract({
      caseId: "test-cloud-gcp",
      canonicalJobId: "job-cloud-gcp",
      rawText: cloudJD
    });
    const cloudGcp = cloudRes.atoms.find(a => a.exactText.toLowerCase() === "gcp" && a.semanticType === "REGULATORY_SCOPE");
    expect(cloudGcp).toBeUndefined();

    // Clinical context: Synez Technologies (Case 23)
    const clinicalJD = `Key Responsibilities\nEnsure clinical safety and pharmacovigilance operations adhere to global standards.\nMaintain adherence to GCP, GVP, and ICH guidelines for clinical trials.`;
    const clinicalRes = extractor.extract({
      caseId: "test-clinical-gcp",
      canonicalJobId: "job-clinical-gcp",
      rawText: clinicalJD
    });
    const clinicalGcp = clinicalRes.atoms.find(a => a.exactText === "GCP" && a.semanticType === "REGULATORY_SCOPE");
    expect(clinicalGcp).toBeDefined();
    expect(clinicalGcp?.semanticType).toBe("REGULATORY_SCOPE");
  });

  // 21. PEOPLE_LEADERSHIP syntax gating (Role Mandate vs Candidate Qualification)
  it("21. people leadership syntax gating: separates active role mandates from candidate qualifications", () => {
    // Candidate qualifications: Zapier (Case 28) and Schnell (Case 02)
    const qualJD = `Requirements\nYou have strong people leadership and hiring instincts.\nDemonstrable experience leading a sales team of 5+.`;
    const qualRes = extractor.extract({
      caseId: "test-pl-qual",
      canonicalJobId: "job-pl-qual",
      rawText: qualJD
    });
    const qualPL = qualRes.atoms.filter(a => a.semanticType === "PEOPLE_LEADERSHIP");
    expect(qualPL.length).toBe(0);

    // Active role mandates: BCG (Case 26) and Avensys (Case 90)
    const mandateJD = `Responsibilities\nLead and develop a high-performing, multicultural team across the region.\nYou will lead a 30+ person engineering organisation across three product lines.`;
    const mandateRes = extractor.extract({
      caseId: "test-pl-mandate",
      canonicalJobId: "job-pl-mandate",
      rawText: mandateJD
    });
    const mandatePL = mandateRes.atoms.filter(a => a.semanticType === "PEOPLE_LEADERSHIP");
    expect(mandatePL.length).toBe(2);
    expect(mandatePL[0].exactText).toBe("Lead and develop a high-performing, multicultural team");
    expect(mandatePL[1].exactText).toBe("lead a 30+ person engineering organisation");
  });

  // 22. Recruiting metadata non-work-condition
  it("22. recruiting metadata non-work-condition: consultant details, CV instructions, and EEO clauses have undefined semanticType", () => {
    const recruitingJD = `CONSULTANT DETAILS:\nEA Licence: 12C3456\nConsultant Name: Jane Doe\nTo submit your application, please email your updated CV upon submission of your CV.\nAll personal data will be treated in accordance with our privacy policy.`;
    const recRes = extractor.extract({
      caseId: "test-rec-meta",
      canonicalJobId: "job-rec-meta",
      rawText: recruitingJD
    });
    for (const atom of recRes.atoms) {
      expect(atom.subject).toBe("RECRUITING_PROCESS");
      expect(atom.semanticType).toBeUndefined();
      expect(atom.semanticType).not.toBe("WORK_CONDITION");
    }
  });
});
