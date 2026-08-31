import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { SqliteScrapeRunStore } from "../../src/data/sqlite/repositories/SqliteScrapeRunStore";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import fs from "fs";
import path from "path";
import { splitSqlStatements } from "../../src/data/sqlite/migrations/runner";

// Target Owner Scope
const ownerScope = { tenantId: "tenant_A", personId: "person_1", roles: [] };

// Negative Matrix Scopes:
// 1. Same tenant + different person
const intruder_sameTenant_diffPerson = { tenantId: "tenant_A", personId: "person_2", roles: [] };
// 2. Different tenant + same person ID
const intruder_diffTenant_samePersonId = { tenantId: "tenant_B", personId: "person_1", roles: [] };
// 3. Different tenant + different person
const intruder_diffTenant_diffPerson = { tenantId: "tenant_B", personId: "person_B_diff", roles: [] };

describe("Phase 4A: Scrape Run Multi-Tenant Ownership & Security Isolation", () => {
  let db: SqliteAdapter;
  let store: SqliteScrapeRunStore;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);

    // Set up fixtures for negative matrix
    await db.execute(`INSERT OR IGNORE INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, [
      "person_1",
      "p1@a.com",
      "tenant_A",
    ]);
    await db.execute(`INSERT OR IGNORE INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, [
      "person_2",
      "p2@a.com",
      "tenant_A",
    ]);
    await db.execute(`INSERT OR IGNORE INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, [
      "person_B_diff",
      "pb@b.com",
      "tenant_B",
    ]);

    await db.execute(`INSERT OR IGNORE INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) VALUES (?, ?, ?, ?, 'active', '{}')`, [
      "plan_A1",
      "tenant_A",
      "person_1",
      "Plan A1",
    ]);
    await db.execute(`INSERT OR IGNORE INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) VALUES (?, ?, ?, ?, 'active', '{}')`, [
      "plan_A2",
      "tenant_A",
      "person_2",
      "Plan A2",
    ]);
    await db.execute(`INSERT OR IGNORE INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) VALUES (?, ?, ?, ?, 'active', '{}')`, [
      "plan_B_diff",
      "tenant_B",
      "person_B_diff",
      "Plan B diff",
    ]);

    store = new SqliteScrapeRunStore(db);
  });

  it("1. Negative Matrix: unauthorized scopes cannot read or locate another's scrape run", async () => {
    const ownerRun = await store.createRun(ownerScope, {
      id: "run-owner-secret",
      searchPlanId: "plan_A1",
      portalTargets: ["LinkedIn"],
    });

    // Owner can read
    expect(await store.getRun(ownerScope, ownerRun.id)).not.toBeNull();

    // 1. Same tenant + different person -> strictly null
    expect(await store.getRun(intruder_sameTenant_diffPerson, ownerRun.id)).toBeNull();

    // 2. Different tenant + same person ID -> strictly null
    expect(await store.getRun(intruder_diffTenant_samePersonId, ownerRun.id)).toBeNull();

    // 3. Different tenant + different person -> strictly null
    expect(await store.getRun(intruder_diffTenant_diffPerson, ownerRun.id)).toBeNull();
  });

  it("2. Negative Matrix: unauthorized scopes cannot mutate status or abort another's run", async () => {
    const ownerRun = await store.createRun(ownerScope, {
      id: "run-owner-abort-test",
      searchPlanId: "plan_A1",
      portalTargets: ["LinkedIn"],
      initialStatus: "running",
    });

    // 1. Same tenant + different person cannot abort
    const res1 = await store.updateRunStatus(intruder_sameTenant_diffPerson, ownerRun.id, "aborted");
    expect(res1).toBe(false);

    // 2. Different tenant + same person ID cannot abort
    const res2 = await store.updateRunStatus(intruder_diffTenant_samePersonId, ownerRun.id, "aborted");
    expect(res2).toBe(false);

    // 3. Different tenant + different person cannot abort
    const res3 = await store.updateRunStatus(intruder_diffTenant_diffPerson, ownerRun.id, "aborted");
    expect(res3).toBe(false);

    // Verify owner's run remains unmutated
    const current = await store.getRun(ownerScope, ownerRun.id);
    expect(current?.status).toBe("running");

    // Owner can abort
    const ownerAbortRes = await store.updateRunStatus(ownerScope, ownerRun.id, "aborted");
    expect(ownerAbortRes).toBe(true);
    expect((await store.getRun(ownerScope, ownerRun.id))?.status).toBe("aborted");
  });

  it("3. Negative Matrix: unauthorized scopes cannot view or append audit events", async () => {
    const ownerRun = await store.createRun(ownerScope, {
      id: "run-owner-events",
      searchPlanId: "plan_A1",
      portalTargets: ["LinkedIn"],
    });

    await store.recordEvent(ownerScope, ownerRun.id, {
      stage: "DISCOVERY",
      eventType: "PAGE_PROCESSED",
      payload: { count: 10 },
    });

    // Owner sees 1 event
    expect(await store.listEvents(ownerScope, ownerRun.id)).toHaveLength(1);

    // Intruders cannot list events (empty list)
    expect(await store.listEvents(intruder_sameTenant_diffPerson, ownerRun.id)).toHaveLength(0);
    expect(await store.listEvents(intruder_diffTenant_samePersonId, ownerRun.id)).toHaveLength(0);
    expect(await store.listEvents(intruder_diffTenant_diffPerson, ownerRun.id)).toHaveLength(0);
  });

  it("4. Negative Matrix: getLatestRun never bleeds runs across tenants or persons", async () => {
    await store.createRun(ownerScope, {
      id: "run-owner-latest",
      searchPlanId: "plan_A1",
      portalTargets: ["LinkedIn"],
    });

    // Owner sees their latest run
    const ownerLatest = await store.getLatestRun(ownerScope);
    expect(ownerLatest?.id).toBe("run-owner-latest");

    // Intruders have zero runs
    expect(await store.getLatestRun(intruder_sameTenant_diffPerson)).toBeNull();
    expect(await store.getLatestRun(intruder_diffTenant_samePersonId)).toBeNull();
    expect(await store.getLatestRun(intruder_diffTenant_diffPerson)).toBeNull();
  });
});
