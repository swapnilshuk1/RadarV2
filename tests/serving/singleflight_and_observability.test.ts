/**
 * tests/serving/singleflight_and_observability.test.ts
 *
 * RADAR v2 — Phase 9 & 10 Singleflight & Observability Test Suite.
 *
 * Validates:
 * 1. Singleflight coalesces N concurrent identical requests into 1 execution.
 * 2. Scope isolation: Different tenants/users never coalesce together.
 * 3. Parameter isolation: Different filters/pages never coalesce together.
 * 4. Transient lifecycle: Map is completely empty after completion.
 * 5. Error handling: Rejections cleanly propagate to all waiters and reset.
 * 6. Observability: Telemetry is emitted with fine-grained timing breakdowns.
 */

import { describe, it, expect, vi } from "vitest";
import { SingleflightGroup, SingleflightOpportunityQueries } from "../../src/lib/intelligence/serving/singleflight";
import { servingTelemetry, type ServingTelemetry } from "../../src/lib/intelligence/serving/observability";
import type { OpportunityQueries, FeedPage, NavigationContext } from "../../src/lib/intelligence/opportunity-queries";
import type { AuthorizedPersonScope } from "../../src/lib/security/auth";
import type { CanonicalOpportunityMetrics } from "../../src/lib/intelligence/metric-integrity";
import type { ServedOpportunity } from "../../src/data/opportunity-fixtures";

describe("Phase 9 & 10: Singleflight & Observability Suite", () => {
  const scopeA: AuthorizedPersonScope = { tenantId: "tenant_A", personId: "person_A", role: "member" };
  const scopeB: AuthorizedPersonScope = { tenantId: "tenant_B", personId: "person_B", role: "member" };

  it("coalesces 10 concurrent identical calls into exactly 1 underlying execution", async () => {
    let callCount = 0;
    const mockQueries: OpportunityQueries = {
      getFeed: vi.fn(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return { items: [], totalCount: 0, hasMore: false } as FeedPage;
      }),
      getMetrics: vi.fn(async () => ({} as CanonicalOpportunityMetrics)),
      getDossier: vi.fn(async () => null),
      getNavigation: vi.fn(async () => null),
    };

    const sfQueries = new SingleflightOpportunityQueries(mockQueries);

    // Fire 10 concurrent requests
    const promises = Array.from({ length: 10 }).map(() => sfQueries.getFeed(scopeA));
    const results = await Promise.all(promises);

    expect(results).toHaveLength(10);
    expect(callCount).toBe(1);
    expect(mockQueries.getFeed).toHaveBeenCalledTimes(1);
  });

  it("strictly isolates different scopes and parameters from coalescing", async () => {
    let callCount = 0;
    const mockQueries: OpportunityQueries = {
      getFeed: vi.fn(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return { items: [], totalCount: 0, hasMore: false } as FeedPage;
      }),
      getMetrics: vi.fn(async () => ({} as CanonicalOpportunityMetrics)),
      getDossier: vi.fn(async () => null),
      getNavigation: vi.fn(async () => null),
    };

    const sfQueries = new SingleflightOpportunityQueries(mockQueries);

    // Fire concurrent calls with different scopes & filters
    await Promise.all([
      sfQueries.getFeed(scopeA, undefined, { decisionFilter: "all" }),
      sfQueries.getFeed(scopeA, undefined, { decisionFilter: "decided" }),
      sfQueries.getFeed(scopeB, undefined, { decisionFilter: "all" }),
    ]);

    expect(callCount).toBe(3);
    expect(mockQueries.getFeed).toHaveBeenCalledTimes(3);
  });

  it("guarantees transient in-flight map lifecycle on resolution and rejection", async () => {
    const group = new SingleflightGroup();

    // 1. Success case
    expect(group.activeCount).toBe(0);
    const p1 = group.do("key_1", async () => {
      await new Promise((r) => setTimeout(r, 10));
      expect(group.activeCount).toBe(1);
      return "success";
    });
    await p1;
    expect(group.activeCount).toBe(0);

    // 2. Failure case
    const p2A = group.do("key_2", async () => {
      await new Promise((r) => setTimeout(r, 10));
      expect(group.activeCount).toBe(1);
      throw new Error("Network timeout");
    });
    const p2B = group.do("key_2", async () => "fallback");

    await expect(p2A).rejects.toThrow("Network timeout");
    await expect(p2B).rejects.toThrow("Network timeout");

    expect(group.activeCount).toBe(0);

    // 3. Subsequent call executes fresh
    const p3 = group.do("key_2", async () => "retry_success");
    const res3 = await p3;
    expect(res3.result).toBe("retry_success");
    expect(group.activeCount).toBe(0);
  });

  it("emits fine-grained telemetry with accurate timings and coalescing status", async () => {
    const telemetryEvents: ServingTelemetry[] = [];
    const unsubscribe = servingTelemetry.subscribe((t) => telemetryEvents.push(t));

    const mockQueries: OpportunityQueries = {
      getMetrics: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { totalScreened: 3002 } as CanonicalOpportunityMetrics;
      }),
      getFeed: vi.fn(async () => ({} as FeedPage)),
      getDossier: vi.fn(async () => null),
      getNavigation: vi.fn(async () => null),
    };

    const sfQueries = new SingleflightOpportunityQueries(mockQueries);

    // 2 concurrent calls
    await Promise.all([
      sfQueries.getMetrics(scopeA),
      sfQueries.getMetrics(scopeA),
    ]);

    unsubscribe();

    expect(telemetryEvents).toHaveLength(2);
    expect(telemetryEvents[0].queryType).toBe("metrics");
    expect(telemetryEvents[0].tenantId).toBe("tenant_A");
    expect(telemetryEvents[0].personId).toBe("person_A");
    expect(telemetryEvents[0].itemCount).toBe(3002);
    expect(telemetryEvents[0].timings.totalMs).toBeGreaterThanOrEqual(25);

    // Leader is coalesced: false, follower is coalesced: true
    const coalescedFlags = telemetryEvents.map((t) => t.coalesced).sort();
    expect(coalescedFlags).toEqual([false, true]);
  });
});
