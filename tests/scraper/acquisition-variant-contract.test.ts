import { describe, expect, it } from "vitest";
import { indeedHandler } from "../../scripts/scraper/portals/indeed";
import { linkedinHandler, resolveLinkedInGeoId } from "../../scripts/scraper/portals/linkedin";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import { compileCoverageVariants, createFreshnessVariant } from "../../scripts/scraper/run/acquisition-variants";
import { compileG2ControlledCohort, G2_CONTROLLED_COHORT } from "../../scripts/scraper/run/g2-controlled-cohort";
import { compileG3ReadinessRevalidation, G3_READINESS_REVALIDATION } from "../../scripts/scraper/run/g3-readiness-revalidation";
import { compileNcrDiscoveryReachCohort, NCR_DISCOVERY_REACH_COHORT } from "../../scripts/scraper/run/ncr-discovery-reach-cohort";
import type { ResolvedScraperPlan } from "../../src/lib/intelligence/ScraperPlanResolver";

const plan = {
  searchPlanId: "sp_test",
  snapshotId: "snap_test",
  contextFingerprint: "ctx_test",
  title: "Executive Search",
  criteria: {
    targetSeniority: ["Chief"],
    targetRoles: ["Chief Marketing Officer"],
    targetLocations: ["Gurgaon"],
    targetIndustries: ["Technology"],
    customParameters: { departments: ["Marketing"] },
  },
  queries: ["Chief Marketing Officer"],
  queryCount: 1,
  source: "persisted_active_plan",
} as ResolvedScraperPlan;

describe("acquisition variant contracts", () => {
  it("compiles the initial coverage surface with a seven-day freshness constraint", () => {
    const [variant] = compileCoverageVariants(plan, ["Indeed"]);
    expect(variant).toMatchObject({
      query: "Chief Marketing Officer",
      location: "Gurgaon",
      industry: "Technology",
      department: "Marketing",
      channel: "search",
      postedWithinDays: 7,
      sort: "date",
    });
  });

  it("propagates the default freshness constraint to every portal's final URL", () => {
    const variants = compileCoverageVariants(plan, ["Indeed", "Naukri", "LinkedIn"]);
    const byPortal = new Map(variants.map((variant) => [variant.portal, variant]));

    const indeed = new URL(indeedHandler.buildSearchUrl({ ...byPortal.get("Indeed")!, page: 1 }));
    const naukri = new URL(naukriHandler.buildSearchUrl({ ...byPortal.get("Naukri")!, page: 1 }));
    const linkedin = new URL(linkedinHandler.buildSearchUrl({ ...byPortal.get("LinkedIn")!, page: 1 }));

    expect(indeed.searchParams.get("fromage")).toBe("7");
    expect(indeed.searchParams.get("sort")).toBe("date");
    expect(naukri.searchParams.get("jobAge")).toBe("7");
    expect(naukri.searchParams.get("sort")).toBe("r");
    expect(linkedin.searchParams.get("f_TPR")).toBe("r604800");
  });

  it("emits stable portal-specific freshness filters", () => {
    const input = { query: "Chief Marketing Officer", location: "Gurgaon", radiusKm: 25, postedWithinDays: 7 as const, sort: "date" as const, page: 1 };
    const indeed = new URL(indeedHandler.buildSearchUrl(input));
    const linkedin = new URL(linkedinHandler.buildSearchUrl(input));
    const naukri = new URL(naukriHandler.buildSearchUrl(input));

    expect(indeed.searchParams.get("fromage")).toBe("7");
    expect(indeed.searchParams.get("l")).toBe("Gurgaon");
    expect(indeed.searchParams.get("radius")).toBe("25");
    expect(linkedin.searchParams.get("f_TPR")).toBe("r604800");
    expect(linkedin.searchParams.get("location")).toBe("Gurgaon");
    expect(naukri.searchParams.get("jobAge")).toBe("7");
    expect(naukri.searchParams.get("sort")).toBe("r");
    expect(naukri.searchParams.get("l")).toBe("Gurgaon");
  });

  it("creates freshness as a separate acquisition lens", () => {
    const [coverage] = compileCoverageVariants(plan, ["LinkedIn"]);
    const fresh = createFreshnessVariant(coverage, 1);
    expect(fresh.channel).toBe("search");
    expect(fresh.postedWithinDays).toBe(1);
    expect(fresh.id).not.toBe(coverage.id);
    expect(coverage.postedWithinDays).toBe(7);
  });

  it("propagates a compiled freshness variant all the way to the final Naukri URL", () => {
    const [coverage] = compileCoverageVariants(plan, ["Naukri"]);
    const freshness = createFreshnessVariant(coverage, 7);
    const finalUrl = new URL(naukriHandler.buildSearchUrl({ ...freshness, page: 1 }));

    // This proves the value survives variant compilation and URL construction,
    // rather than only being accepted by the portal builder in isolation.
    expect(finalUrl.searchParams.get("k")).toBe("Chief Marketing Officer");
    expect(finalUrl.searchParams.get("l")).toBe("Gurgaon");
    expect(finalUrl.searchParams.get("jobAge")).toBe("7");
    expect(finalUrl.searchParams.get("sort")).toBe("r");
  });

  it("defines the G2 cohort as exactly fifteen one-page, ten-card surfaces", () => {
    const variants = compileG2ControlledCohort("Gurugram");
    expect(variants).toHaveLength(15);
    expect(G2_CONTROLLED_COHORT.maxPages).toBe(1);
    expect(G2_CONTROLLED_COHORT.maxCardsPerUnit).toBe(10);
    expect(new Set(variants.map((variant) => variant.familyId))).toEqual(new Set(G2_CONTROLLED_COHORT.families.map((family) => family.id)));
    expect(variants.every((variant) => variant.postedWithinDays === 7 && variant.sort === "date" && variant.location === "Gurugram")).toBe(true);
  });

  it("limits G3 readiness revalidation to the two geography-failing portals", () => {
    const variants = compileG3ReadinessRevalidation("Gurugram");
    expect(variants).toHaveLength(10);
    expect(G3_READINESS_REVALIDATION.portals).toEqual(["LinkedIn", "Indeed"]);
    expect(new Set(variants.map((variant) => variant.portal))).toEqual(new Set(["LinkedIn", "Indeed"]));
    expect(variants.every((variant) => variant.postedWithinDays === 7 && variant.sort === "date" && variant.location === "Gurugram")).toBe(true);
  });

  it("holds the NCR reach cohort to a single query across every NCR city and portal", () => {
    const variants = compileNcrDiscoveryReachCohort();
    expect(variants).toHaveLength(15);
    expect(NCR_DISCOVERY_REACH_COHORT.maxPages).toBe(1);
    expect(NCR_DISCOVERY_REACH_COHORT.maxCardsPerUnit).toBe(5);
    expect(new Set(variants.map((variant) => variant.query))).toEqual(new Set(["VP Growth"]));
    expect(new Set(variants.map((variant) => variant.location))).toEqual(new Set(NCR_DISCOVERY_REACH_COHORT.locations));
    expect(new Set(variants.map((variant) => variant.portal))).toEqual(new Set(NCR_DISCOVERY_REACH_COHORT.portals));
    expect(variants.every((variant) => variant.postedWithinDays === 7 && variant.sort === "date")).toBe(true);
  });

  it("uses verified city-specific LinkedIn geo IDs for the NCR reach cohort", () => {
    const linkedinVariants = compileNcrDiscoveryReachCohort().filter((variant) => variant.portal === "LinkedIn");
    const geoIds = linkedinVariants.map((variant) => {
      const url = new URL(linkedinHandler.buildSearchUrl({ ...variant, page: 1 }));
      expect(url.searchParams.get("location")).toBe(variant.location);
      expect(url.searchParams.get("geoId")).toBe(resolveLinkedInGeoId(variant.location));
      return url.searchParams.get("geoId");
    });

    expect(new Set(geoIds).size).toBe(NCR_DISCOVERY_REACH_COHORT.locations.length);
    expect(geoIds).not.toContain("102713980");
  });
});
