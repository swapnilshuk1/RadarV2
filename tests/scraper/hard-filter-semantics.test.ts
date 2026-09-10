import { describe, it, expect } from "vitest";
import { passesHardFilter } from "../../scripts/scraper/utils/hard-filter";

describe("Hard Filter Semantics Contract (Gate 3)", () => {
  describe("Positive Disqualification (PROVABLY_DISQUALIFIED)", () => {
    it("disqualifies explicit conflicting title/function when active search-plan policy excludes it", () => {
      const res = passesHardFilter(
        {
          title: "Senior Legal Counsel",
          company: "Acme Corp",
          location: "Bengaluru, Karnataka, India",
        },
        {
          excludedRoles: ["legal counsel", "statutory auditor"],
        },
      );
      expect(res.pass).toBe(false);
      expect(res.decision).toBe("PROVABLY_DISQUALIFIED");
      expect(res.reasonCode).toBe("TITLE_INTENT_MISMATCH");
    });

    it("disqualifies universal non-job pages", () => {
      const res = passesHardFilter({
        title: "Privacy Policy - Careers",
        company: "Acme Corp",
      });
      expect(res.pass).toBe(false);
      expect(res.decision).toBe("PROVABLY_DISQUALIFIED");
      expect(res.reasonCode).toBe("OTHER");
    });

    it("disqualifies universal junior/entry seniority", () => {
      const res = passesHardFilter({
        title: "Junior Marketing Associate",
        company: "StartUp Inc",
        location: "Bengaluru",
      });
      expect(res.pass).toBe(false);
      expect(res.decision).toBe("PROVABLY_DISQUALIFIED");
      expect(res.reasonCode).toBe("SENIORITY_EXCLUSION");
    });

    it("disqualifies universal junior experience brackets", () => {
      const res = passesHardFilter({
        title: "Marketing Coordinator",
        company: "StartUp Inc",
        location: "Bengaluru",
        experience: "0 - 1 yrs",
      });
      expect(res.pass).toBe(false);
      expect(res.decision).toBe("PROVABLY_DISQUALIFIED");
      expect(res.reasonCode).toBe("EXPERIENCE_EXCLUSION");
    });

    it("disqualifies explicit foreign locations without India or remote anchor", () => {
      const foreignRes = passesHardFilter({
        title: "Chief Marketing Officer",
        company: "Global Tech",
        location: "London, England, United Kingdom",
      });
      expect(foreignRes.pass).toBe(false);
      expect(foreignRes.decision).toBe("PROVABLY_DISQUALIFIED");
      expect(foreignRes.reasonCode).toBe("LOCATION_EXCLUSION");

      const deRes = passesHardFilter({
        title: "VP Growth",
        company: "Berlin Auto",
        location: "Frankfurt, Germany",
      });
      expect(deRes.pass).toBe(false);
      expect(deRes.decision).toBe("PROVABLY_DISQUALIFIED");
      expect(deRes.reasonCode).toBe("LOCATION_EXCLUSION");
    });
  });

  describe("Ambiguous Executive Titles & Missing Functional Evidence (DEFER_TO_DETAIL)", () => {
    it("defers broad executive titles to detail evaluation rather than disqualifying pre-detail", () => {
      const mdRes = passesHardFilter(
        {
          title: "Managing Director",
          company: "Enterprise Holdings",
          location: "Mumbai",
        },
        {
          query: "Chief Marketing Officer",
        },
      );
      expect(mdRes.pass).toBe(true);
      expect(mdRes.decision).toBe("DEFER_TO_DETAIL");

      const bizHeadRes = passesHardFilter(
        {
          title: "Business Head",
          company: "Tata Group",
          location: "Bengaluru",
        },
        {
          query: "VP Growth",
        },
      );
      expect(bizHeadRes.pass).toBe(true);
      expect(bizHeadRes.decision).toBe("DEFER_TO_DETAIL");
    });

    it("defers cards with missing functional evidence in the title", () => {
      const dirRes = passesHardFilter(
        {
          title: "Director",
          company: "Global Services",
          location: "Hyderabad",
        },
        {
          targetRoles: ["VP Marketing", "Chief Marketing Officer"],
        },
      );
      expect(dirRes.pass).toBe(true);
      expect(dirRes.decision).toBe("DEFER_TO_DETAIL");
    });

    it("defers ambiguous remote/international wording unless policy explicitly excludes remote", () => {
      const remoteRes = passesHardFilter(
        {
          title: "Chief Marketing Officer",
          company: "Distributed Co",
          location: "Remote - Worldwide",
        },
        {
          query: "Chief Marketing Officer",
        },
      );
      expect(remoteRes.pass).toBe(true);
      expect(remoteRes.decision).toBe("PASS");

      // Even if title is ambiguous, remote wording alone does not disqualify
      const ambiguousRemoteRes = passesHardFilter(
        {
          title: "Executive Vice President",
          company: "Global Tech",
          location: "Global Remote",
        },
        {
          query: "Chief Marketing Officer",
        },
      );
      expect(ambiguousRemoteRes.pass).toBe(true);
      expect(ambiguousRemoteRes.decision).toBe("DEFER_TO_DETAIL");

      // But if search-plan explicitly disallows remote:
      const disallowRemoteRes = passesHardFilter(
        {
          title: "Chief Marketing Officer",
          company: "Distributed Co",
          location: "Worldwide Remote",
        },
        {
          query: "Chief Marketing Officer",
          disallowRemote: true,
        },
      );
      expect(disallowRemoteRes.pass).toBe(false);
      expect(disallowRemoteRes.decision).toBe("PROVABLY_DISQUALIFIED");
      expect(disallowRemoteRes.reasonCode).toBe("LOCATION_EXCLUSION");
    });
  });

  describe("Clearly Relevant Opportunities (PASS)", () => {
    it("passes executive marketing and commercial leadership roles in target geography", () => {
      const cmoRes = passesHardFilter(
        {
          title: "Chief Marketing Officer",
          company: "Flipkart",
          location: "Bengaluru, Karnataka, India",
        },
        {
          query: "Chief Marketing Officer",
        },
      );
      expect(cmoRes.pass).toBe(true);
      expect(cmoRes.decision).toBe("PASS");

      const vpGrowthRes = passesHardFilter(
        {
          title: "VP Growth & Marketing",
          company: "Swiggy",
          location: "India - Remote",
        },
        {
          query: "VP Growth",
        },
      );
      expect(vpGrowthRes.pass).toBe(true);
      expect(vpGrowthRes.decision).toBe("PASS");
    });
  });
});
