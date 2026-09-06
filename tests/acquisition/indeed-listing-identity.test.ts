import { describe, expect, it } from "vitest";
import { resolveCanonicalIdentity } from "@/lib/acquisition/canonical-identity";
import {
  MAX_INDEED_LISTING_REDIRECT_HOPS,
  parseVerifiedIndeedListingUrl,
  resolveIndeedListingBounded,
} from "@/lib/acquisition/indeed-listing-identity";

describe("Indeed listing identity", () => {
  it("converges direct and sponsored ingress on the verified stable jk", async () => {
    const sponsored = "https://in.indeed.com/pagead/clk?foo=tracking";
    const resolved = await resolveIndeedListingBounded(sponsored, async (url) => {
      expect(url).toBe(sponsored);
      return { status: 302, location: "/viewjob?jk=ABC123" };
    });
    expect(resolved).toMatchObject({ ok: true, redirectHops: 1 });
    if (!resolved.ok) throw new Error("expected a verified listing identity");

    const direct = resolveCanonicalIdentity({
      portal: "Indeed",
      url: "https://in.indeed.com/viewjob?jk=ABC123&utm_source=search",
      title: "Operations Director",
      companyName: "Pinkerton",
    });
    expect(resolved.identity.sourceJobId).toBe("abc123");
    expect(resolved.identity.canonicalJobId).toBe(direct.canonicalJobId);
    expect(direct.canonicalJobId).toBe("indeed:jk_abc123");
  });

  it("keeps distinct listings distinct even when their content is identical", () => {
    const first = resolveCanonicalIdentity({ portal: "Indeed", url: "https://in.indeed.com/viewjob?jk=ABC123", title: "Same", companyName: "Same" });
    const second = resolveCanonicalIdentity({ portal: "Indeed", url: "https://in.indeed.com/viewjob?jk=XYZ789", title: "Same", companyName: "Same" });
    expect(first.canonicalJobId).not.toBe(second.canonicalJobId);
    expect(first.sourceJobId).toBe("abc123");
    expect(second.sourceJobId).toBe("xyz789");
  });

  it("fails closed for malformed or unrelated destinations", async () => {
    expect(parseVerifiedIndeedListingUrl("https://evil.example/viewjob?jk=ABC123")).toBeUndefined();
    const result = await resolveIndeedListingBounded("https://in.indeed.com/pagead/clk?x=1", async () => ({
      status: 302,
      location: "https://evil.example/viewjob?jk=ABC123",
    }));
    expect(result).toMatchObject({ ok: false, failure: "UNSAFE_REDIRECT_DESTINATION" });
  });

  it("rejects unsafe initial URLs before issuing any request", async () => {
    let requestCount = 0;
    const external = await resolveIndeedListingBounded("https://evil.example/pagead/clk", async () => {
      requestCount += 1;
      return { status: 302, location: "https://in.indeed.com/viewjob?jk=ABC123" };
    });
    expect(external).toMatchObject({ ok: false, failure: "UNSAFE_REDIRECT_DESTINATION" });
    expect(requestCount).toBe(0);

    const malformed = await resolveIndeedListingBounded("not a URL", async () => {
      requestCount += 1;
      return { status: 302, location: "https://in.indeed.com/viewjob?jk=ABC123" };
    });
    expect(malformed).toMatchObject({ ok: false, failure: "UNSAFE_REDIRECT_DESTINATION" });
    expect(requestCount).toBe(0);
  });

  it("resolves a sponsored rich-discovery observation without reusing its URL as identity", async () => {
    const discoveryUrl = "https://in.indeed.com/pagead/clk?tracking=opaque";
    const result = await resolveIndeedListingBounded(discoveryUrl, async () => ({
      status: 302,
      location: "https://in.indeed.com/viewjob?jk=ABC123&from=pagead",
    }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("expected resolved sponsored listing");
    expect(discoveryUrl).toContain("pagead/clk");
    expect(result.identity.resolvedUrl).toContain("viewjob?jk=ABC123");
    expect(result.identity.sourceJobId).toBe("abc123");
  });

  it("enforces the redirect hop limit rather than observing it after navigation", async () => {
    let requestCount = 0;
    const result = await resolveIndeedListingBounded("https://in.indeed.com/pagead/clk?x=1", async () => {
      requestCount += 1;
      return { status: 302, location: `/pagead/clk?hop=${requestCount}` };
    });
    expect(result).toMatchObject({ ok: false, failure: "REDIRECT_HOP_LIMIT" });
    expect(requestCount).toBe(MAX_INDEED_LISTING_REDIRECT_HOPS + 1);
  });

  it("accepts a direct verified viewjob without a browser finalUrl", async () => {
    const result = await resolveIndeedListingBounded("https://in.indeed.com/viewjob?jk=direct987", async () => {
      throw new Error("a verified direct listing must not request a redirect");
    });
    expect(result).toMatchObject({ ok: true, redirectHops: 0 });
  });
});
