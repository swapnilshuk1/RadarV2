import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import { computeCanonicalJobId } from "@/lib/domain/canonical_identity";
import { SqliteDecisionSupportStore } from "@/data/sqlite/repositories/SqliteDecisionSupportStore";

class TestSqliteAdapter implements DatabaseAdapter {
  constructor(public db: Database.Database) {}
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
    this.db.exec("BEGIN");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

describe("Decisions Multi-Tenant & Account Isolation Contracts", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;
  let decisionStore: SqliteDecisionSupportStore;

  const TENANT_A = "tenant_alpha";
  const TENANT_B = "tenant_beta";
  const PERSON_A1 = "person_alpha_1";
  const PERSON_A2 = "person_alpha_2";
  const PERSON_B1 = "person_beta_1";

  const JOB_1 = "job_alpha_001";
  const JOB_2 = "job_shared_002";

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");

    const migrationFiles = [
      "001_initial_schema.sql",
      "006_recreate_decisions.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
      "025_canonical_decisions.sql",
      "028_active_evaluation_context_pointers.sql",
      "037_materialized_evaluation_fingerprint.sql",
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    adapter = new TestSqliteAdapter(sqliteDb);
    decisionStore = new SqliteDecisionSupportStore(adapter);

    // Seed tenants
    await adapter.execute("INSERT INTO tenants (id, status) VALUES (?, ?), (?, ?)", [TENANT_A, "active", TENANT_B, "active"]);

    // Seed people
    await adapter.execute(
      "INSERT INTO people (id, tenant_id, email) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)",
      [
        PERSON_A1, TENANT_A, "a1@alpha.com",
        PERSON_A2, TENANT_A, "a2@alpha.com",
        PERSON_B1, TENANT_B, "b1@beta.com",
      ],
    );

    // Seed canonical opportunities
    const canonJob1 = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: JOB_1 });
    const canonJob2 = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: JOB_2 });

    await adapter.execute(
      "INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [
        canonJob1, "LinkedIn", JOB_1, "http://linkedin.com/1",
        canonJob2, "LinkedIn", JOB_2, "http://linkedin.com/2",
      ],
    );

    await adapter.execute(
      "INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
      [
        "ver_1", canonJob1, "hash_1", "Role 1", "{}",
        "ver_2", canonJob2, "hash_2", "Role 2", "{}",
      ],
    );

    // Seed search plans & active contexts
    for (const [tenantId, personId, planId, snapshotId, fingerprint] of [
      [TENANT_A, PERSON_A1, "plan_a1", "snap_a1", "fp_a1"],
      [TENANT_A, PERSON_A2, "plan_a2", "snap_a2", "fp_a2"],
      [TENANT_B, PERSON_B1, "plan_b1", "snap_b1", "fp_b1"],
    ] as const) {
      await adapter.execute(
        "INSERT INTO search_plans (id, tenant_id, person_id, title, criteria_json) VALUES (?, ?, ?, ?, ?)",
        [planId, tenantId, personId, "Test Plan", "{}"],
      );
      await adapter.execute(
        "INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
        [snapshotId, tenantId, personId, planId, `${snapshotId}-hash`, "{}"],
      );
      await adapter.execute(
        "INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [fingerprint, tenantId, personId, snapshotId, "v4.3", "ontology", "policy", "profile"],
      );
      await adapter.execute(
        "INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES (?, ?, ?, ?)",
        [fingerprint, tenantId, personId, planId],
      );
      await adapter.execute(
        "INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES (?, ?, ?, ?, ?)",
        [tenantId, personId, planId, fingerprint, "test"],
      );
    }

    // PERSON_A1 has JOB_1 and JOB_2
    await adapter.execute(
      "INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)",
      [
        TENANT_A, PERSON_A1, "plan_a1", canonJob1, "ver_1", "CANDIDATE",
        TENANT_A, PERSON_A1, "plan_a1", canonJob2, "ver_2", "CANDIDATE",
      ],
    );

    // PERSON_A2 has only JOB_1
    await adapter.execute(
      "INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, ?)",
      [TENANT_A, PERSON_A2, "plan_a2", canonJob1, "ver_1", "CANDIDATE"],
    );

    // PERSON_B1 in TENANT_B has only JOB_2
    await adapter.execute(
      "INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, ?)",
      [TENANT_B, PERSON_B1, "plan_b1", canonJob2, "ver_2", "CANDIDATE"],
    );
  });

  test("Tenant and person boundaries strictly isolate recorded decisions", async () => {
    // Person A1 records PURSUE on JOB_1
    await decisionStore.recordAuthorizedUserDecision(PERSON_A1, TENANT_A, JOB_1, "PURSUE", "Great role");

    // Person A1 sees their decision
    const decisionsA1 = await decisionStore.getUserDecisions(PERSON_A1, TENANT_A);
    expect(decisionsA1[JOB_1]?.verb).toBe("PURSUE");

    // Person B1 in Tenant B MUST NOT see Person A1's decision
    const decisionsB1 = await decisionStore.getUserDecisions(PERSON_B1, TENANT_B);
    expect(decisionsB1[JOB_1]).toBeUndefined();

    // Person A2 in same Tenant A MUST NOT see Person A1's decision
    const decisionsA2 = await decisionStore.getUserDecisions(PERSON_A2, TENANT_A);
    expect(decisionsA2[JOB_1]).toBeUndefined();
  });

  test("Out-of-scope candidate access is strictly rejected across tenants", async () => {
    // Person B1 attempts to decide on JOB_1, which is only present in Tenant A's search plan
    await expect(
      decisionStore.recordAuthorizedUserDecision(PERSON_B1, TENANT_B, JOB_1, "PURSUE")
    ).rejects.toThrow(/OUT_OF_SCOPE_OPPORTUNITY/);
  });

  test("Same opportunity shared across tenants maintains independent decision state", async () => {
    // Both Person A1 and Person B1 have JOB_2 in their candidate populations
    await decisionStore.recordAuthorizedUserDecision(PERSON_A1, TENANT_A, JOB_2, "PURSUE", "A1 wants this");
    await decisionStore.recordAuthorizedUserDecision(PERSON_B1, TENANT_B, JOB_2, "PASS", "B1 passes");

    const decisionsA = await decisionStore.getUserDecisions(PERSON_A1, TENANT_A);
    const decisionsB = await decisionStore.getUserDecisions(PERSON_B1, TENANT_B);

    expect(decisionsA[JOB_2]?.verb).toBe("PURSUE");
    expect(decisionsB[JOB_2]?.verb).toBe("PASS");

    // Modifying Person A1's decision does not affect Person B1
    await decisionStore.recordAuthorizedUserDecision(PERSON_A1, TENANT_A, JOB_2, "CONSIDER", "A1 changed mind");

    const updatedA = await decisionStore.getUserDecisions(PERSON_A1, TENANT_A);
    const updatedB = await decisionStore.getUserDecisions(PERSON_B1, TENANT_B);

    expect(updatedA[JOB_2]?.verb).toBe("CONSIDER");
    expect(updatedB[JOB_2]?.verb).toBe("PASS");
  });

  test("Deleting a decision for one user/tenant does not affect other users/tenants", async () => {
    await decisionStore.recordAuthorizedUserDecision(PERSON_A1, TENANT_A, JOB_2, "PURSUE");
    await decisionStore.recordAuthorizedUserDecision(PERSON_B1, TENANT_B, JOB_2, "PASS");

    // Person A1 deletes decision on JOB_2
    await decisionStore.deleteUserDecision(PERSON_A1, JOB_2, TENANT_A);

    const decisionsA = await decisionStore.getUserDecisions(PERSON_A1, TENANT_A);
    const decisionsB = await decisionStore.getUserDecisions(PERSON_B1, TENANT_B);

    expect(decisionsA[JOB_2]).toBeUndefined();
    expect(decisionsB[JOB_2]?.verb).toBe("PASS");
  });

  test("Clearing decisions for one user/tenant leaves other tenants completely untouched", async () => {
    await decisionStore.recordAuthorizedUserDecision(PERSON_A1, TENANT_A, JOB_1, "PURSUE");
    await decisionStore.recordAuthorizedUserDecision(PERSON_A1, TENANT_A, JOB_2, "CONSIDER");
    await decisionStore.recordAuthorizedUserDecision(PERSON_B1, TENANT_B, JOB_2, "PASS");

    // Clear Person A1 decisions
    await decisionStore.clearUserDecisions(PERSON_A1, TENANT_A);

    const decisionsA = await decisionStore.getUserDecisions(PERSON_A1, TENANT_A);
    const decisionsB = await decisionStore.getUserDecisions(PERSON_B1, TENANT_B);

    expect(Object.keys(decisionsA).length).toBe(0);
    expect(decisionsB[JOB_2]?.verb).toBe("PASS");
  });

  test("Missing tenantId parameter throws invariant error across all decision methods", async () => {
    await expect(
      decisionStore.recordUserDecision(PERSON_A1, JOB_1, "PURSUE")
    ).rejects.toThrow(/tenantId is strictly required/);

    await expect(
      decisionStore.getUserDecisions(PERSON_A1)
    ).rejects.toThrow(/tenantId is strictly required/);

    await expect(
      decisionStore.deleteUserDecision(PERSON_A1, JOB_1)
    ).rejects.toThrow(/tenantId is strictly required/);

    await expect(
      decisionStore.clearUserDecisions(PERSON_A1)
    ).rejects.toThrow(/tenantId is strictly required/);
  });
});
