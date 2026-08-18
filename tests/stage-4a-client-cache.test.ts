import { describe, it, expect, beforeEach } from "vitest";
import { ClientOpportunityCache } from "../src/lib/opportunity-cache";

describe("Gate 1: Client-Side Opportunity Cache Reuse", () => {
  const mockOpportunities = [
    {
      jobHash: "j-03b75f450eb3",
      role: "VP Marketing",
      company: "GrowthCorp",
      decision: "PURSUE",
    },
    {
      jobHash: "j-46089844ba17",
      role: "Director Product",
      company: "TechScale",
      decision: "CONSIDER",
    },
  ];

  beforeEach(() => {
    ClientOpportunityCache.clear();
  });

  it("returns null when cache is empty or unhydrated", () => {
    const details = ClientOpportunityCache.getDetails("j-03b75f450eb3");
    expect(details).toBeNull();
  });

  it("returns cached details instantly on cache hit without server RPC", () => {
    // Hydrate client cache (simulating /decisions load)
    ClientOpportunityCache.setList(mockOpportunities);

    const details = ClientOpportunityCache.getDetails("j-03b75f450eb3");
    expect(details).not.toBeNull();
    expect(details?.opportunity.role).toBe("VP Marketing");
    expect(details?.currentIndex).toBe(1);
    expect(details?.totalCount).toBe(2);
    expect(details?.neighbors.next?.jobHash).toBe("j-46089844ba17");
  });

  it("returns null for uncached jobHash allowing fallback to server RPC", () => {
    ClientOpportunityCache.setList(mockOpportunities);

    const details = ClientOpportunityCache.getDetails("j-nonexistent");
    expect(details).toBeNull();
  });
});
