/**
 * tests/serving/singleflight-scope-isolation.test.ts
 *
 * Checkpoint D: Serving Boundary Singleflight & Scope Isolation Certification Contract.
 *
 * Enforces:
 * 1. 10 identical concurrent service requests coalesce into exactly 1 underlying query.
 * 2. Complete scope independence: tenantId, personId, and searchPlanId isolate completely.
 * 3. Zero persistent cache retention: in-flight map drains to 0 immediately upon completion.
 * 4. Error isolation: failures reject all coalesced waiters and immediately drain the in-flight map.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SingleflightGroup, SingleflightOpportunityQueries } from "../../src/lib/intelligence/serving/singleflight";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import type { OpportunityQueries, FeedPage, NavigationContext } from "../../src/lib/intelligence/opportunity-queries";
import type { AuthorizedPersonScope } from "../../src/lib/security/auth";
import type { CanonicalOpportunityMetrics } from "../../src/lib/intelligence/metric-integrity";
import type { ServedOpportunity } from "../../src/data/opportunity-fixtures";

describe("Checkpoint D: Close Serving Boundary & Singleflight Invariants", () => {
  let mockInnerQueries: OpportunityQueries;
  let feedExecutionCount: number;
  let metricsExecutionCount: number;

  beforeEach(() => {
    feedExecutionCount = 0;
    metricsExecutionCount = 0;

    mockInnerQueries = {
      getFeed: vi.fn(async (scope, cursor, filters, pageSize) => {
        feedExecutionCount++;
        // Simulate realistic Turso Cloud WAN roundtrip delay
        await new Promise((r) => setTimeout(r, 40));
        return {
          items: [
            {
              jobHash: "hash_test_123",
              title: "Chief Product Officer",
              company: "TechCorp",
              location: "Bengaluru",
              verdict: "PURSUE",
              score: 92,
              primaryEvidence: "15+ yrs scale",
            } as any,
          ],
          totalCount: 1,
          hasMore: false,
        } as FeedPage;
      }),
      getMetrics: vi.fn(async (scope) => {
        metricsExecutionCount++;
        await new Promise((r) => setTimeout(r, 40));
        return {
          totalScreened: 3065,
          activePursuits: 460,
          evaluatedDecisions: 1498,
          allRecordedDecisions: 1508,
          actionableQueue: 121,
        } as CanonicalOpportunityMetrics;
      }),
      getDossier: vi.fn(async () => null),
      getNavigation: vi.fn(async () => null),
    };

    // Wire up global singleton with mock queries
    const singleton = new SingleflightOpportunityQueries(mockInnerQueries);
    SingleflightOpportunityQueries.setGlobalInstance(singleton);
  });

  afterEach(() => {
    SingleflightOpportunityQueries.resetGlobalInstance();
  });

  it("Invariant 1: 10 identical concurrent service requests coalesce into EXACTLY 1 underlying query", async () => {
    const singleton = SingleflightOpportunityQueries.getGlobalInstance();
    const scope: AuthorizedPersonScope = {
      tenantId: "tenant_alpha",
      personId: "person_swapnil",
      activeSearchPlanId: "plan_exec_2026",
    };

    // 10 concurrent requests triggered simultaneously
    const requests = Array.from({ length: 10 }).map(() =>
      singleton.getFeed(scope, undefined, { decisionFilter: "all" }, 24)
    );

    // Verify in-flight registration during resolution
    expect(singleton.inFlightCount).toBeGreaterThanOrEqual(1);

    const results = await Promise.all(requests);

    // All 10 requests received valid data
    expect(results).toHaveLength(10);
    results.forEach((res) => {
      expect(res.items).toHaveLength(1);
      expect(res.items[0].title).toBe("Chief Product Officer");
      expect(res.items[0].score).toBe(92);
    });

    // Exactly 1 underlying query was executed
    expect(feedExecutionCount).toBe(1);
    expect(mockInnerQueries.getFeed).toHaveBeenCalledTimes(1);

    // In-flight map is completely drained to 0
    expect(singleton.inFlightCount).toBe(0);
  });

  it("Invariant 2: Distinct search-plan scopes NEVER coalesce together", async () => {
    const singleton = SingleflightOpportunityQueries.getGlobalInstance();
    const scopePlanA: AuthorizedPersonScope = {
      tenantId: "tenant_alpha",
      personId: "person_swapnil",
      activeSearchPlanId: "plan_alpha",
    };
    const scopePlanB: AuthorizedPersonScope = {
      tenantId: "tenant_alpha",
      personId: "person_swapnil",
      activeSearchPlanId: "plan_beta",
    };

    // 2 concurrent calls with different search-plan IDs
    const [resA, resB] = await Promise.all([
      singleton.getFeed(scopePlanA, undefined, { decisionFilter: "all" }, 24),
      singleton.getFeed(scopePlanB, undefined, { decisionFilter: "all" }, 24),
    ]);

    expect(resA).toBeDefined();
    expect(resB).toBeDefined();
    // Must execute 2 distinct queries
    expect(feedExecutionCount).toBe(2);
    expect(mockInnerQueries.getFeed).toHaveBeenCalledTimes(2);
    expect(singleton.inFlightCount).toBe(0);
  });

  it("Invariant 3: Distinct tenant scopes NEVER coalesce together", async () => {
    const singleton = SingleflightOpportunityQueries.getGlobalInstance();
    const scopeTenantA: AuthorizedPersonScope = {
      tenantId: "tenant_alpha",
      personId: "user_common_id",
      activeSearchPlanId: "plan_common",
    };
    const scopeTenantB: AuthorizedPersonScope = {
      tenantId: "tenant_beta",
      personId: "user_common_id",
      activeSearchPlanId: "plan_common",
    };

    // 2 concurrent calls across different tenants
    await Promise.all([
      singleton.getFeed(scopeTenantA),
      singleton.getFeed(scopeTenantB),
    ]);

    expect(feedExecutionCount).toBe(2);
    expect(mockInnerQueries.getFeed).toHaveBeenCalledTimes(2);
    expect(singleton.inFlightCount).toBe(0);
  });

  it("Invariant 4: Distinct person scopes NEVER coalesce together", async () => {
    const singleton = SingleflightOpportunityQueries.getGlobalInstance();
    const scopeUser1: AuthorizedPersonScope = {
      tenantId: "tenant_alpha",
      personId: "user_person_1",
      activeSearchPlanId: "plan_1",
    };
    const scopeUser2: AuthorizedPersonScope = {
      tenantId: "tenant_alpha",
      personId: "user_person_2",
      activeSearchPlanId: "plan_1",
    };

    await Promise.all([
      singleton.getFeed(scopeUser1),
      singleton.getFeed(scopeUser2),
    ]);

    expect(feedExecutionCount).toBe(2);
    expect(mockInnerQueries.getFeed).toHaveBeenCalledTimes(2);
    expect(singleton.inFlightCount).toBe(0);
  });

  it("Invariant 5: Zero persistent cache retention — Sequential calls execute fresh queries", async () => {
    const singleton = SingleflightOpportunityQueries.getGlobalInstance();
    const scope: AuthorizedPersonScope = {
      tenantId: "tenant_alpha",
      personId: "person_swapnil",
      activeSearchPlanId: "plan_exec",
    };

    // First call
    await singleton.getMetrics(scope);
    expect(metricsExecutionCount).toBe(1);
    expect(singleton.inFlightCount).toBe(0);

    // Second sequential call AFTER first has completely resolved
    await singleton.getMetrics(scope);
    // Must execute a fresh query (call count increments to 2)
    expect(metricsExecutionCount).toBe(2);
    expect(singleton.inFlightCount).toBe(0);
  });

  it("Invariant 6: Error propagation — Rejections cleanly propagate to all 5 coalesced waiters and drain the map", async () => {
    let failCalls = 0;
    const failingQueries: OpportunityQueries = {
      getFeed: vi.fn(async () => {
        failCalls++;
        await new Promise((r) => setTimeout(r, 20));
        throw new Error("Turso WAN connection timeout");
      }),
      getMetrics: vi.fn(async () => ({} as CanonicalOpportunityMetrics)),
      getDossier: vi.fn(async () => null),
      getNavigation: vi.fn(async () => null),
    };

    const singleton = new SingleflightOpportunityQueries(failingQueries);
    const scope: AuthorizedPersonScope = {
      tenantId: "tenant_alpha",
      personId: "person_swapnil",
      activeSearchPlanId: "plan_exec",
    };

    // 5 concurrent requests hitting failing query
    const requests = Array.from({ length: 5 }).map(() => singleton.getFeed(scope));

    const settled = await Promise.allSettled(requests);
    expect(settled).toHaveLength(5);
    settled.forEach((s) => {
      expect(s.status).toBe("rejected");
      if (s.status === "rejected") {
        expect(s.reason.message).toContain("Turso WAN connection timeout");
      }
    });

    // Underlying function was only called once
    expect(failCalls).toBe(1);
    // Map was cleanly emptied despite error
    expect(singleton.inFlightCount).toBe(0);
  });

  it("Invariant 7: OpportunityService end-to-end integration uses process singleton across calls", async () => {
    const getGlobalSpy = vi.spyOn(SingleflightOpportunityQueries, "getGlobalInstance");
    const queries = (OpportunityService as any).getServingQueries();
    expect(queries).toBe(SingleflightOpportunityQueries.getGlobalInstance());
    expect(getGlobalSpy).toHaveBeenCalled();
  });
});
