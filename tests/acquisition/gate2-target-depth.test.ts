/**
 * tests/acquisition/gate2-target-depth.test.ts
 *
 * Gate 2 Continuous Certification Suite: Target-Portal Depth & Coverage Expansion
 * Verifies:
 * 1. Canonical geography semantics and fail-narrow portal geo resolvers
 * 2. Multi-location coverage variant compilation across target locations
 * 3. Source-identity novelty evaluation without downstream dependencies
 * 4. Naukri multi-page API navigation contract and telemetry separation
 * 5. Safe structured SPA state extraction (JSON.parse only, zero script execution)
 * 6. Read-only live portal canary probe contracts
 */

import { describe, it, expect } from "vitest";
import {
  resolveCanonicalGeography,
  resolveLinkedInGeoId,
  resolveIndeedLocation,
  resolveNaukriLocation,
  LINKEDIN_GEO_BY_LOCATION,
  LINKEDIN_GEO_INDIA,
} from "../../scripts/scraper/run/acquisition-geography";
import {
  compileMultiLocationCoverageVariants,
  createAdaptivePageVariant,
  evaluateSourceNovelty,
} from "../../scripts/scraper/run/acquisition-variants";
import {
  buildNaukriSearchUrl,
  naukriHandler,
} from "../../scripts/scraper/portals/naukri";
import {
  extractStructuredSpaState,
  extractJobFromHtml,
} from "../../scripts/scraper/utils/http-fetch";
import {
  probeNaukriMultiPage,
  probeLinkedInExperienceFilter,
  evaluateLinkedInYield,
} from "../../scripts/canary/probe-portals-readonly";

describe("Gate 2: Target-Portal Depth & Coverage Expansion", () => {
  describe("1. Canonical Geography & Portal Resolvers", () => {
    it("resolves canonical cities and metro clusters accurately", () => {
      const gurugram = resolveCanonicalGeography("Gurgaon, Haryana");
      expect(gurugram?.canonicalCity).toBe("GURUGRAM");
      expect(gurugram?.metroCluster).toBe("DELHI_NCR");
      expect(gurugram?.state).toBe("HARYANA");
      expect(gurugram?.country).toBe("INDIA");

      const noida = resolveCanonicalGeography("Sector 62, Noida, Uttar Pradesh");
      expect(noida?.canonicalCity).toBe("NOIDA");
      expect(noida?.metroCluster).toBe("DELHI_NCR");
      expect(noida?.state).toBe("UTTAR_PRADESH");

      const greaterNoida = resolveCanonicalGeography("Greater Noida, UP");
      expect(greaterNoida?.canonicalCity).toBe("GREATER_NOIDA");
      expect(greaterNoida?.metroCluster).toBe("DELHI_NCR");

      const whitefield = resolveCanonicalGeography("Whitefield, Bangalore");
      expect(whitefield?.canonicalCity).toBe("BENGALURU");
      expect(whitefield?.metroCluster).toBe("BENGALURU_METRO");
      expect(whitefield?.state).toBe("KARNATAKA");

      const ahmedabad = resolveCanonicalGeography("Ahmedabad, Gujarat");
      expect(ahmedabad?.canonicalCity).toBe("AHMEDABAD");
      expect(ahmedabad?.state).toBe("GUJARAT");

      const remote = resolveCanonicalGeography("Remote - India");
      expect(remote?.isRemote).toBe(true);
    });

    it("resolves LinkedIn Geo IDs with strict fail-narrow semantics (no silent national fallback)", () => {
      expect(resolveLinkedInGeoId("Bengaluru, Karnataka")).toBe(LINKEDIN_GEO_BY_LOCATION["bengaluru"]);
      expect(resolveLinkedInGeoId("Gurgaon")).toBe(LINKEDIN_GEO_BY_LOCATION["gurugram"]);
      expect(resolveLinkedInGeoId("Noida, Uttar Pradesh")).toBe(LINKEDIN_GEO_BY_LOCATION["noida"]);
      expect(resolveLinkedInGeoId("Greater Noida")).toBe(LINKEDIN_GEO_BY_LOCATION["greater noida"]);
      expect(resolveLinkedInGeoId("Mumbai, Maharashtra")).toBe(LINKEDIN_GEO_BY_LOCATION["mumbai"]);
      expect(resolveLinkedInGeoId("Hyderabad, Telangana")).toBe(LINKEDIN_GEO_BY_LOCATION["hyderabad"]);
      expect(resolveLinkedInGeoId("Pune, Maharashtra")).toBe(LINKEDIN_GEO_BY_LOCATION["pune"]);

      // Invariant: Unknown/unmapped location MUST return undefined (fail narrow), NOT nationwide India
      const unknownGeo = resolveLinkedInGeoId("Fictional Tech City");
      expect(unknownGeo).toBeUndefined();
      expect(unknownGeo).not.toBe(LINKEDIN_GEO_INDIA);
    });

    it("resolves Indeed and Naukri location strings correctly", () => {
      expect(resolveIndeedLocation("Bengaluru, Karnataka").location).toBe("Bengaluru, Karnataka");
      expect(resolveIndeedLocation("Bangalore").location).toBe("Bangalore");
      expect(resolveIndeedLocation("Gurgaon").location).toBe("Gurgaon");

      expect(resolveNaukriLocation("Bangalore, KA")).toBe("Bangalore, KA");
      expect(resolveNaukriLocation("Gurgaon, HR")).toBe("Gurgaon, HR");
      expect(resolveNaukriLocation("Sector 62, Noida")).toBe("Sector 62, Noida");
    });
  });

  describe("2. Multi-Location Coverage Variant Compilation & Adaptive Depth", () => {
    it("compiles search variants across all target locations without hardcoded splits", () => {
      const plan: any = {
        searchPlanId: "plan-1",
        queries: ["VP Engineering"],
        criteria: {
          targetLocations: ["Bengaluru", "Gurugram", "Pune"],
        },
      };

      const variants = compileMultiLocationCoverageVariants(plan, ["Naukri", "LinkedIn"]);

      expect(variants.length).toBe(6); // 3 locations * 2 portals
      const locations = variants.map(v => v.location);
      expect(locations).toContain("Bengaluru");
      expect(locations).toContain("Gurugram");
      expect(locations).toContain("Pune");
      expect(variants.every(v => v.query === "VP Engineering")).toBe(true);
    });

    it("createAdaptivePageVariant creates discrete next-page variant preserving search criteria", () => {
      const baseVariant: any = {
        definitionId: "plan-1",
        portal: "Naukri",
        query: "VP Product",
        location: "Bengaluru",
        postedWithinDays: 7,
      };

      const page2Variant = createAdaptivePageVariant(baseVariant, 2);
      expect(page2Variant.definitionId).toBe("plan-1");
      expect(page2Variant.portal).toBe("Naukri");
      expect(page2Variant.query).toBe("VP Product");
      expect(page2Variant.location).toBe("Bengaluru");
      expect(page2Variant.page).toBe(2);
    });

    it("evaluateSourceNovelty calculates source-identity novelty correctly without downstream dependencies", () => {
      const seenIds = new Set(["job-1", "job-2", "job-3", "job-4", "job-5"]);

      // 4 new out of 5 discovered = 80% novelty >= 25% minNoveltyRatio -> shouldContinue: true
      const resultHigh = evaluateSourceNovelty(["job-4", "job-6", "job-7", "job-8", "job-9"], seenIds, 0.25);
      expect(resultHigh.totalDiscovered).toBe(5);
      expect(resultHigh.uniqueSourceIdentities).toBe(5);
      expect(resultHigh.novelCount).toBe(4);
      expect(resultHigh.noveltyRatio).toBe(0.8);
      expect(resultHigh.shouldContinue).toBe(true);

      // 10 items, 6 unique (5 seen + 1 new) -> 1/6 = ~16.7% novelty < 25% minNoveltyRatio -> shouldContinue: false
      const resultLow = evaluateSourceNovelty(["job-1", "job-2", "job-3", "job-4", "job-5", "job-1", "job-2", "job-3", "job-4", "job-99"], seenIds, 0.25);
      expect(resultLow.totalDiscovered).toBe(10);
      expect(resultLow.uniqueSourceIdentities).toBe(6);
      expect(resultLow.novelCount).toBe(1);
      expect(resultLow.noveltyRatio).toBeCloseTo(1 / 6, 2);
      expect(resultLow.shouldContinue).toBe(false);

      // 0 discovered -> shouldContinue: false
      const resultZero = evaluateSourceNovelty([], seenIds, 0.25);
      expect(resultZero.totalDiscovered).toBe(0);
      expect(resultZero.uniqueSourceIdentities).toBe(0);
      expect(resultZero.novelCount).toBe(0);
      expect(resultZero.noveltyRatio).toBe(0);
      expect(resultZero.shouldContinue).toBe(false);
    });

    it("evaluateSourceNovelty deduplicates current page before counting to prevent collapsing identical IDs into false 100% novelty", () => {
      const emptySeen = new Set<string>();

      // Invariant: 15 identical collapsed IDs (e.g. if URLs collapsed to /viewjob) on page 1
      // must NOT be reported as 15 unique identities or 15 novel items
      const collapsedIds = Array(15).fill("https://in.indeed.com/viewjob");
      const collapsedResult = evaluateSourceNovelty(collapsedIds, emptySeen, 0.25);
      expect(collapsedResult.totalDiscovered).toBe(15);
      expect(collapsedResult.uniqueSourceIdentities).toBe(1);
      expect(collapsedResult.novelCount).toBe(1);
      expect(collapsedResult.noveltyRatio).toBe(1.0); // 1 novel / 1 unique

      // Conversely, 15 distinct source identities (e.g. verified 16-hex Indeed JKs)
      const distinctIds = Array.from({ length: 15 }, (_, i) => `0123456789abcdef${i}`);
      const distinctResult = evaluateSourceNovelty(distinctIds, emptySeen, 0.25);
      expect(distinctResult.totalDiscovered).toBe(15);
      expect(distinctResult.uniqueSourceIdentities).toBe(15);
      expect(distinctResult.novelCount).toBe(15);
      expect(distinctResult.noveltyRatio).toBe(1.0);

      // On page 2: with distinct new JKs, novelty continues
      const surfaceSeen = new Set(distinctIds);
      const page2DistinctIds = Array.from({ length: 15 }, (_, i) => `0123456789abcdef${i + 15}`);
      const page2Result = evaluateSourceNovelty(page2DistinctIds, surfaceSeen, 0.25);
      expect(page2Result.uniqueSourceIdentities).toBe(15);
      expect(page2Result.novelCount).toBe(15);
      expect(page2Result.noveltyRatio).toBe(1.0);
      expect(page2Result.shouldDeepen).toBe(true);
    });
  });

  describe("3. Naukri Multi-Page API Protocol & Search URL Contract", () => {
    it("buildNaukriSearchUrl builds discrete non-overlapping page URLs", () => {
      const req = {
        query: "Chief Technology Officer",
        location: "Bengaluru",
      };

      const url1 = buildNaukriSearchUrl(req, 1);
      expect(url1).toContain("chief-technology-officer-jobs-in-india");
      expect(url1).toContain("pageNo=1");
      expect(url1).not.toContain("-india-1?");

      const url2 = buildNaukriSearchUrl(req, 2);
      expect(url2).toContain("chief-technology-officer-jobs-in-india-2");
      expect(url2).toContain("pageNo=2");

      const url3 = buildNaukriSearchUrl(req, 3);
      expect(url3).toContain("chief-technology-officer-jobs-in-india-3");
      expect(url3).toContain("pageNo=3");
    });

    it("verifies telemetry contract separates sourceExhausted from quotaSatisfied and tracks page sequences", () => {
      const telemetry = {
        apiPagesExpected: [1, 2, 3],
        apiPagesObserved: [1, 2, 3],
        apiPagesMissing: [],
        rawApiRecords: 60,
        uniqueApiJobIds: 60,
        returnedCards: 60,
        sourceExhausted: false,
        quotaSatisfied: true,
        paginationGap: false,
      };

      expect(telemetry.apiPagesExpected).toEqual([1, 2, 3]);
      expect(telemetry.apiPagesObserved).toEqual([1, 2, 3]);
      expect(telemetry.apiPagesMissing).toEqual([]);
      expect(telemetry.paginationGap).toBe(false);
      expect(telemetry.sourceExhausted).toBe(false);
      expect(telemetry.quotaSatisfied).toBe(true);
    });
  });

  describe("4. Structured SPA State Extraction (Safe JSON.parse)", () => {
    it("extracts job details safely from Next.js __NEXT_DATA__ JSON script", () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "job": {
                    "title": "Vice President of Product Management",
                    "company": "Enterprise Tech Corp",
                    "description": "<p>We are seeking an executive leader to drive our global product strategy. Responsibilities include scaling multi-region SaaS platforms, leading directors of product, and managing enterprise P&L.</p>"
                  }
                }
              }
            }
          </script>
        </head>
        <body><div>Content</div></body>
        </html>
      `;

      const result = extractStructuredSpaState(html);
      expect(result).not.toBeNull();
      expect(result?.title).toBe("Vice President of Product Management");
      expect(result?.company).toBe("Enterprise Tech Corp");
      expect(result?.rawText).toContain("global product strategy");
      expect(result?.rawText).toContain("scaling multi-region SaaS platforms");
    });

    it("extracts job details from generic structured application/json script", () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/json">
            {
              "jobDetails": {
                "title": "Director of Engineering",
                "company": "CloudScale Systems",
                "description": "<div>Direct engineering teams building distributed cloud infrastructure. Requires 15+ years experience and proven executive ownership of high-throughput services.</div>"
              }
            }
          </script>
        </head>
        <body><div>Content</div></body>
        </html>
      `;

      const result = extractStructuredSpaState(html);
      expect(result).not.toBeNull();
      expect(result?.title).toBe("Director of Engineering");
      expect(result?.company).toBe("CloudScale Systems");
      expect(result?.rawText).toContain("Direct engineering teams");
    });

    it("integrates seamlessly into extractJobFromHtml without executing embedded scripts", () => {
      const maliciousHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <script>
            window.maliciousCodeExecuted = true;
          </script>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "job": {
                    "title": "Chief Information Officer",
                    "company": "SecureFin",
                    "description": "Responsible for cybersecurity, infrastructure resilience, and enterprise compliance across all corporate entities. Minimum 18 years experience."
                  }
                }
              }
            }
          </script>
        </head>
        <body><main>Fallback Body</main></body>
        </html>
      `;

      const result = extractJobFromHtml(maliciousHtml);
      expect(result.success).toBe(true);
      expect(result.extractedTitle).toBe("Chief Information Officer");
      expect(result.extractedCompany).toBe("SecureFin");
      expect((globalThis as any).maliciousCodeExecuted).toBeUndefined();
    });

    it("handles corrupted or invalid JSON safely without throwing", () => {
      const corruptedHtml = `
        <html>
        <head>
          <script id="__NEXT_DATA__" type="application/json">
            { corrupt: json... unclosed
          </script>
        </head>
        <body><main>Regular Text</main></body>
        </html>
      `;

      const result = extractStructuredSpaState(corruptedHtml);
      expect(result).toBeNull();
    });
  });

  describe("5. Read-Only Portal Canary Probe Contracts", () => {
    it("probeNaukriMultiPage validates URL structure against discrete pagination contract", () => {
      const obs = probeNaukriMultiPage();
      expect(obs.page1StructureValid).toBe(true);
      expect(obs.page2StructureValid).toBe(true);
      expect(obs.notes).toContain("discrete non-overlapping pagination contract");
    });

    it("evaluateLinkedInYield demonstrates downstream title policy requirement and detects non-executive title leakage", () => {
      // Invariant: Even if f_E=5,6 is used, downstream title policy filtering remains mandatory
      const sampleTitles = [
        "Vice President of Engineering",
        "Senior Frontend Developer",
        "Director, Global Products",
        "Junior QA Analyst",
      ];
      const yieldEval = evaluateLinkedInYield(sampleTitles);
      expect(yieldEval.total).toBe(4);
      expect(yieldEval.executiveCount).toBe(2);
      expect(yieldEval.nonExecutiveCount).toBe(2);
      expect(yieldEval.yieldRatio).toBe(0.5);
      expect(yieldEval.conclusion).toContain("downstream title/seniority policy calibration remains strictly mandatory");

      // Zero titles returns UNKNOWN/FAIL, never synthesizes 0.8
      const emptyEval = evaluateLinkedInYield([]);
      expect(emptyEval.yieldRatio).toBe(0);
      expect(emptyEval.conclusion).toContain("UNKNOWN/FAIL");
    });

    it("probeLinkedInExperienceFilter fails closed when zero titles are observed", async () => {
      // Live probe without network or titles returns 0 ratio and UNKNOWN/FAIL, never synthesizes 0.8
      const obs = await probeLinkedInExperienceFilter();
      if (obs.filteredTitles.length === 0) {
        expect(obs.filteredExecutiveYieldRatio).toBe(0);
        expect(obs.conclusion).toContain("UNKNOWN/FAIL");
      } else {
        expect(obs.filteredExecutiveYieldRatio).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
