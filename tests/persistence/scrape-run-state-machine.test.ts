import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import {
  SqliteScrapeRunStore,
  ActiveScrapeRunExistsError,
} from "../../src/data/sqlite/repositories/SqliteScrapeRunStore";
import { setupLineageTestFixture } from "./lineage_fixture";
import fs from "fs";
import path from "path";
import { splitSqlStatements } from "../../src/data/sqlite/migrations/runner";

const scopeA = { tenantId: "tenant_A", personId: "person_A", roles: [] };
const scopeB = { tenantId: "tenant_B", personId: "person_B", roles: [] };
const scopeA_person2 = { tenantId: "tenant_A", personId: "person_A2", roles: [] };

describe("Phase 4A: Scrape Run State Machine & Atomic Uniqueness Contract", () => {
  let db: SqliteAdapter;
  let store: SqliteScrapeRunStore;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);

    // Insert required fixture people and search plans
    await db.execute(`INSERT OR IGNORE INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, [
      "person_A2",
      "a2@test.com",
      "tenant_A",
    ]);
    await db.execute(`INSERT OR IGNORE INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) VALUES (?, ?, ?, ?, 'active', '{}')`, [
      "plan_A2",
      "tenant_A",
      "person_A2",
      "Plan A2",
    ]);

    store = new SqliteScrapeRunStore(db);
  });

  it("1. Atomic Race Test: 2 concurrent createRun calls for the same scope -> exactly 1 succeeds, 1 rejected", async () => {
    const p1 = store.createRun(scopeA, {
      id: "run-race-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });

    const p2 = store.createRun(scopeA, {
      id: "run-race-2",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedError).toBeInstanceOf(ActiveScrapeRunExistsError);
    expect(rejectedError.tenantId).toBe("tenant_A");
    expect(rejectedError.personId).toBe("person_A");

    // Invariant: Exactly one active run in the database
    const active = await store.getActiveRun(scopeA);
    expect(active).not.toBeNull();
    expect(active?.status).toBe("initializing");
  });

  it("2. Cross-Tenant Concurrency: Tenant A and Tenant B both create active runs without blocking", async () => {
    const [runA, runB] = await Promise.all([
      store.createRun(scopeA, {
        id: "run-tenant-a",
        searchPlanId: "plan_A",
        portalTargets: ["LinkedIn"],
      }),
      store.createRun(scopeB, {
        id: "run-tenant-b",
        searchPlanId: "plan_B",
        portalTargets: ["Naukri"],
      }),
    ]);

    expect(runA.id).toBe("run-tenant-a");
    expect(runB.id).toBe("run-tenant-b");

    const activeA = await store.getActiveRun(scopeA);
    const activeB = await store.getActiveRun(scopeB);

    expect(activeA?.id).toBe("run-tenant-a");
    expect(activeB?.id).toBe("run-tenant-b");
  });

  it("3. Cross-Person Concurrency: Distinct persons in the same tenant do not block each other", async () => {
    const [run1, run2] = await Promise.all([
      store.createRun(scopeA, {
        id: "run-person-1",
        searchPlanId: "plan_A",
        portalTargets: ["LinkedIn"],
      }),
      store.createRun(scopeA_person2, {
        id: "run-person-2",
        searchPlanId: "plan_A2",
        portalTargets: ["Indeed"],
      }),
    ]);

    expect(run1.id).toBe("run-person-1");
    expect(run2.id).toBe("run-person-2");

    expect(await store.hasActiveRun(scopeA)).toBe(true);
    expect(await store.hasActiveRun(scopeA_person2)).toBe(true);
  });

  it("4. Terminal State Immutability: completed/failed/aborted runs cannot be reopened", async () => {
    const run = await store.createRun(scopeA, {
      id: "run-term-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });

    // Move to running
    await store.updateRunStatus(scopeA, run.id, "running");
    let current = await store.getRun(scopeA, run.id);
    expect(current?.status).toBe("running");

    // Move to terminal state 'completed'
    await store.updateRunStatus(scopeA, run.id, "completed");
    current = await store.getRun(scopeA, run.id);
    expect(current?.status).toBe("completed");
    expect(current?.finishedAt).not.toBeNull();

    // Reopen attempt should be rejected (returns false, row untouched)
    const reopened = await store.updateRunStatus(scopeA, run.id, "running");
    expect(reopened).toBe(false);

    const rechecked = await store.getRun(scopeA, run.id);
    expect(rechecked?.status).toBe("completed"); // Must remain terminal!

    // Invariant: Once terminal, scope is freed to create a new run
    expect(await store.hasActiveRun(scopeA)).toBe(false);
    const nextRun = await store.createRun(scopeA, {
      id: "run-term-2",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });
    expect(nextRun.id).toBe("run-term-2");
  });

  it("5. Crash & Restart Durability: Run state and audit events survive database reconnection", async () => {
    const run = await store.createRun(scopeA, {
      id: "run-survive-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn", "Naukri"],
    });

    await store.updateRunStatus(scopeA, run.id, "running");
    await store.updateRunMetrics(scopeA, run.id, {
      totalDiscovered: 42,
      totalEnqueued: 10,
      metrics: { httpSuccessful: 35 },
    });

    await store.recordEvent(scopeA, run.id, {
      stage: "DISCOVERY",
      portal: "LinkedIn",
      eventType: "PAGE_PROCESSED",
      payload: { page: 1, count: 25 },
    });

    await store.recordEvent(scopeA, run.id, {
      stage: "DISCOVERY",
      portal: "Naukri",
      eventType: "PAGE_PROCESSED",
      payload: { page: 1, count: 17 },
    });

    // Simulate process crash / reset store with fresh instance against same DB
    const freshStore = new SqliteScrapeRunStore(db);

    const recovered = await freshStore.getRun(scopeA, run.id);
    expect(recovered).not.toBeNull();
    expect(recovered?.status).toBe("running");
    expect(recovered?.totalDiscovered).toBe(42);
    expect(recovered?.totalEnqueued).toBe(10);
    expect(JSON.parse(recovered?.metricsJson || "{}")).toEqual({ httpSuccessful: 35 });

    const events = await freshStore.listEvents(scopeA, run.id);
    expect(events).toHaveLength(2);
    expect(events[0].portal).toBe("LinkedIn");
    expect(events[1].portal).toBe("Naukri");
  });
});
