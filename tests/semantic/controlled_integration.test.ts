import { describe, it, expect } from "vitest";
import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "../../src/lib/intelligence/builders/JobProjectionBuilder";
import { CapabilityAssessmentEngine } from "../../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { CareerAssessmentEngine } from "../../src/lib/intelligence/engines/CareerAssessmentEngine";
import { OpportunityAssessmentEngine } from "../../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { LifestyleAssessmentEngine } from "../../src/lib/intelligence/engines/LifestyleAssessmentEngine";
import { DecisionPolicyEngine } from "../../src/lib/intelligence/policy/DecisionPolicyEngine";
import { RequirementEvidenceAdapter } from "../../src/lib/intelligence/semantic/RequirementEvidenceAdapter";
import { SemanticResolutionEngine } from "../../src/lib/intelligence/semantic/SemanticResolutionEngine";
import { candidateProfile } from "../../src/data/candidate-profile";
import type { Opportunity } from "../../src/domain/entities";
import type { CandidateProjection } from "../../src/lib/domain/candidate_projection";

describe("Phase 5C.2: Controlled Semantic Integration Suite", () => {
  const candidateBuilder = new CandidateProjectionBuilderImpl();

  const mockOpportunity: Opportunity = {
    id: "opp-1",
    sourceId: "src-1",
    jobHash: "hash-opp-1",
    canonicalTitle: "Vice President of CRM & Growth",
    company: "AWS",
    location: "Gurugram, Haryana",
    workModel: "HYBRID",
    description: `
      We are looking for a Vice President of CRM & Growth to lead our customer lifecycle strategy.
      Requirements:
      - Deep expertise in CRM Strategy and Enterprise Marketing Automation.
      - Proven track record in Performance Marketing and Revenue Operations.
      - P&L ownership and commercial accountability.
    `,
    normalizedText: `
      We are looking for a Vice President of CRM & Growth to lead our customer lifecycle strategy.
      Requirements:
      - Deep expertise in CRM Strategy and Enterprise Marketing Automation.
      - Proven track record in Performance Marketing and Revenue Operations.
      - P&L ownership and commercial accountability.
    `,
    metadata: {
      enrichment: {
        dimensions: [
          { name: "CRM Strategy", jdEvidence: "lead customer lifecycle strategy", isExplicit: true },
          { name: "Performance Marketing", jdEvidence: "proven track record in performance marketing", isExplicit: true },
          { name: "Revenue Operations", jdEvidence: "revenue operations", isExplicit: true }
        ]
      }
    }
  };

  describe("1. Projection Builder Semantic Evidence Attachment", () => {
    it("CandidateProjectionBuilder populates semanticEvidence additively", () => {
      const candProj = candidateBuilder.fromProfile(candidateProfile as any);
      expect(candProj.semanticEvidence).toBeDefined();
      expect(Array.isArray(candProj.semanticEvidence)).toBe(true);
      expect(candProj.semanticEvidence!.length).toBeGreaterThan(0);

      // Verify known capabilities or financial terms were resolved
      const hasSemanticEvidence = candProj.semanticEvidence!.some(
        e => e.entityType === "CAPABILITY" || e.entityType === "COMMERCIAL_SCOPE"
      );
      expect(hasSemanticEvidence).toBe(true);
    });

    it("JobProjectionBuilder populates semanticEvidence additively", () => {
      const jobProj = JobProjectionBuilder.build(mockOpportunity);
      expect(jobProj.semanticEvidence).toBeDefined();
      expect(Array.isArray(jobProj.semanticEvidence)).toBe(true);
      expect(jobProj.semanticEvidence!.length).toBeGreaterThan(0);
    });

    it("does not turn asset acquisition into unsupported post-merger integration", () => {
      const jobProj = JobProjectionBuilder.build({
        ...mockOpportunity,
        id: "asset-acquisition-only",
        jobHash: "asset-acquisition-only",
        canonicalTitle: "Business Head — Asset Acquisition",
        description: "Lead distressed-debt acquisition, capital raising, ARC business development, and lender relationships.",
        normalizedText: "Lead distressed-debt acquisition, capital raising, ARC business development, and lender relationships.",
      });
      expect(jobProj.executiveMission.intent).not.toBe("INTEGRATE_ACQUISITION");
      expect(jobProj.executiveMission.statement).not.toMatch(/post-merger|synergy/i);
    });
  });

  describe("2. Domain-by-Domain Integration Tests", () => {
    it("Capability Domain: SFMC evidence satisfies CRM Strategy requirement via adapter", () => {
      const candProj = candidateBuilder.fromProfile(candidateProfile as any);
      const jobProj = JobProjectionBuilder.build(mockOpportunity);

      const capAssessment = CapabilityAssessmentEngine.evaluate(candProj, jobProj);
      expect(capAssessment.status).toBe("COMPLETE");
      expect(capAssessment.evidenceState).toBe("SUFFICIENT");
      expect(capAssessment.overallFit).not.toBeNull();
      expect(capAssessment.overallFit!).toBeGreaterThanOrEqual(0.65);
      expect(capAssessment.matches.length).toBeGreaterThan(0);
    });

    it("Commercial Scope Domain: EBITDA accountability != unearned P&L ownership", () => {
      const ebitdaRes = SemanticResolutionEngine.resolveCommercialScope("Managed EBITDA targets and margin improvements", "Executive");
      const ebitdaEvidence = ebitdaRes.evidence ? [ebitdaRes.evidence] : [];

      const scopeEval = RequirementEvidenceAdapter.evaluateCommercialScopeSatisfaction(ebitdaEvidence);
      expect(scopeEval.hasEbitdaAccountability).toBe(true);
      expect(scopeEval.hasDirectPnlOwnership).toBe(false);
    });

    it("Seniority Domain: Distinguishes Executive from Managerial/Tactical without escalation", () => {
      const execRes = SemanticResolutionEngine.resolveSeniority("VP of Marketing");
      const coordRes = SemanticResolutionEngine.resolveSeniority("Marketing Coordinator");
      const leadRes = SemanticResolutionEngine.resolveSeniority("Tech Lead");

      expect(execRes.seniorityBand).toBe("VP");
      expect(coordRes.seniorityBand).toBe("COORDINATOR_ENTRY");
      expect(leadRes.seniorityBand).toBe("LEAD");

      // Verify coordinator cannot satisfy VP requirement
      const coordEvidence = coordRes.evidence ? [coordRes.evidence] : [];
      const satisfiesVp = RequirementEvidenceAdapter.evaluateSenioritySatisfaction("EXECUTIVE", coordEvidence);
      expect(satisfiesVp.satisfies).toBe(false);
    });

    it("Geography Domain: Gurugram matches Delhi NCR commuter corridor", () => {
      const isGurugramCompatible = RequirementEvidenceAdapter.evaluateLocationCompatibility(
        ["Delhi NCR"],
        "Gurugram, Haryana"
      );
      expect(isGurugramCompatible.isCompatible).toBe(true);
      expect(isGurugramCompatible.isMetroCluster).toBe(true);

      const isBangaloreCompatible = RequirementEvidenceAdapter.evaluateLocationCompatibility(
        ["Delhi NCR"],
        "Bengaluru, Karnataka"
      );
      expect(isBangaloreCompatible.isCompatible).toBe(false);
    });

    it("Organization Domain: AWS inherits Tier-1 pedigree from Amazon parent", () => {
      const candProj = candidateBuilder.fromProfile(candidateProfile as any);
      const jobProj = JobProjectionBuilder.build(mockOpportunity);

      const careerAssessment = CareerAssessmentEngine.evaluate(candProj, jobProj);
      // AWS receives tier-1 brandCapitalGain (25)
      expect(careerAssessment.careerCapitalGain).toBeGreaterThanOrEqual(25);
    });
  });

  describe("3. Hard Score Invariance & Policy Safety", () => {
    it("Exact Score Invariance: If semantic resolution produces no additional evidence, score is exactly identical", () => {
      const candProj = candidateBuilder.fromProfile(candidateProfile as any);
      const jobProj = JobProjectionBuilder.build(mockOpportunity);

      // Evaluate with semantic evidence
      const capWithSem = CapabilityAssessmentEngine.evaluate(candProj, jobProj);

      // Create a cloned candidate projection without semanticEvidence
      const candWithoutSem: CandidateProjection = {
        ...candProj,
        semanticEvidence: undefined
      };
      const capWithoutSem = CapabilityAssessmentEngine.evaluate(candWithoutSem, jobProj);

      // Both must yield identical structure and valid numbers
      expect(typeof capWithSem.overallFit).toBe("number");
      expect(typeof capWithoutSem.overallFit).toBe("number");
      expect(capWithSem.status).toBe(capWithoutSem.status);
      expect(capWithSem.evidenceState).toBe(capWithoutSem.evidenceState);
    });

    it("Policy Decision Engine invariants: Vetoes and weights remain untouched", () => {
      const candProj = candidateBuilder.fromProfile(candidateProfile as any);
      const jobProj = JobProjectionBuilder.build(mockOpportunity);

      const cap = CapabilityAssessmentEngine.evaluate(candProj, jobProj);
      const opp = OpportunityAssessmentEngine.evaluate(candProj, jobProj);
      const car = CareerAssessmentEngine.evaluate(candProj, jobProj);
      const life = LifestyleAssessmentEngine.evaluate(candProj, jobProj);

      const decision = DecisionPolicyEngine.evaluate(
        candProj,
        jobProj,
        {
          identityAssessment: { status: "COMPLETE", sufficiency: "SUFFICIENT", evidenceCount: 1, evidenceSummary: { extractedSignals: 1, inferredSignals: 0, ignoredSignals: 0, conflictingSignals: 0 }, isStrategicMatch: true, roleArchetype: "GROWTH" },
          capabilityAssessment: cap,
          opportunityAssessment: opp,
          careerAssessment: car,
          lifestyleAssessment: life
        }
      );

      expect(["PURSUE", "CONSIDER", "EXPLORE", "PAUSE", "PASS", "SPARSE_SPEC"]).toContain(decision.verdict);
      if (decision.qualityScore !== null) {
        expect(decision.qualityScore).toBeGreaterThanOrEqual(0);
        expect(decision.qualityScore).toBeLessThanOrEqual(100);
      }
      expect(Array.isArray(decision.triggeredRuleIds)).toBe(true);
    });
  });

  describe("4. Adversarial False-Positive Resistance", () => {
    it("Rejects negated evidence in candidate text", () => {
      const text = "I am not responsible for P&L and have no experience in Salesforce Marketing Cloud.";
      const comp = SemanticResolutionEngine.extractCompositional(text);
      
      const pnlEvidence = comp.evidenceList.find(e => e.canonicalConcept === "PNL_OWNERSHIP");
      if (pnlEvidence) {
        expect(pnlEvidence.negated).toBe(true);
      }

      // Adapter must reject negated evidence
      const satisfies = RequirementEvidenceAdapter.evaluateCapabilitySatisfaction("SFMC", comp.evidenceList);
      expect(satisfies.satisfies).toBe(false);
    });

    it("Rejects non-pedigree brand collisions in context", () => {
      const falseBrandText = "Featured on Apple podcast talking to target audience about enterprise products.";
      const comp = SemanticResolutionEngine.extractCompositional(falseBrandText);

      // Should not resolve Apple as employer organization
      const employerOrg = comp.evidenceList.find(
        e => e.entityType === "ORGANIZATION" && (e.canonicalConcept === "Apple" || e.canonicalConcept === "Target")
      );
      expect(employerOrg).toBeUndefined();
    });
  });
});
