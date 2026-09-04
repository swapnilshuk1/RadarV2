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

    test("2. Unknown lexical role -> REVIEW / CANDIDATE", () => {
      const res = evaluateAttentionGate({ ...baseVersion, jobTitle: "Vice President, Client Services" }, { ...baseCriteria, targetRoles: ["director of marketing"] });
      expect(res.decision).toBe("CANDIDATE");
      expect(res.eligibility).toBe("REVIEW");
      expect(res.reasonCodes).toContain("ROLE_UNKNOWN");
    });

    test("3. Matching location -> CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetLocations: ["san francisco"] });
      expect(res.decision).toBe("CANDIDATE");
    });

    test("4. A location preference alone is not a hard rejection", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetLocations: ["new york"] });
      expect(res.decision).toBe("CANDIDATE");
      expect(res.eligibility).toBe("REVIEW");
    });

    test("explicit Gurugram-only policy excludes a known outside location", () => {
      const res = evaluateAttentionGate(baseVersion, {
        ...baseCriteria,
        eligibilitySpec: {
          version: "eligibility-spec/v1", ontologyVersion: "test", roleFamilies: [], functions: [], seniorityRange: [],
          locations: ["Gurugram"], locationPolicy: "GURUGRAM_ONLY", industries: [], adjacentFamilies: [], excludedCompanies: [],
        },
      });
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.eligibility).toBe("INELIGIBLE");
      expect(res.reasonCodes).toContain("LOCATION_CONTRADICTION");
      expect(res.locationEvidence).toBe("San Francisco, CA");
    });

    test("explicit NCR policy accepts a Gurugram posting and records its evidence", () => {
      const res = evaluateAttentionGate({ ...baseVersion, location: "Gurugram, Haryana, India" }, {
        ...baseCriteria,
        eligibilitySpec: {
          version: "eligibility-spec/v1", ontologyVersion: "test", roleFamilies: [], functions: [], seniorityRange: [],
          locations: ["Gurugram"], locationPolicy: "NCR", industries: [], adjacentFamilies: [], excludedCompanies: [],
        },
      });
      expect(res.decision).toBe("CANDIDATE");
      expect(res.locationPolicy).toBe("NCR");
      expect(res.locationEvidence).toBe("Gurugram, Haryana, India");
    });

    test("explicit NCR policy rejects an out-of-area hybrid posting", () => {
      const res = evaluateAttentionGate({ ...baseVersion, location: "Mumbai, Maharashtra, India (Hybrid)" }, {
        ...baseCriteria,
        eligibilitySpec: {
          version: "eligibility-spec/v1", ontologyVersion: "test", roleFamilies: [], functions: [], seniorityRange: [],
          locations: ["Gurugram"], locationPolicy: "NCR", industries: [], adjacentFamilies: [], excludedCompanies: [],
        },
      });
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.eligibility).toBe("INELIGIBLE");
      expect(res.reasonCodes).toEqual(["LOCATION_CONTRADICTION"]);
    });

    test("remote-compatible policy accepts explicit remote evidence without a location rejection", () => {
      const res = evaluateAttentionGate({ ...baseVersion, location: "Remote in India" }, {
        ...baseCriteria,
        eligibilitySpec: {
          version: "eligibility-spec/v1", ontologyVersion: "test", roleFamilies: [], functions: [], seniorityRange: [],
          locations: ["Gurugram"], locationPolicy: "REMOTE_COMPATIBLE", industries: [], adjacentFamilies: [], excludedCompanies: [],
        },
      });
      expect(res.decision).toBe("CANDIDATE");
      expect(res.eligibility).toBe("REVIEW");
      expect(res.reasonCodes).not.toContain("LOCATION_CONTRADICTION");
      expect(res.locationEvidence).toBe("Remote in India");
    });

    test("known policy with unavailable location evidence remains explicit review", () => {
      const res = evaluateAttentionGate({ ...baseVersion, location: null }, {
        ...baseCriteria,
        eligibilitySpec: {
          version: "eligibility-spec/v1", ontologyVersion: "test", roleFamilies: [], functions: [], seniorityRange: [],
          locations: ["Gurugram"], locationPolicy: "GURUGRAM_ONLY", industries: [], adjacentFamilies: [], excludedCompanies: [],
        },
      });
      expect(res.decision).toBe("CANDIDATE");
      expect(res.eligibility).toBe("REVIEW");
      expect(res.reasonCodes).toEqual(["LOCATION_REVIEW"]);
      expect(res.locationEvidence).toBeNull();
    });

    test("5. Seniority mismatch -> NOT_CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetSeniority: ["vp", "vice president"] });
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.reasonCodes).toContain("SENIORITY_CONTRADICTION");
    });

    test("5b. Explicit role match does not require a duplicate seniority token", () => {
      const res = evaluateAttentionGate(
        { ...baseVersion, jobTitle: "Chief Marketing Officer (CMO)" },
        { ...baseCriteria, targetRoles: ["CMO"], targetSeniority: ["Chief"] },
      );
      expect(res.decision).toBe("CANDIDATE");
    });

    test("5c. Generic function match still honors seniority", () => {
      const res = evaluateAttentionGate(
        { ...baseVersion, jobTitle: "Marketing Manager" },
        { ...baseCriteria, targetRoles: ["Marketing"], targetSeniority: ["VP"] },
      );
      expect(res.decision).toBe("NOT_CANDIDATE");
    });

    test("5d. Explicit junior experience requirement rejects a lexical family match before evaluation", () => {
      const res = evaluateAttentionGate(
        { ...baseVersion, jobTitle: "B2B Growth & Onboarding Executive", rawContent: "Sales executive role requiring 1–3 years of experience in logistics sales." },
        { ...baseCriteria, targetRoles: ["Growth"], targetSeniority: ["VP"] },
      );
      expect(res).toMatchObject({ decision: "NOT_CANDIDATE", eligibility: "INELIGIBLE" });
      expect(res.reasonCodes).toContain("SENIORITY_CONTRADICTION");
    });

    test("6. Employment-type mismatch -> NOT_CANDIDATE", () => {
      const res = evaluateAttentionGate(baseVersion, { ...baseCriteria, targetEmploymentTypes: ["Contract", "Part-time"] });
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.reasonCodes).toContain("EMPLOYMENT_CONTRADICTION");
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

    test("compound strategy/transformation leadership is reviewed, not rejected by title mismatch", () => {
      const res = evaluateAttentionGate(
        { ...baseVersion, jobTitle: "Chief Strategy and Transformation Officer" },
        { ...baseCriteria, eligibilitySpec: { version: "eligibility-spec/v1", ontologyVersion: "test", roleFamilies: ["Chief Marketing Officer"], functions: ["Marketing"], seniorityRange: ["Chief"], locations: [], industries: [], adjacentFamilies: ["Strategy", "Transformation"], excludedCompanies: [] } },
      );
      expect(res.decision).toBe("CANDIDATE");
      expect(res.eligibility).toBe("REVIEW");
      expect(res.reasonCodes).toContain("ADJACENT_ROLE_FAMILY");
    });

    test("explicit technology contradiction is ineligible with a reason code", () => {
      const res = evaluateAttentionGate(
        { ...baseVersion, jobTitle: "Vice President Technology" },
        { ...baseCriteria, eligibilitySpec: { version: "eligibility-spec/v1", ontologyVersion: "test", roleFamilies: ["Chief Marketing Officer"], functions: ["Marketing", "Growth"], seniorityRange: ["VP"], locations: [], industries: [], adjacentFamilies: [], excludedCompanies: [] } },
      );
      expect(res.decision).toBe("NOT_CANDIDATE");
      expect(res.eligibility).toBe("INELIGIBLE");
      expect(res.reasonCodes).toContain("FUNCTION_CONTRADICTION");
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
        "020_canonical_acquisition.sql",
        "035_search_plan_candidate_eligibility_audit.sql"
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
      expect(saved.eligibility).toBe("ELIGIBLE");
      expect(JSON.parse(saved.eligibility_reason_codes_json)).toContain("ROLE_FAMILY_MATCH");
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
