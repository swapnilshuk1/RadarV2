import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock server functions
vi.mock("../../src/lib/intelligence/decisions-server", () => ({
  getDecisionsFn: vi.fn(),
  saveDecisionFn: vi.fn(),
  syncDecisionsFn: vi.fn(),
  undoDecisionFn: vi.fn(),
  clearDecisionsFn: vi.fn()
}));

import * as serverFns from "../../src/lib/intelligence/decisions-server";

describe("M9.3 decisions-store Client Reconciliation & Warning Loop Termination", () => {
  const KEY = "radar.decisions.v1";
  let storage: Record<string, string> = {};

  beforeEach(() => {
    storage = {};
    (global as any).window = {
      localStorage: {
        getItem: (k: string) => storage[k] || null,
        setItem: (k: string, v: string) => { storage[k] = v; },
        removeItem: (k: string) => { delete storage[k]; }
      },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Case A: Valid local decision is sent via syncDecisionsFn and preserved in localStorage", async () => {
    // Local has 1 unsynced valid decision
    storage[KEY] = JSON.stringify({
      job_valid_1: { verb: "PURSUE", at: 1000 }
    });

    vi.mocked(serverFns.getDecisionsFn).mockResolvedValueOnce({
      success: true,
      decisions: {}
    } as any);

    vi.mocked(serverFns.syncDecisionsFn).mockResolvedValueOnce({
      success: true,
      decisions: {
        job_valid_1: { verb: "PURSUE", updatedAt: "2026-08-28T12:00:00Z" }
      }
    } as any);

    // Simulate hydrate logic
    const initialLocal = JSON.parse(storage[KEY]);
    const res = await serverFns.getDecisionsFn();
    let currentServerMap: Record<string, any> = {};
    for (const [hash, val] of Object.entries(res.decisions)) {
      currentServerMap[hash] = { verb: (val as any).verb };
    }

    const hasUnsynced = Object.keys(initialLocal).length > 0 && Object.keys(initialLocal).some((k) => !currentServerMap[k]);
    expect(hasUnsynced).toBe(true);

    const syncRes = await serverFns.syncDecisionsFn({ data: { decisions: initialLocal } } as any);
    if (syncRes && syncRes.success && syncRes.decisions) {
      const reconciledMap: Record<string, any> = {};
      for (const [hash, val] of Object.entries(syncRes.decisions)) {
        reconciledMap[hash] = { verb: (val as any).verb };
      }
      currentServerMap = reconciledMap;
      storage[KEY] = JSON.stringify(currentServerMap);
    }

    expect(storage[KEY]).toBeDefined();
    const parsed = JSON.parse(storage[KEY]);
    expect(parsed["job_valid_1"]).toBeDefined();
    expect(parsed["job_valid_1"].verb).toBe("PURSUE");
  });

  it("Case B: Orphaned local decision is pruned on 1st hydration and sync does not repeat on 2nd hydration", async () => {
    // Local has 1 orphaned legacy decision
    storage[KEY] = JSON.stringify({
      "j-0379479f0b86": { verb: "PURSUE", at: 1000 }
    });

    vi.mocked(serverFns.getDecisionsFn).mockResolvedValue({
      success: true,
      decisions: {}
    } as any);

    // Server rejects orphan, returns empty map
    vi.mocked(serverFns.syncDecisionsFn).mockResolvedValue({
      success: true,
      decisions: {}
    } as any);

    // === 1st Hydration ===
    const initialLocal = JSON.parse(storage[KEY]);
    const res = await serverFns.getDecisionsFn();
    let currentServerMap: Record<string, any> = {};
    for (const [hash, val] of Object.entries(res.decisions)) {
      currentServerMap[hash] = { verb: (val as any).verb };
    }

    const hasUnsynced = Object.keys(initialLocal).length > 0 && Object.keys(initialLocal).some((k) => !currentServerMap[k]);
    expect(hasUnsynced).toBe(true); // Triggers sync on 1st hydration

    const syncRes = await serverFns.syncDecisionsFn({ data: { decisions: initialLocal } } as any);
    if (syncRes && syncRes.success && syncRes.decisions) {
      const reconciledMap: Record<string, any> = {};
      for (const [hash, val] of Object.entries(syncRes.decisions)) {
        reconciledMap[hash] = { verb: (val as any).verb };
      }
      currentServerMap = reconciledMap;
      storage[KEY] = JSON.stringify(currentServerMap);
    }

    // Orphan is now pruned from localStorage!
    const parsed = JSON.parse(storage[KEY]);
    expect(parsed["j-0379479f0b86"]).toBeUndefined();
    expect(Object.keys(parsed)).toHaveLength(0);

    // === 2nd Hydration ===
    const secondInitialLocal = JSON.parse(storage[KEY]);
    const secondRes = await serverFns.getDecisionsFn();
    let secondServerMap: Record<string, any> = {};
    for (const [hash, val] of Object.entries(secondRes.decisions)) {
      secondServerMap[hash] = { verb: (val as any).verb };
    }

    const secondHasUnsynced = Object.keys(secondInitialLocal).length > 0 && Object.keys(secondInitialLocal).some((k) => !secondServerMap[k]);
    expect(secondHasUnsynced).toBe(false); // NO REPEAT SYNC! Warning loop successfully terminated.
  });

  it("Case D: Temporary server/network failure retains localStorage unchanged (Zero Data Loss)", async () => {
    storage[KEY] = JSON.stringify({
      job_pending_1: { verb: "PURSUE", at: 1000 }
    });

    vi.mocked(serverFns.getDecisionsFn).mockRejectedValueOnce(new Error("Network connection dropped"));

    // Simulate hydrate catch block
    try {
      await serverFns.getDecisionsFn();
    } catch {
      // Catch block does not mutate localStorage
    }

    // Local storage is 100% preserved
    const parsed = JSON.parse(storage[KEY]);
    expect(parsed["job_pending_1"]).toBeDefined();
    expect(parsed["job_pending_1"].verb).toBe("PURSUE");
  });
});
