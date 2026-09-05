import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { decisionCacheKey } from "../../src/lib/decisions-store";

describe("Decision browser-cache authority boundary", () => {
  it("namespaces browser cache entries by the authenticated canonical scope", () => {
    expect(decisionCacheKey("tenant_A:person_A")).not.toBe(decisionCacheKey("tenant_B:person_B"));
    expect(decisionCacheKey("tenant_A:person_A")).toContain("radar.decisions.cache.v2:");
  });

  it("never imports browser cache into canonical decision persistence", () => {
    const store = fs.readFileSync(path.resolve("src/lib/decisions-store.ts"), "utf8");
    const server = fs.readFileSync(path.resolve("src/lib/intelligence/decisions-server.ts"), "utf8");
    expect(store).not.toContain("syncDecisionsFn");
    expect(server).not.toContain("syncDecisionsFn");
    expect(store).not.toContain("radar.decisions.v1");
  });
});
