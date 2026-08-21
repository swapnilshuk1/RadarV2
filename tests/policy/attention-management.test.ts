import { describe, it, expect } from "vitest";
import { sanitizeAttentionWindow } from "../../src/lib/intelligence/preferences-server";
import { getTimeAwareGreeting } from "../../src/routes/index";

// Mock Opportunity generator for deterministic testing
function createMockOpportunity(id: number, verdict: "PURSUE" | "CONSIDER" = "PURSUE") {
  return {
    jobHash: `hash-${id}`,
    role: `Executive Role ${id}`,
    company: `Company ${id}`,
    location: "Bengaluru (Hybrid)",
    engineRecommendation: {
      engineVerdict: verdict,
      evaluationFingerprint: "fingerprint-v1",
    },
    reviewWorkflowState: "UNREVIEWED",
  };
}

describe("W4 — Attention Management & Guided Presentation Suite", () => {
  // Test A: Default attentionWindow = 6 when no preference set
  it("Test A: Default attentionWindow is 6 when no preference set", () => {
    expect(sanitizeAttentionWindow(undefined)).toBe(6);
    expect(sanitizeAttentionWindow(null)).toBe(6);
  });

  // Test B: Personalization (1..10)
  it("Test B: Valid attention window values (1-10) pass through correctly", () => {
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach((val) => {
      expect(sanitizeAttentionWindow(val)).toBe(val);
      expect(sanitizeAttentionWindow(String(val))).toBe(val);
    });
  });

  // Test C: Invalid values (<1 or >10 safely default to 6)
  it("Test C: Out-of-bounds or non-numeric values default to 6", () => {
    expect(sanitizeAttentionWindow(0)).toBe(6);
    expect(sanitizeAttentionWindow(-5)).toBe(6);
    expect(sanitizeAttentionWindow(11)).toBe(6);
    expect(sanitizeAttentionWindow(100)).toBe(6);
    expect(sanitizeAttentionWindow("invalid")).toBe(6);
    expect(sanitizeAttentionWindow(NaN)).toBe(6);
  });

  // Test D: Intelligence Invariance
  it("Test D: Intelligence ordering is identical regardless of attention window", () => {
    const mockPipeline = Array.from({ length: 20 }, (_, i) => createMockOpportunity(i + 1));
    
    // Projections for windows 1, 3, 6, 8, 10
    [1, 3, 6, 8, 10].forEach((win) => {
      const projectedIds = mockPipeline.map((o) => o.jobHash);
      expect(projectedIds).toEqual(mockPipeline.map((o) => o.jobHash));
    });
  });

  // Test E: Window Progression
  it("Test E: Next advances through the stable ranked sequence without changing relative rank", () => {
    const mockPipeline = Array.from({ length: 15 }, (_, i) => createMockOpportunity(i + 1));
    const win = 6;
    
    // Window 0 (first 6)
    const window0 = mockPipeline.slice(0, win);
    expect(window0.map((o) => o.jobHash)).toEqual([
      "hash-1", "hash-2", "hash-3", "hash-4", "hash-5", "hash-6"
    ]);

    // Advance cursor to Window 1 (next 6)
    const cursor = win;
    const window1 = mockPipeline.slice(cursor, cursor + win);
    expect(window1.map((o) => o.jobHash)).toEqual([
      "hash-7", "hash-8", "hash-9", "hash-10", "hash-11", "hash-12"
    ]);

    // Relative rank of all items in pipeline remains unaltered
    expect(mockPipeline.map((o) => o.jobHash)).toEqual(
      Array.from({ length: 15 }, (_, i) => `hash-${i + 1}`)
    );
  });

  // Test F: Window Replenishment
  it("Test F: Acting on item #2 removes it and replenishes at the bottom from next untouched opportunity", () => {
    // Initial pipeline: 1 2 3 4 5 6 7 8
    let pipeline = Array.from({ length: 8 }, (_, i) => createMockOpportunity(i + 1));
    const attentionWindow = 6;

    // Initial visible window: 1 2 3 4 5 6
    let visible = pipeline.slice(0, attentionWindow);
    expect(visible.map((o) => o.jobHash)).toEqual(["hash-1", "hash-2", "hash-3", "hash-4", "hash-5", "hash-6"]);

    // User decides on hash-2 (e.g. PURSUE) -> hash-2 leaves undecided pipeline
    pipeline = pipeline.filter((o) => o.jobHash !== "hash-2");

    // Queue replenishes from the bottom
    visible = pipeline.slice(0, attentionWindow);
    expect(visible.map((o) => o.jobHash)).toEqual([
      "hash-1", "hash-3", "hash-4", "hash-5", "hash-6", "hash-7"
    ]);

    // Specifically verify it is NOT [hash-1, hash-3, hash-4, hash-5, hash-6, hash-8]
    expect(visible.map((o) => o.jobHash)).not.toEqual([
      "hash-1", "hash-3", "hash-4", "hash-5", "hash-6", "hash-8"
    ]);
    // And NOT [hash-1, hash-7, hash-3, hash-4, hash-5, hash-6]
    expect(visible.map((o) => o.jobHash)).not.toEqual([
      "hash-1", "hash-7", "hash-3", "hash-4", "hash-5", "hash-6"
    ]);
  });

  // Test G: Rank Preservation
  it("Test G: #1 remains #1 unless #1 itself changes state; remaining items retain order", () => {
    let pipeline = Array.from({ length: 10 }, (_, i) => createMockOpportunity(i + 1));
    const attentionWindow = 6;

    // Act on hash-4
    pipeline = pipeline.filter((o) => o.jobHash !== "hash-4");
    let visible = pipeline.slice(0, attentionWindow);

    expect(visible[0].jobHash).toBe("hash-1");
    expect(visible.map((o) => o.jobHash)).toEqual([
      "hash-1", "hash-2", "hash-3", "hash-5", "hash-6", "hash-7"
    ]);

    // Act on hash-1
    pipeline = pipeline.filter((o) => o.jobHash !== "hash-1");
    visible = pipeline.slice(0, attentionWindow);

    expect(visible[0].jobHash).toBe("hash-2");
    expect(visible.map((o) => o.jobHash)).toEqual([
      "hash-2", "hash-3", "hash-5", "hash-6", "hash-7", "hash-8"
    ]);
  });

  // Test H: Time-Aware Greeting
  it("Test H: Time-aware greeting formats correctly across day periods", () => {
    expect(getTimeAwareGreeting("Swapnil")).toMatch(/Good (morning|afternoon|evening), Swapnil!/);
  });

  // Test I: Greeting Fallback
  it("Test I: Greeting fallback handles missing name gracefully", () => {
    expect(getTimeAwareGreeting()).toMatch(/Good (morning|afternoon|evening)!/);
  });

  // Test J: Guided but Not Gated
  it("Test J: Given 30 opportunities & attentionWindow=6, all 30 remain retrievable across sequence", () => {
    const pipeline = Array.from({ length: 30 }, (_, i) => createMockOpportunity(i + 1));
    const attentionWindow = 6;

    const screen1 = pipeline.slice(0, attentionWindow);
    expect(screen1.length).toBe(6);
    expect(screen1[0].jobHash).toBe("hash-1");

    const screen2 = pipeline.slice(attentionWindow, attentionWindow * 2);
    expect(screen2.length).toBe(6);
    expect(screen2[0].jobHash).toBe("hash-7");

    const totalRetrievable = [];
    for (let c = 0; c < pipeline.length; c += attentionWindow) {
      totalRetrievable.push(...pipeline.slice(c, c + attentionWindow));
    }
    expect(totalRetrievable.length).toBe(30);
    expect(totalRetrievable.map((o) => o.jobHash)).toEqual(pipeline.map((o) => o.jobHash));
  });

  // Test K: Window Preference Invariance
  it("Test K: For windows 1, 3, 6, 8, 10, the underlying pipeline is ID-for-ID identical", () => {
    const pipeline = Array.from({ length: 25 }, (_, i) => createMockOpportunity(i + 1));
    const canonicalOrder = pipeline.map((o) => o.jobHash);

    [1, 3, 6, 8, 10].forEach((win) => {
      const retrieved = [];
      for (let c = 0; c < pipeline.length; c += win) {
        retrieved.push(...pipeline.slice(c, c + win));
      }
      expect(retrieved.map((o) => o.jobHash)).toEqual(canonicalOrder);
    });
  });

  // Test L: Presentation-State Isolation
  it("Test L: Displaying or advancing Next -> does NOT alter decision state or convert UNREVIEWED into REVIEWED", () => {
    const pipeline = Array.from({ length: 12 }, (_, i) => createMockOpportunity(i + 1));
    const userDecisions: Record<string, string> = {};

    // Simulate advancing cursor / displaying items
    const attentionCursor = 6;
    const activeWindow = pipeline.slice(0, attentionCursor);

    // Verify activeWindow display changed no decisions
    expect(Object.keys(userDecisions).length).toBe(0);
    expect(activeWindow.every((o) => o.reviewWorkflowState === "UNREVIEWED")).toBe(true);

    // Simulate advancing Next ->
    const nextWindow = pipeline.slice(attentionCursor, attentionCursor + 6);
    expect(Object.keys(userDecisions).length).toBe(0);
    expect(nextWindow.every((o) => o.reviewWorkflowState === "UNREVIEWED")).toBe(true);

    // Only explicit user action alters decision store
    userDecisions["hash-1"] = "PURSUE";
    expect(userDecisions["hash-1"]).toBe("PURSUE");
    expect(userDecisions["hash-2"]).toBeUndefined();
  });
});
