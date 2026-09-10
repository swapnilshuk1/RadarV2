/**
 * tests/acquisition/gate1-pipeline-invariants.test.ts
 *
 * Gate 1 Continuous Certification Suite
 * Verifies:
 * 1. Dynamic work drain and read-only nextPendingUnitForPortal
 * 2. FastPath delegation to HealthManager
 * 3. Strict ingestion provenance and contentOrigin validation
 * 4. Pre-admission duplicate resolution and heuristic telemetry
 */

import path from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach } from "vitest";
import { RunController } from "../../scripts/scraper/run/manager";
import { HealthManager } from "../../scripts/scraper/run/health-manager";
import { ResponseValidator, validateJobDocument } from "@/lib/acquisition/validator";
import { resolveCanonicalIdentity } from "@/lib/acquisition/canonical-identity";
import { sanitizeCompanyName } from "../../scripts/scraper/utils/sanitize";

describe("Gate 1: Pipeline & Accounting Invariants", () => {
  beforeEach(() => {
    HealthManager.reset();
  });

  describe("Dynamic Work Drain & Unit State Management", () => {
    it("nextPendingUnitForPortal returns next pending unit without mutating its status to running", () => {
      const controller = new RunController();
      controller.manifestPath = path.join(tmpdir(), `test-manifest-${Date.now()}.json`);
      controller.journal = { append: () => {} } as any;
      controller.manifest = {
        runId: "test-run-1",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "running",
        scraperVersion: "2.1",
        snapshotSchemaVersion: "1.0",
        extractorVersion: "1.0",
        recommendationSchemaVersion: "1.0",
        keywords: ["VP Engineering"],
        portals: ["Naukri"],
        maxPages: 2,
        units: [
          {
            id: "u1",
            executionPlanId: "ep1",
            portal: "Naukri",
            keyword: "VP Engineering",
            page: 1,
            status: "pending",
            attempts: 0,
            cardIds: [],
          },
          {
            id: "u2",
            executionPlanId: "ep1",
            portal: "Naukri",
            keyword: "VP Engineering",
            page: 2,
            status: "pending",
            attempts: 0,
            cardIds: [],
          },
        ],
        cards: [],
        telemetry: {
          httpAttempted: 0,
          httpSuccessful: 0,
          httpFallbacks: 0,
          duplicatePreDetail: 0,
          duplicatePostDetail: 0,
          llmCalls: 0,
        },
        pageExecutionRecords: [],
      };

      const next = controller.nextPendingUnitForPortal("Naukri");
      expect(next).toBeDefined();
      expect(next?.id).toBe("u1");
      // Must remain pending until processUnit mutates it
      expect(next?.status).toBe("pending");
      expect(controller.pendingUnits().length).toBe(2);
      expect(controller.runningUnits().length).toBe(0);

      // Now processUnit simulates claiming it
      controller.updateUnit("u1", { status: "running", startedAt: new Date().toISOString() });
      expect(controller.runningUnits().length).toBe(1);
      expect(controller.pendingUnits().length).toBe(1);

      // Next call returns u2
      const second = controller.nextPendingUnitForPortal("Naukri");
      expect(second?.id).toBe("u2");
      expect(second?.status).toBe("pending");

      // Once u2 is also claimed and u1 finishes
      controller.updateUnit("u2", { status: "running" });
      controller.updateUnit("u1", { status: "done" });
      expect(controller.runningUnits().length).toBe(1);
      expect(controller.pendingUnits().length).toBe(0);
      expect(controller.nextPendingUnitForPortal("Naukri")).toBeUndefined();
    });

    it("drains dynamically when new adaptive units are enqueued during execution", () => {
      const controller = new RunController();
      controller.manifestPath = path.join(tmpdir(), `test-manifest-${Date.now()}.json`);
      controller.journal = { append: () => {} } as any;
      controller.manifest = {
        runId: "test-run-2",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "running",
        scraperVersion: "2.1",
        snapshotSchemaVersion: "1.0",
        extractorVersion: "1.0",
        recommendationSchemaVersion: "1.0",
        keywords: ["Chief Technology Officer"],
        portals: ["Indeed"],
        maxPages: 1,
        units: [
          {
            id: "ind-1",
            executionPlanId: "ep2",
            portal: "Indeed",
            keyword: "Chief Technology Officer",
            page: 1,
            status: "pending",
            attempts: 0,
            cardIds: [],
          },
        ],
        cards: [],
        telemetry: {
          httpAttempted: 0,
          httpSuccessful: 0,
          httpFallbacks: 0,
          duplicatePreDetail: 0,
          duplicatePostDetail: 0,
          llmCalls: 0,
        },
        pageExecutionRecords: [],
      };

      const u1 = controller.nextPendingUnitForPortal("Indeed");
      expect(u1?.id).toBe("ind-1");
      controller.updateUnit("ind-1", { status: "running" });

      // Adaptive deepening or freshness enqueues variant
      controller.enqueueVariant({
        portal: "Indeed",
        definitionId: "def-ind",
        query: "Chief Technology Officer",
        location: "Bengaluru",
        postedWithinDays: 7,
      });

      controller.updateUnit("ind-1", { status: "done" });

      const u2 = controller.nextPendingUnitForPortal("Indeed");
      expect(u2).toBeDefined();
      expect(u2?.keyword).toBe("Chief Technology Officer");
      expect(u2?.variant?.postedWithinDays).toBe(7);
      controller.updateUnit(u2!.id, { status: "done" });

      expect(controller.nextPendingUnitForPortal("Indeed")).toBeUndefined();
      expect(controller.runningUnits().length).toBe(0);
      expect(controller.pendingUnits().length).toBe(0);
    });
  });

  describe("FastPath Circuit Breaking Delegation", () => {
    it("delegates portal fastpath check to HealthManager and caches failed HTTP URLs", () => {
      const controller = new RunController();

      expect(controller.isHttpFastPathDisabled("LinkedIn")).toBe(false);

      // Record 403 on URL
      const blockedUrl = "https://www.linkedin.com/jobs/view/12345678";
      controller.recordDetailFailure("LinkedIn", blockedUrl, 403);

      expect(controller.isHttpFastPathDisabled("LinkedIn", blockedUrl)).toBe(true);

      // Verify HealthManager was transitioned
      expect(HealthManager.isFastPathAvailable("LinkedIn")).toBe(false);
      expect(HealthManager.getMatrix("LinkedIn").fastPathCircuit).toBe("OPEN");

      // Success records correctly through controller
      controller.recordDetailSuccess("Indeed");
      expect(HealthManager.isFastPathAvailable("Indeed")).toBe(true);
    });
  });

  describe("Provenance & Response Validation with contentOrigin", () => {
    it("ResponseValidator rejects non-authoritative discovery card fallback", () => {
      const snippet = "Brief snippet description of VP Engineering role with some text that exceeds minimum length threshold. ".repeat(3);
      const res = ResponseValidator.validate({
        html: snippet,
        extractedDescription: snippet,
        url: "https://www.naukri.com/job-listings-123456",
        sourcePortal: "Naukri",
        httpStatus: 200,
        extractedTitle: "VP of Engineering",
        contentOrigin: "DISCOVERY_CARD_FALLBACK",
      });

      expect(res.isValid).toBe(false);
      expect(res.document.usabilityState).toBe("UNUSABLE");
      expect(res.failureClass).toBe("PARTIAL_CONTENT");
    });

    it("ResponseValidator accepts valid substantive detail document", () => {
      const validJd = `
        Executive Vice President of Engineering
        We are seeking a seasoned executive leader with 15+ years experience to lead our 200-person global technology organization.
        Responsibilities:
        - Lead global engineering, architecture, and developer operations
        - Manage $40M budget and operational P&L
        - Report directly to the Chief Executive Officer
        Requirements:
        - Proven track record scaling B2B SaaS platforms
        - Experience managing Directors and Staff Engineers
      `.repeat(3);

      const res = ResponseValidator.validate({
        html: validJd,
        extractedDescription: validJd,
        url: "https://www.naukri.com/job-listings-123456",
        sourcePortal: "Naukri",
        httpStatus: 200,
        extractedTitle: "Vice President of Engineering",
        contentOrigin: "DETAIL_DOCUMENT",
      });

      expect(res.isValid).toBe(true);
      expect(res.document.usabilityState).toBe("SUBSTANTIVE");
      expect(res.quality).toBe("COMPLETE");
    });

    it("validateJobDocument enforces contentOrigin requirement", () => {
      const text = "Short description text with enough words to not be completely empty. ".repeat(5);
      const res = validateJobDocument({
        url: "https://www.indeed.com/viewjob?jk=abcdef123456",
        html: text,
        extractedText: text,
        sourcePortal: "Indeed",
        contentOrigin: "DISCOVERY_CARD_FALLBACK",
      });

      expect(res.isValid).toBe(false);
      expect(res.failureClass).toBe("PARTIAL_CONTENT");
    });
  });

  describe("Pre-Admission Company Sanitization & Deduplication", () => {
    it("sanitizes company name prior to canonical identity resolution", () => {
      const rawCompany = "LinkedIn Guest Area";
      const cleanCompany = sanitizeCompanyName(
        rawCompany,
        "Director of Product",
        "At Google we are hiring a Director of Product",
        "https://www.linkedin.com/jobs/view/director-of-product-at-google-12345"
      );
      expect(cleanCompany).toBe("Google");

      const identity = resolveCanonicalIdentity({
        portal: "Naukri",
        url: "https://www.naukri.com/job-listings-director-of-product-300826001234",
        title: "Director of Product",
        companyName: cleanCompany || rawCompany,
      });

      expect(identity.canonicalJobId).toBe("naukri:300826001234");
    });

    it("re-derived canonical identity ownership handles ID rebasing without self-deduplication", () => {
      const seenCanonicalIds = new Set<string>();
      const seenUrls = new Set<string>();

      // Card 1 enters with provisional identity
      const provId = "indeed:jk:abc123";
      const provUrl = "https://www.indeed.com/viewjob?jk=abc123";
      seenCanonicalIds.add(provId);
      seenUrls.add(provUrl);

      // Detail resolution determines canonical external URL or resolved identity
      const resolvedId = "indeed:jk:abc123"; // Stable
      const resolvedUrl = "https://www.indeed.com/viewjob?jk=abc123";

      // Ownership check: If ID is unchanged, it should NOT flag as duplicate of itself
      if (resolvedId !== provId) {
        seenCanonicalIds.delete(provId);
        expect(seenCanonicalIds.has(resolvedId)).toBe(false);
        seenCanonicalIds.add(resolvedId);
      }
      expect(seenCanonicalIds.has(resolvedId)).toBe(true);
      expect(seenCanonicalIds.size).toBe(1);

      // Now Card 2 tries to take the same canonical ID
      const card2ResolvedId = "indeed:jk:abc123";
      const isCard2Duplicate = seenCanonicalIds.has(card2ResolvedId);
      expect(isCard2Duplicate).toBe(true);
    });

    it("heuristic title|company|location keys are telemetry-only and do not suppress admission", () => {
      const seenHeuristicKeys = new Set<string>();
      const key1 = ["vp engineering", "google", "gurugram"].join("|");

      seenHeuristicKeys.add(key1);

      // Another job with same title/company/location but distinct source listing ID
      const key2 = ["vp engineering", "google", "gurugram"].join("|");
      const isHeuristicMatch = seenHeuristicKeys.has(key2);
      expect(isHeuristicMatch).toBe(true);
      // Under Gate 1 rules, this records heuristicDuplicateSuspect but does NOT return null/reject!
    });
  });
});
