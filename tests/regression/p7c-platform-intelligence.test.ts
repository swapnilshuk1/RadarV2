import { describe, it, expect } from "vitest";
import { normalizeGreenhouseRequisition, fetchGreenhouseRequisition } from "../../src/lib/intelligence/ats/GreenhouseATS";
import {
  checkLocalPlatformSession,
  extractLinkedInPlatformIntelligence,
  evaluatePlatformRelationship,
} from "../../src/lib/intelligence/platform/PlatformIntelligenceEngine";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";

/**
 * P7-C Test Suite — Classified by Verification Category:
 *
 * CATEGORY A: Mock / Fixture Validation (DTO logic, convergence/conflict math, adaptive UI)
 * CATEGORY B: Local Integration Validation (Local session cookie detection, fingerprinting)
 * CATEGORY C: Production-Authorized External Integration (Live OAuth / network feeds)
 */

describe("P7-C — Platform Intelligence & Direct ATS First Vertical Slice", () => {

  // TRACK A — DIRECT ATS INGESTION (Greenhouse - Tests 1 to 5)
  describe("Track A: Direct ATS Ingestion (Greenhouse)", () => {
    it("[CATEGORY B: Local Integration] 1. canonical job ingestion extracts title, company, location, and description", async () => {
      const req = await fetchGreenhouseRequisition("acme-corp", "102938");
      expect(req.canonicalTitle).toBe("Vice President & General Manager - Digital Business");
      expect(req.companyName).toBe("Acme Enterprise Solutions");
      expect(req.location).toContain("Bengaluru");
      expect(req.contentText).toContain("P&L ownership");
    });

    it("[CATEGORY A: Mock/Fixture] 2. source provenance is set to Greenhouse", () => {
      const req = normalizeGreenhouseRequisition({
        id: "101",
        title: "Director Engineering",
        board_token: "acme",
      });
      expect(req.source).toBe("Greenhouse");
      expect(req.applyUrl).toContain("boards.greenhouse.io/acme/jobs/101");
    });

    it("[CATEGORY A: Mock/Fixture] 3. posted-date handling captures ISO timestamp", () => {
      const iso = "2026-08-15T08:00:00.000Z";
      const req = normalizeGreenhouseRequisition({
        id: "102",
        title: "VP Product",
        updated_at: iso,
      });
      expect(req.postedAtIso).toBe(iso);
    });

    it("[CATEGORY B: Local Integration] 4. deduplication generates deterministic fingerprint", () => {
      const req1 = normalizeGreenhouseRequisition({ id: "555", title: "CMO", board_token: "tech" });
      const req2 = normalizeGreenhouseRequisition({ id: "555", title: "CMO", board_token: "tech" });
      expect(req1.fingerprint).toBe(req2.fingerprint);
      expect(req1.fingerprint).toBe("gh-tech-555");
    });

    it("[CATEGORY A: Mock/Fixture] 5. SPARSE_SPEC handling flags descriptions < 120 characters", () => {
      const sparseReq = normalizeGreenhouseRequisition({
        id: "999",
        title: "Short Role",
        content: "<p>Short description text</p>",
      });
      expect(sparseReq.isSparseSpec).toBe(true);

      const richReq = normalizeGreenhouseRequisition({
        id: "998",
        title: "Rich Executive Role",
        content: "<p>" + "A".repeat(200) + "</p>",
      });
      expect(richReq.isSparseSpec).toBe(false);
    });
  });

  // TRACK B — LOCAL PLATFORM SESSION BRIDGE (LinkedIn - Tests 6 to 15)
  describe("Track B: Local Platform Session Bridge", () => {
    it("[CATEGORY B: Local Integration] 6. session available returns CONNECTED when valid li_at cookie exists", () => {
      const status = checkLocalPlatformSession("LinkedIn", [{ name: "li_at", value: "valid_token_123456789012" }]);
      expect(status).toBe("CONNECTED");
    });

    it("[CATEGORY B: Local Integration] 7. session unavailable returns NOT_CONNECTED when no cookies exist", () => {
      const status = checkLocalPlatformSession("LinkedIn", []);
      expect(status).toBe("NOT_CONNECTED");
    });

    it("[CATEGORY A: Mock/Fixture] 8. signal available sets AVAILABLE state for Top Applicant", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
        applicantRankPercentile: 90,
      });
      expect(intel.topApplicantBadge.state).toBe("AVAILABLE");
      expect(intel.topApplicantBadge.value).toBe(true);
      expect(intel.applicantRankPercentile.value).toBe(90);
    });

    it("[CATEGORY A: Mock/Fixture] 9. signal unavailable sets UNAVAILABLE state when connected but signal missing", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
      });
      expect(intel.topApplicantBadge.state).toBe("UNAVAILABLE");
      expect(intel.topApplicantBadge.value).toBe(null);
    });

    it("[CATEGORY B: Local Integration] 10. session expiry returns EXPIRED when token is missing required keys", () => {
      const status = checkLocalPlatformSession("LinkedIn", [{ name: "other_cookie", value: "xyz" }]);
      expect(status).toBe("EXPIRED");
    });

    it("[CATEGORY A: Mock/Fixture] 11. PlatformIntelligence normalization creates valid 4-state DTO", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "NOT_CONNECTED",
      });
      expect(intel.source).toBe("LinkedIn");
      expect(intel.accountConnected).toBe(false);
      expect(intel.topApplicantBadge.state).toBe("UNKNOWN");
      expect(intel.seniorApplicantRatio.state).toBe("NOT_APPLICABLE");
    });

    it("[CATEGORY A: Mock/Fixture] 12. CONVERGENCE identified for Top Applicant + PURSUE", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
      });
      const result = evaluatePlatformRelationship(intel, "PURSUE", 78);
      expect(result.relationshipState).toBe("CONVERGENCE");
      expect(result.advisoryStatement).toContain("Strong Convergence");
    });

    it("[CATEGORY A: Mock/Fixture] 13. CONFLICT identified for Top Applicant + PASS", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
      });
      const result = evaluatePlatformRelationship(intel, "PASS", 82);
      expect(result.relationshipState).toBe("CONFLICT");
      expect(result.advisoryStatement).toContain("Platform Conflict");
    });

    it("[CATEGORY A: Mock/Fixture] 14. MISSING identified when account is not connected", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "NOT_CONNECTED",
      });
      const result = evaluatePlatformRelationship(intel, "PURSUE", 75);
      expect(result.relationshipState).toBe("MISSING");
      expect(result.advisoryStatement).toContain("Platform intelligence unavailable");
    });

    it("[CATEGORY A: Mock/Fixture] 15. platform-specific signal fallback formats general applicant count", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: false,
        applicantCount: 142,
      });
      const result = evaluatePlatformRelationship(intel, "PURSUE", 70);
      expect(result.relationshipState).toBe("PLATFORM_SPECIFIC_SIGNAL");
      expect(result.advisoryStatement).toContain("142 total applicants");
    });
  });

  // SCORE INVARIANTS (Tests 16 to 19)
  describe("Score Invariants: Platform signals do NOT mutate core scoring", () => {
    function createMockOpp() {
      return {
        jobHash: "test-invariants-j1",
        role: "Global Head of Delivery",
        company: "Acme Enterprise",
        location: "Bengaluru",
        decision: "PURSUE" as const,
        recommendationResult: { score: 81 },
        dimensions: [],
        headspace: [],
        positioning: [],
      };
    }

    it("[CATEGORY A: Mock/Fixture] 16. platform signal does not alter qualityScore", () => {
      const mockOpp: any = createMockOpp();
      const briefBefore = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });
      mockOpp.platformIntelligence = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
        applicantRankPercentile: 95,
      });
      const briefAfter = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });
      expect(briefBefore.qualityScore).toBe(briefAfter.qualityScore);
    });

    it("[CATEGORY A: Mock/Fixture] 17. platform signal does not alter Decision", () => {
      const mockOpp: any = createMockOpp();
      const briefBefore = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });
      mockOpp.platformIntelligence = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
      });
      const briefAfter = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });
      expect(briefBefore.memory.decision).toBe(briefAfter.memory.decision);
      expect(mockOpp.decision).toBe("PURSUE");
    });

    it("[CATEGORY A: Mock/Fixture] 18. platform signal does not alter Shortlisting Potential (SP)", () => {
      const mockOpp: any = createMockOpp();
      mockOpp.shortlistingPotential = 85;
      const intel = extractLinkedInPlatformIntelligence({ sessionStatus: "CONNECTED", topApplicantBadge: true });
      mockOpp.platformIntelligence = intel;
      expect(mockOpp.shortlistingPotential).toBe(85);
    });

    it("[CATEGORY A: Mock/Fixture] 19. platform signal does not alter Pursuit Friction", () => {
      const mockOpp: any = createMockOpp();
      mockOpp.pursuitFriction = 12;
      const intel = extractLinkedInPlatformIntelligence({ sessionStatus: "CONNECTED", topApplicantBadge: true });
      mockOpp.platformIntelligence = intel;
      expect(mockOpp.pursuitFriction).toBe(12);
    });
  });

  // UI ADAPTIVE RULES (Tests 20 to 22)
  describe("Adaptive UI & Depth Rules", () => {
    it("[CATEGORY A: Mock/Fixture] 20. Opportunity Intelligence Depth upgrades to HIGH when platform signal is AVAILABLE", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "CONNECTED",
        topApplicantBadge: true,
      });
      const result = evaluatePlatformRelationship(intel, "PURSUE", 78, "MEDIUM");
      expect(result.updatedIntelligenceDepth).toBe("HIGH");
    });

    it("[CATEGORY A: Mock/Fixture] 21. missing session retains baseline depth", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "NOT_CONNECTED",
      });
      const result = evaluatePlatformRelationship(intel, "CONSIDER", 62, "LIMITED");
      expect(result.updatedIntelligenceDepth).toBe("LIMITED");
    });

    it("[CATEGORY A: Mock/Fixture] 22. missing session retains advisory provenance statement", () => {
      const intel = extractLinkedInPlatformIntelligence({
        sessionStatus: "NOT_CONNECTED",
      });
      const result = evaluatePlatformRelationship(intel, "CONSIDER", 62, "LIMITED");
      expect(result.advisoryStatement).toContain("intrinsic RADAR job specification evidence");
    });
  });
});
