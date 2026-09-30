import Database from "better-sqlite3";
import { beforeEach, describe, expect, test } from "vitest";
import { SqliteAdapter } from "@/data/database/sqlite";
import { runMigrations } from "@/data/sqlite/migrations/runner";
import { TenantScopedPersonStore } from "@/data/sqlite/repositories/TenantScopedPersonStore";
import type { CandidateProjection } from "@/candidate/projection";

const scopeA = { tenantId: "tenant_alpha", personId: "user_alpha" };
const scopeB = { tenantId: "tenant_beta", personId: "user_beta" };

const projectionCCO: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["ev_1"] },
  workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["ev_2"] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_3"] },
  commercialScope: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_4"] },
  yearsOfExperience: 22,
  coreCapabilities: ["COMMERCIAL_GROWTH", "GLOBAL_GTM", "MARKETING_LEADERSHIP", "P_AND_L_MANAGEMENT"],
  preferredLocations: ["Bengaluru", "Remote"],
  preferredWorkModel: "HYBRID",
  executiveThemes: ["commercial_growth", "gtm_scale"],
  attentionWindow: 6,
  headspaceCapacityPerMonth: 4,
};

const projectionCTO: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["ev_5"] },
  workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["ev_6"] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_7"] },
  commercialScope: { value: "NONE", confidence: 0.95, evidenceIds: ["ev_8"] },
  yearsOfExperience: 18,
  coreCapabilities: ["SOFTWARE_ENGINEERING", "SYSTEM_ARCHITECTURE", "CLOUD_INFRASTRUCTURE", "TECH_LEADERSHIP"],
  preferredLocations: ["San Francisco", "Remote"],
  preferredWorkModel: "REMOTE",
  executiveThemes: ["cloud_infrastructure", "engineering_scale"],
  attentionWindow: 4,
  headspaceCapacityPerMonth: 2,
};

describe("candidate profile tenant isolation", () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await runMigrations(db);
    await db.execute("INSERT INTO tenants (id, status) VALUES ('tenant_alpha', 'active'), ('tenant_beta', 'active')");
    await db.execute("INSERT INTO people (id, email, tenant_id) VALUES ('user_alpha', 'cco@alpha.internal', 'tenant_alpha'), ('user_beta', 'cto@beta.internal', 'tenant_beta')");
    await new TenantScopedPersonStore(db, scopeA).saveProjection(scopeA.personId, projectionCCO);
    await new TenantScopedPersonStore(db, scopeB).saveProjection(scopeB.personId, projectionCTO);
  });

  test("tenant A resolves only its authoritative candidate projection", async () => {
    const projection = await new TenantScopedPersonStore(db, scopeA).getLatestProjection(scopeA.personId);
    expect(projection?.coreCapabilities).toContain("COMMERCIAL_GROWTH");
    expect(projection?.yearsOfExperience).toBe(22);
  });

  test("tenant B resolves only its authoritative candidate projection", async () => {
    const projection = await new TenantScopedPersonStore(db, scopeB).getLatestProjection(scopeB.personId);
    expect(projection?.coreCapabilities).toContain("SYSTEM_ARCHITECTURE");
    expect(projection?.yearsOfExperience).toBe(18);
  });

  test("a scoped candidate store rejects another person's projection", async () => {
    const store = new TenantScopedPersonStore(db, scopeA);
    await expect(store.getLatestProjection(scopeB.personId)).rejects.toThrow(/Access denied/);
  });
});
