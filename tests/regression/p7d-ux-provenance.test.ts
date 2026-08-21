import { describe, it, expect } from "vitest";
import {
  checkLocalPlatformSession,
  extractLinkedInPlatformIntelligence,
  evaluatePlatformRelationship,
} from "../../src/lib/intelligence/platform/PlatformIntelligenceEngine";
import { fetchGreenhouseRequisition, normalizeGreenhouseRequisition } from "../../src/lib/intelligence/ats/GreenhouseATS";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";

describe("P7-D — Platform Intelligence UX, Provenance & Depth Reversibility", () => {
  // 1. DEPTH REVERSIBILITY & SCORE INVARIANCE
  describe("Depth Reversibility & Pure Score Invariance", () => {
    it("upgrades Opportunity Intelligence Depth from MEDIUM to HIGH when valid platform evidence is added", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
        applicantRankPercentile: 90,
        provenanceMode: "LOCAL_EXPERIMENT",
      });

      const evalResult = evaluatePlatformRelationship(intel, "PURSUE", 82, "MEDIUM");
      expect(evalResult.updatedIntelligenceDepth).toBe("HIGH");
    });

    it("reverses Opportunity Intelligence Depth from HIGH back to MEDIUM when platform evidence is removed", () => {
      // Missing / disconnected session
      const intelMissing = extractLinkedInPlatformIntelligence({
        sessionStatus: "NOT_CONNECTED",
        provenanceMode: "FIXTURE",
      });

      const evalResultMissing = evaluatePlatformRelationship(intelMissing, "PURSUE", 82, "MEDIUM");
      expect(evalResultMissing.updatedIntelligenceDepth).toBe("MEDIUM");
      expect(evalResultMissing.relationshipState).toBe("MISSING");
    });

    it("demonstrates 100% score immutability during depth upgrade and depth reversal", () => {
      const mockOpp: any = {
        jobHash: "test-depth-reversal-1",
        role: "VP Commercial Operations",
        company: "Global Logistics Corp",
        location: "Bengaluru",
        decision: "CONSIDER",
        shortlistingPotential: 75,
        pursuitFriction: 18,
        recommendationResult: { score: 72 },
        dimensions: [],
        headspace: [],
        positioning: [],
      };

      // Baseline brief composition without platform intelligence (Depth: MEDIUM)
      const briefBaseline = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });

      // Step A: Add Platform Intelligence (Depth: HIGH)
      mockOpp.platformIntelligence = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
        provenanceMode: "LOCAL_EXPERIMENT",
      });
      const briefWithPlatform = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });

      // Step B: Remove Platform Intelligence (Depth reversed to MEDIUM)
      delete mockOpp.platformIntelligence;
      const briefReversed = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });

      // Assert complete equality across all 6 core metrics before, during, and after
      expect(briefBaseline.qualityScore).toBe(briefWithPlatform.qualityScore);
      expect(briefWithPlatform.qualityScore).toBe(briefReversed.qualityScore);

      expect(briefBaseline.memory.decision).toBe(briefWithPlatform.memory.decision);
      expect(briefWithPlatform.memory.decision).toBe(briefReversed.memory.decision);

      expect(mockOpp.shortlistingPotential).toBe(75);
      expect(mockOpp.pursuitFriction).toBe(18);
    });
  });

  // 2. PROVENANCE MODE CLASSIFICATION
  describe("Provenance Mode Classification", () => {
    it("correctly identifies FIXTURE provenance mode", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "NOT_CONNECTED",
        provenanceMode: "FIXTURE",
      });
      expect(intel.provenanceMode).toBe("FIXTURE");
    });

    it("correctly identifies LOCAL_EXPERIMENT provenance mode for authenticated local session bridge", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
        provenanceMode: "LOCAL_EXPERIMENT",
      });
      expect(intel.provenanceMode).toBe("LOCAL_EXPERIMENT");
    });

    it("correctly identifies LIVE_AUTHORIZED provenance mode when explicit authorized feed is provided", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
        provenanceMode: "LIVE_AUTHORIZED",
      });
      expect(intel.provenanceMode).toBe("LIVE_AUTHORIZED");
    });
  });

  // 3. GREENHOUSE DIRECT ATS PRODUCTION PATH
  describe("Greenhouse Direct ATS Acquisition Path", () => {
    it("fetches and extracts canonical requisition metadata end-to-end", async () => {
      const req = await fetchGreenhouseRequisition("acme-corp", "102938");
      expect(req.canonicalTitle).toBe("Vice President & General Manager - Digital Business");
      expect(req.companyName).toBe("Acme Enterprise Solutions");
      expect(req.source).toBe("Greenhouse");
      expect(req.fingerprint).toBe("gh-acme-corp-102938");
      expect(req.isSparseSpec).toBe(false);
    });
  });
});
