/**
 * src/lib/intelligence/serving/singleflight.ts
 *
 * RADAR v2 — Phase 10 In-Flight Request Singleflighting.
 *
 * Coalesces concurrent identical in-flight requests to eliminate thundering herds
 * across the Turso Cloud WAN serving path.
 *
 * Invariants:
 * 1. Scope-Safe: Keys strictly incorporate tenantId + personId + queryType + normalized parameters.
 * 2. Transient Lifecycle: Entries are removed immediately on resolution AND rejection.
 * 3. Zero Persistent Caching: Only concurrently active Promises are coalesced.
 * 4. Error Propagation: Failed in-flight operations reject cleanly to all coalesced callers.
 */

import type { AuthorizedPersonScope } from "../../security/auth";
import type {
  OpportunityQueries,
  FeedSummary,
  FeedPage,
  FeedFilters,
  NavigationContext,
  OpaqueCursor,
} from "../opportunity-queries";
import type { CanonicalOpportunityMetrics } from "../metric-integrity";
import type { ServedOpportunity } from "../../../data/opportunity-fixtures";
import { servingTelemetry, ServingStopwatch } from "./observability";
import { getRepositories } from "../../../data/sqlite/provider";

export interface SingleflightResult<T> {
  readonly result: T;
  readonly coalesced: boolean;
}

export class SingleflightGroup {
  private inFlight = new Map<string, Promise<any>>();

  /**
   * Executes fn or coalesces onto an existing in-flight Promise for the given key.
   * Guarantees the in-flight entry is removed upon completion (success or error).
   */
  async do<T>(key: string, fn: () => Promise<T>): Promise<SingleflightResult<T>> {
    const existing = this.inFlight.get(key);
    if (existing) {
      const result = await existing;
      return { result, coalesced: true };
    }

    const promise = fn();
    this.inFlight.set(key, promise);

    try {
      const result = await promise;
      return { result, coalesced: false };
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Scope-safe key builder ensuring complete tenant, person, search-plan, and parameter isolation.
   */
  static buildKey(
    scope: { tenantId: string; personId: string; activeSearchPlanId?: string; searchPlanId?: string },
    queryType: string,
    params: Record<string, unknown>
  ): string {
    const planId = scope.activeSearchPlanId || (scope as any).searchPlanId || "default";
    const sortedEntries = Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => a.localeCompare(b));
    const paramStr = JSON.stringify(sortedEntries);
    return `${scope.tenantId}:${scope.personId}:${planId}:${queryType}:${paramStr}`;
  }

  /**
   * Returns the count of currently active in-flight requests.
   */
  get activeCount(): number {
    return this.inFlight.size;
  }
}

/**
 * Decorator that adds scope-safe in-flight singleflighting to any OpportunityQueries implementation.
 */
export class SingleflightOpportunityQueries implements OpportunityQueries {
  private group: SingleflightGroup;

  constructor(
    private inner: OpportunityQueries,
    group?: SingleflightGroup
  ) {
    this.group = group || new SingleflightGroup();
  }

  /**
   * Returns the durable process-level singleton instance of SingleflightOpportunityQueries.
   * Survives across SSR requests and Nitro server function invocations.
   */
  public static getGlobalInstance(rawQueries?: OpportunityQueries): SingleflightOpportunityQueries {
    const g = globalThis as any;
    if (!g.__RADAR_SINGLEFLIGHT_OPPORTUNITY_QUERIES__) {
      const inner = rawQueries || getRepositories().canonicalServing;
      g.__RADAR_SINGLEFLIGHT_OPPORTUNITY_QUERIES__ = new SingleflightOpportunityQueries(inner);
    }
    return g.__RADAR_SINGLEFLIGHT_OPPORTUNITY_QUERIES__;
  }

  /**
   * Overrides the global singleton instance (useful for test harnesses).
   */
  public static setGlobalInstance(instance: SingleflightOpportunityQueries | null): void {
    const g = globalThis as any;
    if (instance === null) {
      delete g.__RADAR_SINGLEFLIGHT_OPPORTUNITY_QUERIES__;
    } else {
      g.__RADAR_SINGLEFLIGHT_OPPORTUNITY_QUERIES__ = instance;
    }
  }

  /**
   * Resets the global singleton instance.
   */
  public static resetGlobalInstance(): void {
    const g = globalThis as any;
    delete g.__RADAR_SINGLEFLIGHT_OPPORTUNITY_QUERIES__;
  }

  /**
   * Returns the number of currently in-flight coalesced operations.
   */
  public get inFlightCount(): number {
    return this.group.activeCount;
  }

  async getFeed(
    scope: AuthorizedPersonScope,
    cursor?: OpaqueCursor,
    filters?: FeedFilters,
    pageSize?: number
  ): Promise<FeedPage> {
    const stopwatch = new ServingStopwatch();
    const key = SingleflightGroup.buildKey(scope, "feed", { cursor, ...filters, pageSize });

    const { result, coalesced } = await this.group.do(key, async () => {
      return await (this.inner as any).getFeed(scope, cursor, filters, pageSize, stopwatch);
    });

    const timings = stopwatch.finish();
    servingTelemetry.emit({
      queryType: "feed",
      tenantId: scope.tenantId,
      personId: scope.personId,
      timings,
      coalesced,
      itemCount: result.items.length,
    });

    return result;
  }

  async getMetrics(scope: AuthorizedPersonScope): Promise<CanonicalOpportunityMetrics> {
    const stopwatch = new ServingStopwatch();
    const key = SingleflightGroup.buildKey(scope, "metrics", {});

    const { result, coalesced } = await this.group.do(key, async () => {
      return await (this.inner as any).getMetrics(scope, stopwatch);
    });

    const timings = stopwatch.finish();
    servingTelemetry.emit({
      queryType: "metrics",
      tenantId: scope.tenantId,
      personId: scope.personId,
      timings,
      coalesced,
      itemCount: result.totalScreened,
    });

    return result;
  }

  async getDossier(
    scope: AuthorizedPersonScope,
    jobHash: string
  ): Promise<ServedOpportunity | null> {
    const stopwatch = new ServingStopwatch();
    const key = SingleflightGroup.buildKey(scope, "dossier", { jobHash });

    const { result, coalesced } = await this.group.do(key, async () => {
      return await (this.inner as any).getDossier(scope, jobHash, stopwatch);
    });

    const timings = stopwatch.finish();
    servingTelemetry.emit({
      queryType: "dossier",
      tenantId: scope.tenantId,
      personId: scope.personId,
      timings,
      coalesced,
      itemCount: result ? 1 : 0,
    });

    return result;
  }

  async getNavigation(
    scope: AuthorizedPersonScope,
    jobHash: string,
    filters?: FeedFilters
  ): Promise<NavigationContext | null> {
    const stopwatch = new ServingStopwatch();
    const key = SingleflightGroup.buildKey(scope, "navigation", { jobHash, ...filters });

    const { result, coalesced } = await this.group.do(key, async () => {
      return await (this.inner as any).getNavigation(scope, jobHash, filters, stopwatch);
    });

    const timings = stopwatch.finish();
    servingTelemetry.emit({
      queryType: "navigation",
      tenantId: scope.tenantId,
      personId: scope.personId,
      timings,
      coalesced,
      itemCount: result ? result.totalCount : 0,
    });

    return result;
  }
}
