import { describe, it, expect } from "vitest";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import { checkLinkedInSessionState } from "../../scripts/scraper/portals/linkedin";
import { resolveCanonicalIdentity } from "../../src/lib/acquisition/canonical-identity";
import { SearchPlanner } from "../../scripts/scraper/run/search-planner";

describe("Scraper Bottleneck Fixes & Optimization Regression Tests", () => {
  it("P0: Naukri detailStrategy is set to 'auto'", () => {
    expect(naukriHandler.detailStrategy).toBe("auto");
    expect(naukriHandler.name).toBe("Naukri");
  });

  it("P0: Canonical Identity resolution correctly strips tracking parameters and generates deterministic canonical URL", () => {
    const rawUrl1 = "https://www.naukri.com/job-listings-vp-marketing-tech-corp-delhi-123456?src=search&sid=987654";
    const rawUrl2 = "https://www.naukri.com/job-listings-vp-marketing-tech-corp-delhi-123456?utm_source=google&tracking_id=abc";

    const identity1 = resolveCanonicalIdentity({
      portal: "Naukri",
      url: rawUrl1,
      title: "VP Marketing",
      companyName: "Tech Corp",
    });

    const identity2 = resolveCanonicalIdentity({
      portal: "Naukri",
      url: rawUrl2,
      title: "VP Marketing",
      companyName: "Tech Corp",
    });

    expect(identity1.canonicalUrl).toBe("https://www.naukri.com/job-listings-vp-marketing-tech-corp-delhi-123456");
    expect(identity1.canonicalUrl).toBe(identity2.canonicalUrl);
    expect(identity1.canonicalJobId).toBe(identity2.canonicalJobId);
  });

  it("P1: LinkedIn checkLinkedInSessionState detects AUTH_MISSING when li_at cookie is absent", async () => {
    const mockContext: any = {
      browserContext: {
        cookies: async () => [],
      },
      activePage: null,
      logger: () => {},
    };

    const state = await checkLinkedInSessionState(mockContext);
    expect(state).toBe("AUTH_MISSING");
  });

  it("P1: LinkedIn checkLinkedInSessionState detects AUTH_EXPIRED when redirected to login/authwall", async () => {
    const mockContext: any = {
      browserContext: {
        cookies: async () => [{ name: "li_at", value: "test_cookie_value_123456789" }],
      },
      activePage: {
        url: () => "https://www.linkedin.com/authwall?trk=guest",
        title: async () => "LinkedIn: Log In or Sign Up",
      },
      logger: () => {},
    };

    const state = await checkLinkedInSessionState(mockContext);
    expect(state).toBe("AUTH_EXPIRED");
  });

  it("P1: SearchPlanner generates clean role taxonomy queries without location string concatenation", async () => {
    const intent = {
      targetTitles: ["Chief Marketing Officer", "VP Marketing"],
      preferredLocations: ["Gurugram", "Remote India"],
    };

    const plan = SearchPlanner.plan(intent as any, "", "");
    const queries = plan.rankedQueries.map((rq) => rq.query);

    expect(queries).toContain("Chief Marketing Officer");
    expect(queries).toContain("VP Marketing");
    expect(queries).not.toContain("Chief Marketing Officer Gurugram");
    expect(queries).not.toContain("VP Marketing Remote India");
  });
});
