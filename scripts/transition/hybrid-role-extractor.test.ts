/**
 * hybrid-role-extractor.test.ts
 *
 * Comprehensive tests for the Asymmetric Hybrid Role Extraction Architecture (Layers 1-5):
 * - HighRiskSemanticVerifier
 * - StructuralAdmissionEngine
 * - AsymmetricHybridRoleExtractor
 */

import { describe, it, expect } from "vitest";
import {
  HighRiskSemanticVerifier,
  identifyHighRiskFamilies,
  isHighRiskSemanticType
} from "../../src/lib/intelligence/extraction/HighRiskSemanticVerifier";
import {
  StructuralAdmissionEngine
} from "../../src/lib/intelligence/extraction/StructuralAdmissionEngine";
import {
  AsymmetricHybridRoleExtractor,
  type RichPropositionProvider
} from "../../src/lib/intelligence/extraction/AsymmetricHybridRoleExtractor";
import type { SourceUnit } from "../../src/lib/intelligence/extraction/MechanicalSourceSegmenter";
import type { GroundedSemanticProposition } from "../../src/lib/intelligence/extraction/RichSemanticPropositionContract";

describe("Layer 3: HighRiskSemanticVerifier", () => {
  const verifier = new HighRiskSemanticVerifier();

  it("identifies high-risk families correctly and ignores non-high-risk types", () => {
    expect(isHighRiskSemanticType("PNL_OWNERSHIP")).toBe(true);
    expect(isHighRiskSemanticType("REPORTING_LINE")).toBe(true);
    expect(isHighRiskSemanticType("FOUNDER_CEO_PROXIMITY")).toBe(true);
    expect(isHighRiskSemanticType("BOARD_EXPOSURE")).toBe(true);
    expect(isHighRiskSemanticType("PEOPLE_LEADERSHIP")).toBe(true);
    expect(isHighRiskSemanticType("REVENUE_ACCOUNTABILITY")).toBe(true);
    expect(isHighRiskSemanticType("PROFITABILITY_ACCOUNTABILITY")).toBe(true);
    expect(isHighRiskSemanticType("DECISION_AUTHORITY")).toBe(true);
    expect(isHighRiskSemanticType("PEOPLE_SCALE")).toBe(true);
    expect(isHighRiskSemanticType("BUDGET_SCOPE")).toBe(false);
    expect(isHighRiskSemanticType("COMMERCIAL_ACCOUNTABILITY")).toBe(false);
    expect(isHighRiskSemanticType("ROLE_PURPOSE")).toBe(false);
    expect(isHighRiskSemanticType("GEOGRAPHIC_SCOPE")).toBe(false);

    const nonHighRiskProp: GroundedSemanticProposition = {
      proposition: "Lead international expansion into APAC region",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S001"],
      canonicalTypes: ["GEOGRAPHIC_SCOPE", "RESPONSIBILITY"],
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    expect(identifyHighRiskFamilies(nonHighRiskProp)).toHaveLength(0);

    const highRiskProp: GroundedSemanticProposition = {
      proposition: "Manage full P&L and report directly to CEO",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S002"],
      canonicalTypes: ["PNL_OWNERSHIP", "REPORTING_LINE"],
      ontologyDisposition: "MAPPED",
      confidence: 0.95
    };
    const families = identifyHighRiskFamilies(highRiskProp);
    expect(families).toContain("PNL_OWNERSHIP");
    expect(families).toContain("REPORTING_LINE");
  });

  it("evaluates strict ENTAILED for unambiguous affirmative evidence", () => {
    const units: SourceUnit[] = [
      {
        spanId: "S001",
        exactText: "This executive will hold full P&L ownership for the North American division.",
        startOffset: 0,
        endOffset: 77
      },
      {
        spanId: "S002",
        exactText: "The Vice President reports directly to the Chief Executive Officer.",
        startOffset: 78,
        endOffset: 145
      },
      {
        spanId: "S003",
        exactText: "Directly manage a high-performing engineering organization of 45 engineers.",
        startOffset: 146,
        endOffset: 221
      }
    ];

    const pnlProp: GroundedSemanticProposition = {
      proposition: "Full P&L responsibility for North America",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S001"],
      canonicalTypes: ["PNL_OWNERSHIP"],
      ontologyDisposition: "MAPPED",
      confidence: 0.95
    };
    const resPnl = verifier.verifyProposition(pnlProp, units);
    expect(resPnl.verdict).toBe("ENTAILED");
    expect(resPnl.isHighRisk).toBe(true);

    const repProp: GroundedSemanticProposition = {
      proposition: "Reports directly to the CEO",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S002"],
      canonicalTypes: ["REPORTING_LINE", "FOUNDER_CEO_PROXIMITY"],
      ontologyDisposition: "MAPPED",
      confidence: 0.95
    };
    const resRep = verifier.verifyProposition(repProp, units);
    expect(resRep.verdict).toBe("ENTAILED");

    const scaleProp: GroundedSemanticProposition = {
      proposition: "Leads team of 45 engineers",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S003"],
      canonicalTypes: ["PEOPLE_LEADERSHIP", "PEOPLE_SCALE"],
      ontologyDisposition: "MAPPED",
      confidence: 0.95
    };
    const resScale = verifier.verifyProposition(scaleProp, units);
    expect(resScale.verdict).toBe("ENTAILED");
  });

  it("evaluates CONTRADICTED when evidence contains explicit negative boundary or denial", () => {
    const units: SourceUnit[] = [
      {
        spanId: "S001",
        exactText: "Individual contributor role with no direct reports and no P&L responsibility.",
        startOffset: 0,
        endOffset: 77
      },
      {
        spanId: "S002",
        exactText: "Does not report to the CEO; this role reports into the Regional Sales Director.",
        startOffset: 78,
        endOffset: 157
      }
    ];

    // Proposition falsely claims affirmative P&L
    const falsePnlProp: GroundedSemanticProposition = {
      proposition: "Has direct P&L ownership",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S001"],
      canonicalTypes: ["PNL_OWNERSHIP"],
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    const resFalsePnl = verifier.verifyProposition(falsePnlProp, units);
    expect(resFalsePnl.verdict).toBe("CONTRADICTED");

    // Proposition falsely claims CEO reporting
    const falseCeoProp: GroundedSemanticProposition = {
      proposition: "Reports to CEO",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S002"],
      canonicalTypes: ["FOUNDER_CEO_PROXIMITY"],
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    const resFalseCeo = verifier.verifyProposition(falseCeoProp, units);
    expect(resFalseCeo.verdict).toBe("CONTRADICTED");

    // But if proposition is accurately NEGATED, it entails the negation boundary
    const accurateNegatedProp: GroundedSemanticProposition = {
      proposition: "No direct P&L responsibility",
      appliesTo: "ROLE",
      polarity: "NEGATED",
      sourceEvidence: ["S001"],
      canonicalTypes: ["PNL_OWNERSHIP"],
      ontologyDisposition: "MAPPED",
      confidence: 0.95
    };
    const resAccurateNeg = verifier.verifyProposition(accurateNegatedProp, units);
    expect(resAccurateNeg.verdict).toBe("ENTAILED");
  });

  it("fails closed to INSUFFICIENT for ambiguous, vague, or uncued high-risk claims", () => {
    const units: SourceUnit[] = [
      {
        spanId: "S001",
        exactText: "Will collaborate closely with executive leadership to influence company direction.",
        startOffset: 0,
        endOffset: 83
      },
      {
        spanId: "S002",
        exactText: "Drive commercial excellence and support budget planning across business units.",
        startOffset: 84,
        endOffset: 163
      }
    ];

    // Falsely claiming CEO reporting based on "collaborate with leadership"
    const vagueCeoProp: GroundedSemanticProposition = {
      proposition: "Reports directly to the CEO",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S001"],
      canonicalTypes: ["REPORTING_LINE", "FOUNDER_CEO_PROXIMITY"],
      ontologyDisposition: "MAPPED",
      confidence: 0.8
    };
    const resVagueCeo = verifier.verifyProposition(vagueCeoProp, units);
    expect(resVagueCeo.verdict).toBe("INSUFFICIENT");

    // Falsely claiming P&L ownership based on "budget planning"
    const vaguePnlProp: GroundedSemanticProposition = {
      proposition: "Owns business unit P&L",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S002"],
      canonicalTypes: ["PNL_OWNERSHIP"],
      ontologyDisposition: "MAPPED",
      confidence: 0.8
    };
    const resVaguePnl = verifier.verifyProposition(vaguePnlProp, units);
    expect(resVaguePnl.verdict).toBe("INSUFFICIENT");
  });
});

describe("Layer 4: StructuralAdmissionEngine", () => {
  const engine = new StructuralAdmissionEngine();
  const unitMap = new Map<string, SourceUnit>([
    [
      "S001",
      {
        spanId: "S001",
        exactText: "Must have at least 10 years of prior experience managing a $100M P&L.",
        startOffset: 0,
        endOffset: 69
      }
    ],
    [
      "S002",
      {
        spanId: "S002",
        exactText: "This role does not report to the Founder.",
        startOffset: 70,
        endOffset: 110
      }
    ],
    [
      "S003",
      {
        spanId: "S003",
        exactText: "Will assume regional leadership upon milestone delivery and board approval.",
        startOffset: 111,
        endOffset: 186
      }
    ],
    [
      "S004",
      {
        spanId: "S004",
        exactText: "Founded in 2018, Acme Corp is a global fintech leader.",
        startOffset: 187,
        endOffset: 241
      }
    ],
    [
      "S005",
      {
        spanId: "S005",
        exactText: "Please send your CV and portfolio to careers@acme.com.",
        startOffset: 242,
        endOffset: 296
      }
    ]
  ]);

  it("enforces Source Evidence Grounding and rejects ungrounded propositions", () => {
    // Missing source evidence array
    const ungroundedProp1: GroundedSemanticProposition = {
      proposition: "Leads engineering team",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: [],
      canonicalTypes: ["PEOPLE_LEADERSHIP"],
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    const res1 = engine.admitProposition(0, ungroundedProp1, unitMap);
    expect(res1.status).toBe("REJECTED");
    expect(res1.rejectionReason).toContain("REJECTED_UNGROUNDED");

    // Citing nonexistent span ID
    const ungroundedProp2: GroundedSemanticProposition = {
      proposition: "Leads engineering team",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S999"],
      canonicalTypes: ["PEOPLE_LEADERSHIP"],
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    const res2 = engine.admitProposition(1, ungroundedProp2, unitMap);
    expect(res2.status).toBe("REJECTED");
    expect(res2.rejectionReason).toContain("REJECTED_UNGROUNDED");
  });

  it("enforces Applicability Boundary Discipline: CANDIDATE_REQUIREMENT cannot become ROLE authority", () => {
    // A candidate qualification mentioning past P&L experience must NOT become active ROLE PNL_OWNERSHIP!
    const candReqProp: GroundedSemanticProposition = {
      proposition: "10+ years managing $100M P&L required",
      appliesTo: "CANDIDATE_REQUIREMENT",
      polarity: "AFFIRMED",
      sourceEvidence: ["S001"],
      canonicalTypes: ["PNL_OWNERSHIP"], // LLM misassigned PNL_OWNERSHIP to candidate requirement!
      ontologyDisposition: "MAPPED",
      confidence: 0.95
    };

    const res = engine.admitProposition(0, candReqProp, unitMap);
    expect(res.status).toBe("ADMITTED_AFFIRMATIVE");
    // Structural firewall stripped PNL_OWNERSHIP and replaced it with HARD_REQUIREMENT
    expect(res.admittedTypes).toEqual(["HARD_REQUIREMENT"]);
    expect(res.admittedTypes).not.toContain("PNL_OWNERSHIP");
  });

  it("enforces Applicability Boundary Discipline: COMPANY and RECRUITING_PROCESS firewalls", () => {
    const compProp: GroundedSemanticProposition = {
      proposition: "Acme Corp is a fintech leader",
      appliesTo: "COMPANY",
      polarity: "AFFIRMED",
      sourceEvidence: ["S004"],
      canonicalTypes: ["ROLE_PURPOSE"], // LLM misassigned ROLE_PURPOSE to company overview
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    const resComp = engine.admitProposition(0, compProp, unitMap);
    expect(resComp.status).toBe("ADMITTED_AFFIRMATIVE");
    expect(resComp.admittedTypes).toEqual(["COMPANY_CONTEXT"]);
    expect(resComp.subject).toBe("COMPANY");

    const hrProp: GroundedSemanticProposition = {
      proposition: "Submit CV to careers@acme.com",
      appliesTo: "RECRUITING_PROCESS",
      polarity: "AFFIRMED",
      sourceEvidence: ["S005"],
      canonicalTypes: ["WORK_CONDITION"],
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    const resHr = engine.admitProposition(1, hrProp, unitMap);
    expect(resHr.status).toBe("REJECTED");
    expect(resHr.rejectionReason).toContain("REJECTED_APPLICABILITY");
  });

  it("enforces Polarity Discipline: NEGATED propositions cannot project affirmative facts", () => {
    const negProp: GroundedSemanticProposition = {
      proposition: "Does not report to Founder",
      appliesTo: "ROLE",
      polarity: "NEGATED",
      sourceEvidence: ["S002"],
      canonicalTypes: ["FOUNDER_CEO_PROXIMITY"],
      ontologyDisposition: "MAPPED",
      confidence: 0.95
    };
    const res = engine.admitProposition(0, negProp, unitMap);
    expect(res.status).toBe("ADMITTED_BOUNDARY_ONLY");
    expect(res.admittedTypes).toEqual([]); // Zero affirmative canonical facts!
    expect(res.boundaryDescription).toBe("Does not report to Founder");
  });

  it("enforces Modality Discipline: CONDITIONAL propositions must carry explicit condition", () => {
    // Missing condition description -> REJECTED
    const silentCondProp: GroundedSemanticProposition = {
      proposition: "Regional leadership",
      appliesTo: "ROLE",
      polarity: "CONDITIONAL",
      conditionDescription: "",
      sourceEvidence: ["S003"],
      canonicalTypes: ["DECISION_AUTHORITY"],
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    const resSilent = engine.admitProposition(0, silentCondProp, unitMap);
    expect(resSilent.status).toBe("REJECTED");
    expect(resSilent.rejectionReason).toContain("REJECTED_CONDITIONAL_UNSPECIFIED");

    // Explicit condition description -> ADMITTED_CONDITIONAL
    const validCondProp: GroundedSemanticProposition = {
      proposition: "Regional leadership",
      appliesTo: "ROLE",
      polarity: "CONDITIONAL",
      conditionDescription: "Contingent upon milestone delivery and board approval",
      sourceEvidence: ["S003"],
      canonicalTypes: ["DECISION_AUTHORITY"],
      ontologyDisposition: "MAPPED",
      confidence: 0.9
    };
    const resValid = engine.admitProposition(1, validCondProp, unitMap);
    expect(resValid.status).toBe("ADMITTED_CONDITIONAL");
    expect(resValid.conditionDescription).toBe("Contingent upon milestone delivery and board approval");
    expect(resValid.admittedTypes).toEqual(["DECISION_AUTHORITY"]);
  });

  it("fails closed when high-risk verification verdict is INSUFFICIENT", () => {
    const prop: GroundedSemanticProposition = {
      proposition: "Direct P&L ownership",
      appliesTo: "ROLE",
      polarity: "AFFIRMED",
      sourceEvidence: ["S003"],
      canonicalTypes: ["PNL_OWNERSHIP"],
      ontologyDisposition: "MAPPED",
      confidence: 0.7
    };

    const insufficientVerification = {
      verdict: "INSUFFICIENT" as const,
      highRiskFamily: "PNL_OWNERSHIP" as const,
      isHighRisk: true,
      citedEvidenceText: "Will assume regional leadership...",
      reason: "Insufficient explicit evidence in cited units to verify PNL_OWNERSHIP",
      confidence: 0.2
    };

    const res = engine.admitProposition(0, prop, unitMap, insufficientVerification);
    expect(res.status).toBe("REJECTED");
    expect(res.rejectionReason).toContain("REJECTED_INSUFFICIENT_EVIDENCE");
    expect(res.admittedTypes).toHaveLength(0);
  });
});

describe("Layers 1-5: AsymmetricHybridRoleExtractor Orchestration", () => {
  it("executes the full 5-layer pipeline preserving exact source offsets and 25 canonical types", async () => {
    const rawJD =
      "Vice President of Global Engineering\n" +
      "Reports directly to the Chief Executive Officer.\n" +
      "The VP will hold direct P&L accountability and $50M revenue target for the software division.\n" +
      "Must have a Master's degree in Computer Science.\n" +
      "Does not manage hardware operations.\n" +
      "Acme Technologies is an equal opportunity employer.";

    // Mock Proposition Provider simulating Layer 2 output
    const mockProvider: RichPropositionProvider = {
      async extractPropositions(units) {
        // units:
        // S001: Vice President of Global Engineering
        // S002: Reports directly to the Chief Executive Officer.
        // S003: The VP will hold direct P&L accountability for the $50M software division.
        // S004: Must have a Master's degree in Computer Science.
        // S005: Does not manage hardware operations.
        // S006: Acme Technologies is an equal opportunity employer.
        return [
          {
            proposition: "Reports directly to the CEO",
            appliesTo: "ROLE",
            polarity: "AFFIRMED",
            sourceEvidence: ["S002"],
            canonicalTypes: ["REPORTING_LINE", "FOUNDER_CEO_PROXIMITY"],
            ontologyDisposition: "MAPPED",
            confidence: 0.95
          },
          {
            proposition: "Direct P&L accountability for software division",
            appliesTo: "ROLE",
            polarity: "AFFIRMED",
            sourceEvidence: ["S003"],
            canonicalTypes: ["PNL_OWNERSHIP", "REVENUE_ACCOUNTABILITY"],
            ontologyDisposition: "MAPPED",
            confidence: 0.95
          },
          {
            proposition: "Master's degree in Computer Science required",
            appliesTo: "CANDIDATE_REQUIREMENT",
            polarity: "AFFIRMED",
            sourceEvidence: ["S004"],
            canonicalTypes: ["HARD_REQUIREMENT"],
            ontologyDisposition: "MAPPED",
            confidence: 0.98
          },
          {
            proposition: "Does not manage hardware operations",
            appliesTo: "ROLE",
            polarity: "NEGATED",
            sourceEvidence: ["S005"],
            canonicalTypes: ["RESPONSIBILITY"],
            ontologyDisposition: "MAPPED",
            confidence: 0.95
          }
        ];
      }
    };

    const extractor = new AsymmetricHybridRoleExtractor();
    const result = await extractor.extract(rawJD, mockProvider, {
      title: "Vice President of Global Engineering",
      companyName: "Acme Technologies"
    });

    expect(result.sourceUnits.length).toBeGreaterThan(0);
    expect(result.propositions).toHaveLength(4);

    // Check verification results
    expect(result.metrics.highRiskEntailedCount).toBe(2); // CEO reporting + P&L
    expect(result.metrics.highRiskInsufficientCount).toBe(0);

    // Check admitted and boundary decisions
    expect(result.metrics.admittedAffirmativeCount).toBe(3);
    expect(result.metrics.admittedBoundariesCount).toBe(1); // hardware operations negated boundary
    expect(result.negativeBoundaries).toContain("Does not manage hardware operations");

    // Check canonical facts
    expect(result.canonicalFacts.length).toBeGreaterThanOrEqual(4);

    // Invariant: Exact source text matching for 100% of canonical facts
    for (const fact of result.canonicalFacts) {
      const sliced = rawJD.slice(fact.startOffset, fact.endOffset);
      expect(sliced).toBe(fact.exactText);
      expect(fact.polarity).toBe("AFFIRMED");
    }

    const types = result.canonicalFacts.map(f => f.canonicalType);
    expect(types).toContain("REPORTING_LINE");
    expect(types).toContain("FOUNDER_CEO_PROXIMITY");
    expect(types).toContain("PNL_OWNERSHIP");
    expect(types).toContain("HARD_REQUIREMENT");
  });
});
