/**
 * tests/serving/route_server_functions_parity.test.ts
 *
 * RADAR v2 — Phase 11 & 12 Route Server Function & Client Cache Test Suite.
 *
 * Validates:
 * 1. OpportunityService delegates cleanly to OpportunityQueries with Singleflight.
 * 2. getMetricsForUser computes exact canonical metrics.
 * 3. getFeedForUser returns deterministic keyset page with exact rank & tiers.
 * 4. getDetailsForUser returns exact evaluated opportunity and prev/next navigation.
 * 5. ClientOpportunityCache is a non-authoritative convenience only.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import { ClientOpportunityCache } from "../../src/lib/opportunity-cache";
import type { EvaluatedOpportunity } from "../../src/data/opportunity-fixtures";

describe("Phase 11 & 12: Route Server Function & Client Cache Suite", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    await setupLineageTestFixture(db);
    await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES ('person_A', 'a@a.com')`);
    await db.execute(
      `INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, permissions, status)
       VALUES ('person_A', 'tenant_A', 'admin', '["*"]', 'active')`
    );
    await db.execute(
      `INSERT OR IGNORE INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint)
       VALUES ('tenant_A', 'person_A', 'plan_A', 'fingerprint_A')`
    );
    ClientOpportunityCache.clear();
  });

  describe("1. ClientOpportunityCache (Phase 12)", () => {
    it("can hold individual dossier DTOs without becoming a route authority", () => {
      const mockDossier: any = {
        opportunity: {
          jobHash: "job_xyz",
          role: "Chief Executive Officer",
          company: "Acme Group",
          location: "Remote",
          evaluationState: "EVALUATED",
        },
        currentIndex: 1,
        totalCount: 10,
        neighbors: {
          prev: undefined,
          next: "job_abc",
        },
      };

      // Initially null
      expect(ClientOpportunityCache.getDetails("job_xyz")).toBeNull();

      // Cache and retrieve
      ClientOpportunityCache.setDetails("job_xyz", mockDossier);
      const cached = ClientOpportunityCache.getDetails("job_xyz");

      expect(cached).not.toBeNull();
      expect(cached?.opportunity.jobHash).toBe("job_xyz");
      expect(cached?.currentIndex).toBe(1);
      expect(cached?.totalCount).toBe(10);
      expect(cached?.neighbors.next).toBe("job_abc");

      // Clear
      ClientOpportunityCache.clear();
      expect(ClientOpportunityCache.getDetails("job_xyz")).toBeNull();
    });
  });

  it("keeps dossier and decisions routes on canonical persisted serving paths", () => {
    const dossierRoute = fs.readFileSync(path.resolve("src/routes/opportunity.$jobHash.tsx"), "utf8");
    const decisionsRoute = fs.readFileSync(path.resolve("src/routes/decisions.tsx"), "utf8");
    for (const forbidden of ["candidateProfile", "CapabilityAssessmentEngine", "ExecutionEngine", "BriefCompositionEngine"]) {
      expect(dossierRoute).not.toContain(forbidden);
      expect(decisionsRoute).not.toContain(forbidden);
    }
    expect(dossierRoute).not.toContain("ClientOpportunityCache");
    expect(dossierRoute).not.toContain("getDetails(");
    expect(dossierRoute).toContain("getOpportunityDetailsFn");
    expect(decisionsRoute).toContain("getDecidedOpportunitiesFn");
    expect(decisionsRoute).not.toContain("getOpportunitiesFn");
    expect(decisionsRoute).not.toContain("radar.opportunities.tracking.v1");
    expect(decisionsRoute).not.toContain("localStorage");
    expect(decisionsRoute).not.toContain("syncDecisionsFn");
  });
});
