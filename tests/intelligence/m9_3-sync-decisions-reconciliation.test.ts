import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("M9.3 decision cache reconciliation", () => {
  it("does not expose a bulk browser-cache import endpoint", () => {
    const source = fs.readFileSync(path.resolve("src/lib/intelligence/decisions-server.ts"), "utf8");
    expect(source).not.toContain("syncDecisionsFn");
  });

  it("keeps canonical decisions server-owned across browser account switches", () => {
    const source = fs.readFileSync(path.resolve("src/lib/decisions-store.ts"), "utf8");
    expect(source).toContain("cacheScope");
    expect(source).toContain("radar.decisions.cache.v2:");
    expect(source).not.toContain("syncDecisionsFn");
  });
});
