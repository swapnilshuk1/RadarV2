/**
 * tests/intelligence/semantic-evidence-integrity-regression.test.ts
 *
 * Primary Semantic Evidence Integrity & Boundary Regression Suite
 * 
 * Verifies:
 * 1. Rich executive JDs synthesize grounded dimensions, satisfy evidence richness,
 *    and NEVER trigger false-positive G-EVIDENCE-INTEGRITY-FAILED vetoes.
 * 2. Genuinely sparse specifications (< 25 words) are correctly caught by EvidenceGate
 *    and classified as SPARSE_SPEC without hallucinating fit.
 * 3. Authoritative veto status is cleanly decoupled from serving population tiers.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { JobProjectionBuilder, buildGroundedDimensions } from "../../src/lib/intelligence/builders/JobProjectionBuilder";
import { EvidenceRichnessCalculator } from "../../src/lib/intelligence/utils/EvidenceRichnessCalculator";
import { EvidenceGate } from "../../src/lib/intelligence/gates/EvidenceGate";
import { runEngineSingle } from "../../src/lib/intelligence/engine";
import { DEFAULT_CANDIDATE_PROJECTION } from "../../src/lib/domain/candidate_projection";
import type { OpportunitySource } from "../../src/data/opportunity-fixtures";

describe("Semantic Evidence Integrity & Boundary Invariants", () => {
  beforeEach(() => {
    JobProjectionBuilder.clearCache();
  });

  describe("Boundary 1: Rich Executive Job Description", () => {
    const richCMODescription = `
      HyperScale Tech Global is seeking a Chief Marketing Officer (CMO) to lead our global commercial growth strategy.
      
      About the Role:
      As CMO, you will report directly to the Chief Executive Officer and Board of Directors. You will own the worldwide 
      marketing P&L of $15M+, driving customer acquisition, enterprise brand positioning, and performance marketing operations.
      
      Key Responsibilities:
      - Drive global revenue growth, pipeline generation, and category leadership across North America, EMEA, and APAC.
      - Lead a high-performing team of 45+ marketing directors, growth engineers, and digital analytics specialists.
      - Lead enterprise-wide digital transformation, modernizing our customer acquisition platform and Salesforce CRM stack.
      - Own commercial accountability, multi-touch attribution, and full-funnel conversion economics.
      - Partner closely with Product and Sales leadership on Go-to-Market (GTM) strategy and international market expansion.
      
      Qualifications:
      - 15+ years of executive marketing leadership experience (VP, CMO, or Head of Growth).
      - Proven track record of scaling ARR from $50M to $250M+.
      - Deep expertise in performance marketing, commercial leadership, P&L ownership, and digital transformation.
      - Location: Bengaluru, Karnataka, India (Hybrid: 3 days in office).
    `;

    const richOpportunity: OpportunitySource = {
      jobHash: "test-rich-cmo-001",
      role: "Chief Marketing Officer",
      company: "HyperScale Tech Global",
      location: "Bengaluru, Karnataka, India",
      rawDescription: richCMODescription,
      dimensions: [],
    };

    it("synthesizes strongly-typed grounded dimensions from raw executive text", () => {
      const projection = JobProjectionBuilder.build(richOpportunity);

      expect(projection.dimensions).toBeDefined();
      expect(Array.isArray(projection.dimensions)).toBe(true);
      expect(projection.dimensions!.length).toBeGreaterThanOrEqual(4);

      const dimKeys = projection.dimensions!.map((d) => d.key);
      expect(dimKeys).toContain("operatingLevel");
      expect(dimKeys).toContain("mandate");
      expect(dimKeys).toContain("commercialScope");
      expect(dimKeys).toContain("decisionAuthority");

      // Verify explicit typed structure
      const operatingLevelDim = projection.dimensions!.find((d) => d.key === "operatingLevel");
      expect(operatingLevelDim?.jdEvidence.status).toBe("Explicit");
      expect(operatingLevelDim?.importance).toBe("Core");
    });

    it("grounds explicit end-to-end business P&L ownership as commercial scope", () => {
      const projection = JobProjectionBuilder.build({
        ...richOpportunity,
        jobHash: "futureleap-commercial-scope-regression",
        role: "Business Head",
        rawDescription: `
          Own the end-to-end P&L, revenue, profitability, margins, and overall
          business performance. Lead the D2C business, category strategy,
          sourcing, merchandising, inventory, supply chain, and operations.
        `,
      });

      expect(projection.commercialScope.value).toBe("ENTERPRISE");
      expect(projection.commercialScope.evidenceIds).toContain("cs_ent_direct_business_commercial_ownership");
      expect(projection.dimensions?.find((dimension) => dimension.key === "commercialScope")?.jdEvidence.value).toBe("ENTERPRISE");
    });

    it("does not convert generic commercial objectives into P&L authority", () => {
      const projection = JobProjectionBuilder.build({
        ...richOpportunity,
        jobHash: "generic-commercial-language-regression",
        role: "Marketing Lead",
        rawDescription: `
          Partner with sales to improve revenue outcomes and profitability.
          Support margin improvement through campaign optimization and report
          commercial metrics to the business head.
        `,
      });

      expect(projection.commercialScope.value).toBe("NONE");
      expect(projection.commercialScope.evidenceIds).toEqual(["cs_none"]);
    });

    it("records explicit qualification requirements but not responsibility-only capabilities", () => {
      const requiredProjection = JobProjectionBuilder.build({
        ...richOpportunity,
        jobHash: "required-capability-projection-regression",
        role: "Business Head",
        rawDescription: `
          Own the end-to-end P&L and lead product sourcing, merchandising,
          inventory, and supply-chain operations.
          Ideal Candidate Profile: Strong hands-on experience in D2C and
          e-commerce is required. Strong understanding of product sourcing,
          merchandising, inventory, and commercial management is required.
        `,
      });
      const merchandisingRequirement = requiredProjection.capabilityRequirements?.find(
        (requirement) => requirement.capability === "Merchandising / Category Inventory Operations",
      );

      expect(merchandisingRequirement).toMatchObject({ required: true, materiality: "CORE" });
      expect(merchandisingRequirement?.evidenceIds).toHaveLength(1);
      expect(merchandisingRequirement?.sourceQuotes[0]).toContain("merchandising");

      const responsibilityOnlyProjection = JobProjectionBuilder.build({
        ...richOpportunity,
        jobHash: "responsibility-only-capability-regression",
        role: "Business Head",
        rawDescription: `
          Own the end-to-end P&L and lead product sourcing, merchandising,
          inventory, and supply-chain operations. Partner with category teams
          to improve availability and delivery.
        `,
      });
      expect(responsibilityOnlyProjection.capabilityRequirements).toEqual([]);
    });

    it("satisfies EvidenceRichnessCalculator as SUFFICIENT", () => {
      const projection = JobProjectionBuilder.build(richOpportunity);
      const richness = EvidenceRichnessCalculator.calculate({ dimensions: projection.dimensions });

      expect(richness.sufficiency).toBe("SUFFICIENT");
      expect(richness.structuralSignalsCount).toBeGreaterThanOrEqual(2);
      expect(richness.count).toBeGreaterThanOrEqual(3);
    });

    it("evaluates to a viable executive verdict without false-positive integrity veto", () => {
      const presented = runEngineSingle(
        richOpportunity.jobHash,
        DEFAULT_CANDIDATE_PROJECTION,
        0,
        [richOpportunity]
      );

      expect(presented).toBeDefined();
      expect(presented!.record).toBeDefined();
      
      // Must NOT be vetoed by G-EVIDENCE-INTEGRITY-FAILED
      expect(presented!.record.vetoed).toBe(false);
      expect(presented!.record.verb).not.toBe("NOT_EVALUABLE");
      expect(["PURSUE", "CONSIDER"]).toContain(presented!.record.verb);
      
      // Must have a positive quantitative quality score
      expect(presented!.record.qualityScore).toBeGreaterThan(0);
      expect(presented!.record.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("Boundary 2: Genuinely Sparse Specification", () => {
    const sparseDescription = "Looking for a VP Marketing. Apply now with your resume.";

    const sparseOpportunity: OpportunitySource = {
      jobHash: "test-sparse-stub-001",
      role: "VP Marketing",
      company: "Stealth Startup",
      location: "Remote",
      rawDescription: sparseDescription,
      dimensions: [],
    };

    it("flags sparse job description via EvidenceGate without hallucinating structure", () => {
      const gateResult = EvidenceGate.evaluate(
        sparseDescription,
        sparseOpportunity.role,
        sparseOpportunity.company,
        false
      );

      expect(gateResult.evaluationStatus).toBe("SPARSE_SPEC");
      expect(gateResult.isSparse).toBe(true);
    });

    it("evaluates sparse spec to SPARSE_SPEC state with null quality score and low confidence", () => {
      const presented = runEngineSingle(
        sparseOpportunity.jobHash,
        DEFAULT_CANDIDATE_PROJECTION,
        0,
        [sparseOpportunity]
      );

      expect(presented).toBeDefined();
      expect(presented!.record.verb).toBe("SPARSE_SPEC");
      expect(presented!.record.qualityScore).toBeNull();
      expect(presented!.record.confidence).toBeLessThanOrEqual(0.35);
    });
  });

  describe("Boundary 3: Authoritative Veto vs Serving Population Tier Invariant", () => {
    it("ensures buildGroundedDimensions factory guarantees typed contract matching", () => {
      const dims = buildGroundedDimensions(
        "Chief Growth Officer",
        "Mumbai, India",
        "VP",
        "SCALE",
        "GLOBAL_PNL",
        "AUTONOMOUS",
        "HYBRID",
        "Commercial & Marketing Leadership"
      );

      expect(dims.length).toBe(6);
      expect(dims[0].key).toBe("operatingLevel");
      expect(dims[0].jdEvidence.value).toBe("VP");
      expect(dims[1].key).toBe("mandate");
      expect(dims[1].jdEvidence.value).toBe("SCALE");

      // Verify richness directly on manufactured dimensions
      const richness = EvidenceRichnessCalculator.calculate({ dimensions: dims });
      expect(richness.sufficiency).toBe("SUFFICIENT");
    });
  });
});
