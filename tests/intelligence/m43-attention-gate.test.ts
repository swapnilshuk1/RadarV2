import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { evaluateAttentionGate } from "@/lib/intelligence/AttentionGate";
import { AttentionService } from "@/lib/intelligence/AttentionService";
import type { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import type { OpportunityVersion } from "@/lib/domain/canonical_acquisition";
import type { SearchPlan, SearchCriteriaPayload } from "@/lib/domain/evaluation_context";

class TestSqliteAdapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params || []));
    return (row as T) || null;
  }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params || [])) as T[];
  }
  async execute(sql: string, params?: QueryParams): Promise<{
    rowsAffected: number;
    lastInsertRowid?: number | bigint | string;
  }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params || []));
    return { rowsAffected: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe("Phase M4.3: Attention Gate", () => {
  const baseVersion: OpportunityVersion = {
    id: "v1",
    canonicalJobId: "job1",
    contentHash: "hash1",
    jobTitle: "Senior Engineering Manager",
    companyName: "Tech Corp",
    location: "San Francisco, CA",
    employmentType: "Full-time",
    rawContent: "Lots of text",
    createdAt: new Date().toISOString()
  };

  const baseCriteria: SearchCriteriaPayload = {
    targetSeniority: [],
    targetRoles: [],
    targetLocations: []
  };

  describe("Deterministic Logic Rules", () => {
    test("1. Matching role -> CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetRoles: ["engineering manager"] });
      expect(res.decision).toBe("CANDIDATE");
    });

    test("2. Non-matching role -> NOT_CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetRoles: ["director of marketing"] });
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.reasons[0]).toMatch(/Role mismatch/);
    });

    test("3. Matching location -> CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetLocations: ["san francisco"] });
      expect(res.decision).toBe("CANDIDATE");
    });

    test("4. Explicitly incompatible location -> NOT_CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetLocations: ["new york"] });
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.reasons[0]).toMatch(/Location mismatch/);
    });

    test("5. Seniority mismatch -> NOT_CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetSeniority: ["vp", "vice president"] });
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.reasons[0]).toMatch(/Seniority mismatch/);
    });

    test("6. Employment-type mismatch -> NOT_CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetEmploymentTypes: ["Contract", "Part-time"] });
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.reasons[0]).toMatch(/Employment type mismatch/);
    });

    test("7. Same inputs -> identical result", () => {
      const res1 = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetRoles: ["manager"] });
      const res2 = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetRoles: ["manager"] });
      expect(res1).toEqual(res2);
    });

    test("Excluded company -> NOT_CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, excludedCompanies: ["tech corp"] });
      expect(res.decision).toBe("NOT_CANDIDATE");
    });

    test("10. Gate is purely synchronous & invokes zero LLM/extraction/policy operations", () => {
      const startTime = performance.now();
      const res = evaluateAttentionGate(baseVersion, {
        ...baseCriteria,
        targetRoles: ["Engineering Manager"],
        targetLocations: ["San Francisco"]
      });
      const durationMs = performance.now() - startTime;
      expect(res.decision).toBe("CANDIDATE");
      expect(durationMs).toBeLessThan(10);
    });
  });

  describe("Persistence & Isolation", () => {
    let sqliteDb: Database.Database;
    let adapter: TestSqliteAdapter;
    let service: AttentionService;

   beforeEach(() => {
      sqliteDb = new Database(":memory:");
      sqliteDb.pragma("foreign_keys = ON");
      
      const migrationFiles = [
        "001_initial_schema.sql",
        "009_profile_queryable_columns.sql",
        "018_multi_tenant_foundation.sql",
        "019_evaluation_context_and_read_model.sql",
        "020_canonical_acquisition.sql"
      ];
      
      for (const file of migrationFiles) {
        const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
        sqliteDb.exec(sql);
      }

      // Provision multi-tenant setup
      sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')");
      sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('person_A', 'a@test.com', 'tenant_A'), ('person_B', 'b@test.com', 'tenant_B')");
      sqliteDb.exec("INSERT INTO search_plans (id, tenant_id, person_id, title, criteria_json) VALUES ('plan_A', 'tenant_A', 'person_A', 'A Plan', '{}'), ('plan_B', 'tenant_B', 'person_B', 'B Plan', '{}')");

      // Global Job and Version
      sqliteDb.exec("INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES ('job1', 'linkedin', '1001', 'http://url')");
      sqliteDb.exec("INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES ('v1', 'job1', 'hash1', 'Senior Engineering Manager', 'content')");

      adapter = new TestSqliteAdapter(sqliteDb);
      service = new AttentionService(adapter);
    });

    test("9. Candidate references the exact opportunity version", async () => {
      const plan: SearchPlan = {
        id: "plan_A", tenantId: "tenant_A", personId: "person_A", title: "", status: "active",
        criteria: { targetRoles: ["engineering manager"], targetSeniority: [], targetLocations: [] },
        createdAt: "", updatedAt: ""
      };

      const candidate = await service.processAttentionGate(baseVersion, plan);
      expect(candidate.attentionDecision).toBe("CANDIDATE");

      const saved = await adapter.one<any>("SELECT * FROM search_plan_candidates WHERE search_plan_id = 'plan_A'");
      expect(saved.opportunity_version).toBe("v1");
      expect(saved.canonical_job_id).toBe("job1");
    });

    test("8. Different tenant cannot access another tenant candidate (Isolation)", async () => {
      const planA: SearchPlan = {
        id: "plan_A", tenantId: "tenant_A", personId: "person_A", title: "", status: "active",
        criteria: { targetRoles: ["engineering manager"], targetSeniority: [], targetLocations: [] },
        createdAt: "", updatedAt: ""
      };
      
      const planB: SearchPlan = {
        id: "plan_B", tenantId: 'tenant_B', personId: 'person_B', title: "", status: "active",
        criteria: { targetRoles: ["marketing"], targetSeniority: [], targetLocations: [] },
        createdAt: "", updatedAt: ""
      };

      await service.processAttentionGate(baseVersion, planA);
      await service.processAttentionGate(baseVersion, planB);

      const savedA = await adapter.one<any>("SELECT attention_decision FROM search_plan_candidates WHERE tenant_id = 'tenant_A'");
      const savedB = await adapter.one<any>("SELECT attention_decision FROM search_plan_candidates WHERE tenant_id = 'tenant_B'");

      expect(savedA.attention_decision).toBe("CANDIDATE");
      expect(savedB.attention_decision).toBe("NOT_CANDIDATE");
    });

    test("11. Gate does not mutate canonical opportunity/version records", async () => {
      const plan: SearchPlan = {
        id: "plan_A", tenantId: "tenant_A", personId: "person_A", title: "", status: "active",
        criteria: { targetRoles: ["manager"], targetSeniority: [], targetLocations: [] },
        createdAt: "", updatedAt: ""
      };

      const beforeVer = await adapter.one<any>("SELECT * FROM opportunity_versions WHERE id = 'v1'");
      await service.processAttentionGate(baseVersion, plan);
      const afterVer = await adapter.one<any>("SELECT * FROM opportunity_versions WHERE id = 'v1'");

      expect(beforeVer).toEqual(afterVer);
    });
  });
});