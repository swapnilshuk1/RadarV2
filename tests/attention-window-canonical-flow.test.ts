import { describe, it, expect } from "vitest";
import { buildHeadspace } from "../src/lib/intelligence/candidate";
import { applyHeadspaceFilter } from "../src/lib/intelligence/headspace-filter";
import { sanitizeAttentionWindow } from "../src/lib/intelligence/preferences-server";

describe("Priority 1 — Canonical Executive Attention Window Integration Suite", () => {
  it("Sanitizes values strictly to 1–10 range with default 6", () => {
    expect(sanitizeAttentionWindow(1)).toBe(1);
    expect(sanitizeAttentionWindow(5)).toBe(5);
    expect(sanitizeAttentionWindow(10)).toBe(10);

    // Out of bounds or invalid inputs fallback to 6
    expect(sanitizeAttentionWindow(0)).toBe(6);
    expect(sanitizeAttentionWindow(15)).toBe(6);
    expect(sanitizeAttentionWindow(-3)).toBe(6);
    expect(sanitizeAttentionWindow(null)).toBe(6);
    expect(sanitizeAttentionWindow(undefined)).toBe(6);
    expect(sanitizeAttentionWindow("invalid")).toBe(6);
  });

  it("buildHeadspace correctly respects capacity override and calculates saturation", () => {
    // Capacity = 5
    const hs5 = buildHeadspace(3, 5);
    expect(hs5.capacityPerMonth).toBe(5);
    expect(hs5.activePursuits).toBe(3);
    expect(hs5.saturated).toBe(false);

    const hs5Saturated = buildHeadspace(5, 5);
    expect(hs5Saturated.saturated).toBe(true);

    // Capacity = 10
    const hs10 = buildHeadspace(5, 10);
    expect(hs10.capacityPerMonth).toBe(10);
    expect(hs10.saturated).toBe(false);

    // Capacity = 1
    const hs1 = buildHeadspace(1, 1);
    expect(hs1.capacityPerMonth).toBe(1);
    expect(hs1.saturated).toBe(true);
  });

  it("Dynamic capacity change (5 -> 2) triggers headspace saturation without changing raw scores or verdicts", () => {
    const rawVerdict = "PURSUE";

    // Capacity = 5, active pursuits = 3 -> NOT saturated -> PURSUE stays PURSUE
    const hs5 = buildHeadspace(3, 5);
    const outcome5 = applyHeadspaceFilter(rawVerdict, hs5);
    expect(outcome5.downgraded).toBe(false);
    expect(outcome5.finalVerb).toBe("PURSUE");

    // Capacity changed to 2, active pursuits = 3 -> NOW saturated -> PURSUE downgraded to CONSIDER
    const hs2 = buildHeadspace(3, 2);
    const outcome2 = applyHeadspaceFilter(rawVerdict, hs2);
    expect(outcome2.downgraded).toBe(true);
    expect(outcome2.finalVerb).toBe("CONSIDER");
    expect(outcome2.reason).toContain("3/2 active pursuits");
  });
});
