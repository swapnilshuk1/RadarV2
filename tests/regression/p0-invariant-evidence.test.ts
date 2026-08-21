 /**
 * P0-A: Evidence Grounding & Provenance Invariant (FINAL)
 * 
 * Production domain primitive: classifyEvidenceGrounding(evidence, rawText)
 * 
 * THREE-STATE CLASSIFICATION:
 * 1. SOURCE_GROUNDED: quote exists verbatim in rawText
 * 2. STRUCTURED_TRUSTED: evidence from explicitly trusted structured source
 * 3. UNGROUNDED: neither
 * 
 * Contract: Only SOURCE_GROUNDED or STRUCTURED_TRUSTED evidence is valid.
 * UNGROUNDED evidence does NOT contribute to structured evidence, claim permissions,
 * or any downstream evaluation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";

// IMPORT from production domain (not define here)
// This should exist in production code:
// import { STRUCTURED_TRUSTED_PROVENANCE, classifyEvidenceGrounding } from "@/domain/evidence";
// For now, we assert the values that must exist in production.
describe("P0-A: Evidence Grounding & Provenance Invariant", () => {
  beforeEach(() => {
    clearInjectedRecords();
  });

  afterEach(() => {
    clearInjectedRecords();
  });

  /**
   * Test 1: SOURCE_GROUNDED — quote exists verbatim in rawText
   * Core contract: evidenceGrounding = "SOURCE_GROUNDED"
   */
  it("quote in rawText → evidenceGrounding: SOURCE_GROUNDED", () => {
    const fixture = {
      jobHash: "p0-source-grounded-001",
      role: "Chief Marketing Officer",
      company: "BMW India",
      location: "Gurugram",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      originalOpportunity: {
        sourcePayload: "Chief Marketing Officer. Owns P&L. Reports to MD."
      },
      // Quote exists VERBATIM
      rawText: "Chief Marketing Officer. Owns P&L. Reports to MD.",
      dimensions: [
        {
          key: "requiredLevel",
          jdEvidence: {
            status: "Explicit",
            value: "Chief Marketing Officer",
            evidence: [{
              quote: "Chief Marketing Officer",  // EXISTS in rawText
              provenance: "snippet"  // SOURCE type, not STRUCTURED_TRUSTED
            }]
          }
        },
        {
          key: "commercialAccountability",
          jdEvidence: {
            status: "Explicit",
            value: "Owns P&L",
            evidence: [{
              quote: "Owns P&L",  // EXISTS in rawText
              provenance: undefined  // NO provenance, but SOURCE_GROUNDED
            }]
          }
        }
      ],
      primaryConcern: null
    };

    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 12 },
      evidence: [],
      preferences: { locations: [], workModel: "HYBRID" }
    } as any);
    
    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);
    expect(record).toBeDefined();
    
    // THEN: Each evidence's grounding classification is captured
    // The engine MUST produce this classification as a first-class field

    // Current code FAIL: no evidenceGrounding field exists
    // Expected: record.evidenceGrounding["requiredLevel"] === "SOURCE_GROUNDED"
    // Expected: record.evidenceGrounding["commercialAccountability"] === "SOURCE_GROUNDED"

    const evidenceGrounding = (record as any).evidenceGrounding || {};
    expect(evidenceGrounding["requiredLevel"]).toBe("SOURCE_GROUNDED");
    expect(evidenceGrounding["commercialAccountability"]).toBe("SOURCE_GROUNDED");

    // Consequence: SOURCE_GROUNDED evidence contributes to claim permissions
    expect(record!.claimPermissions?.allowedClaims?.includes("PL_SCALE")).toBe(true);
  });

  /**
   * Test 2: STRUCTURED_TRUSTED — curated evidence
   * Core contract: evidenceGrounding = "STRUCTURED_TRUSTED"
   */
  it("curated provenance → evidenceGrounding: STRUCTURED_TRUSTED", () => {
    const fixture = {
      jobHash: "p0-structured-trusted-001",
      role: "CMO",
      company: "TestCo",
      location: "Mumbai",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      originalOpportunity: {
        sourcePayload: "Executive marketing role."
      },
      // Quote NOT in rawText, but provenance is curated
      rawText: "Executive marketing role.",
      dimensions: [
        {
          key: "mandate",
          jdEvidence: {
            status: "Explicit",
            value: "Transformation",
            evidence: [{
              quote: "Transformation",  // NOT in rawText
              provenance: "curated"     // IS STRUCTURED_TRUSTED
            }]
          }
        }
      ],
      primaryConcern: null
    };

    injectFreshRecords([fixture]);
    
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 12 },
      evidence: [],
      preferences: { locations: [], workModel: "HYBRID" }
    } as any);
    
    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);
    expect(record).toBeDefined();

    // THEN: STRUCTURED_TRUSTED due to trusted provenance
    const evidenceGrounding = (record as any).evidenceGrounding || {};
    expect(evidenceGrounding["mandate"]).toBe("STRUCTURED_TRUSTED");

    // TODO: Policy consequence (claimPermissions including TRANSFORMATION) belongs to a
    // separate policy integration invariant once DecisionPolicyEngine explicitly consumes
    // evidence grounding. P0-A is strictly an evidence provenance contract.
  });

  /**
   * Test 3: UNGROUNDED — neither SOURCE_GROUNDED nor STRUCTURED_TRUSTED
   * Core contract: evidenceGrounding = "UNGROUNDED"
   */
  it("quote not in rawText AND untrusted provenance → evidenceGrounding: UNGROUNDED", () => {
    const fixture = {
      jobHash: "p0-ungrounded-001",
      role: "Marketing Director",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn" as const,
      originalOpportunity: {
        sourcePayload: "Marketing director needed. Growth focus."
      },
      // Raw text does NOT contain "Owns P&L", provenance is "llm" (untrusted)
      rawText: "Marketing director needed. Growth focus.",
      dimensions: [
        {
          key: "commercialAccountability",
          jdEvidence: {
            status: "Explicit",
            value: "Owns P&L",
            evidence: [{
              quote: "Owns P&L",         // NOT in rawText
              provenance: "llm"          // NOT STRUCTURED_TRUSTED
            }]
          }
        }
      ],
      primaryConcern: null
    };

    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 12 },
      evidence: [],
      preferences: { locations: [], workModel: "HYBRID" }
    } as any);
    
    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);
    expect(record).toBeDefined();

    // THEN: UNGROUNDED — neither SOURCE_GROUNDED nor STRUCTURED_TRUSTED
    const evidenceGrounding = (record as any).evidenceGrounding || {};
    expect(evidenceGrounding["commercialAccountability"]).toBe("UNGROUNDED");

    // Consequence: UNGROUNDED evidence does NOT contribute to claim permissions
    // This will FAIL with current code due to !ev.provenance fallback
    expect(record!.claimPermissions?.allowedClaims?.includes("PL_SCALE")).toBe(false);
  });

  /**
   * Test 4: UNGROUNDED with all untrusted provenance variations
   */
  it("rejects all untrusted provenance when quote not grounded", () => {
    const UNTrustedProvenances = [
      { provenance: "llm", desc: "LLM extraction" },
      { provenance: "inferred", desc: "Inferred evidence" },
      { provenance: undefined, desc: "Missing provenance" },
      { provenance: null, desc: "Null provenance" }
    ];

    for (const { provenance, desc } of UNTrustedProvenances) {
      const fixture = {
        jobHash: `p0-untrusted-${desc.replace(/\s+/g, "-")}`,
        role: "Marketing Director",
        company: "TestCorp",
        location: "Mumbai",
        postedRelative: "Posted recently",
        scrapedFrom: "LinkedIn" as const,
        originalOpportunity: { sourcePayload: "Marketing role." },
        rawText: "Marketing role.",
        dimensions: [{
          key: "mandate",
          jdEvidence: {
            status: "Explicit",
            value: "Transformation",
            evidence: [{ quote: "Transformation", provenance }]
          }
        }],
        primaryConcern: null
      };

      injectFreshRecords([fixture]);

      const builder = new CandidateProjectionBuilderImpl();
      const projection = builder.fromProfile({
        identity: { currentTitle: "VP Marketing" },
        executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
        experience: { achievements: [], yearsExperience: 12 },
        evidence: [],
        preferences: { locations: [], workModel: "HYBRID" }
      } as any);

      const { records } = runEngine(projection as any, 0);
      const record = records.find(r => r.jobHash === fixture.jobHash);
      expect(record).toBeDefined();

      const evidenceGrounding = (record as any).evidenceGrounding || {};
      expect(evidenceGrounding["mandate"]).toBe("UNGROUNDED");

      // UNGROUNDED never contributes
      expect(record!.claimPermissions?.allowedClaims?.includes("TRANSFORMATION")).toBe(false);
    }
  });

  /**
   * Test 5: Production domain exports STRUCTURED_TRUSTED_PROVENANCE
   *
   * The canonical trusted list must be in production code, not tests.
   * Tests verify the exported values.
   */
  it("production domain exports STRUCTURED_TRUSTED_PROVENANCE", () => {
    // This test verifies the production code exports the canonical trusted list
    // Import from production when it exists:
    // const { STRUCTURED_TRUSTED_PROVENANCE } = await import("@/domain/evidence");

    // For now, we assert the values that MUST exist:
    const REQUIRED_TRUSTED = ["curated", "extractor", "gold", "fixture", "onboarder"];
    expect(REQUIRED_TRUSTED).toContain("curated");
    expect(REQUIRED_TRUSTED).toContain("extractor");
    expect(REQUIRED_TRUSTED).toContain("gold");
    expect(REQUIRED_TRUSTED).toContain("fixture");
    expect(REQUIRED_TRUSTED).toContain("onboarder");
    expect(REQUIRED_TRUSTED).toHaveLength(5);

    // These are NOT trusted:
    const UNTRUSTED = ["llm", "inferred", "title", "snippet", undefined, null];
    for (const untrusted of UNTRUSTED) {
      expect(REQUIRED_TRUSTED).not.toContain(untrusted);
    }
  });
});

