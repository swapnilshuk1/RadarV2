import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { SqliteMaterializedEvaluationStore } from "../../src/data/sqlite/repositories/SqliteMaterializedEvaluationStore";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";

describe("Validation of Worker & Repository Veto Write Path", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let store: SqliteMaterializedEvaluationStore;

  const tenantId = "tenant_A";
  const personId = "person_A";
  const scope = { tenantId, personId };

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    await setupLineageTestFixture(db);
    store = new SqliteMaterializedEvaluationStore(db);

    await db.execute(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name)
      VALUES ('can_1', 'LinkedIn', 'job_1', 'http://test', 'Company')
    `);
    await db.execute(`
      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, lifecycle_state, job_title, raw_content)
      VALUES ('ov_1', 'can_1', 'chash_1', 'ACTIVE', 'CTO', 'Description')
    `);
  });

  it("1. writes vetoed = 1 when evaluationJson contains vetoed = true", async () => {
    await store.materializeEvaluation(scope, {
      id: "mat_1",
      tenantId,
      personId,
      canonicalJobId: "can_1",
      opportunityVersion: "ov_1",
      evaluationContextFingerprint: "fingerprint_A",
      evaluationState: "EVALUATED",
      decision: "CONSIDER",
      qualityScore: 75,
      rationale: "Rationale",
      evidenceIds: [],
      evaluationJson: JSON.stringify({
        record: {
          vetoed: true,
          verb: "CONSIDER"
        }
      }),
      materializedAt: new Date().toISOString(),
    });

    const row = await db.one<any>("SELECT vetoed, decision FROM materialized_evaluations WHERE id = 'mat_1'");
    expect(row.vetoed).toBe(1);
    expect(row.decision).toBe("CONSIDER");
  });

  it("2. writes vetoed = 0 when evaluationJson contains vetoed = false", async () => {
    await store.materializeEvaluation(scope, {
      id: "mat_2",
      tenantId,
      personId,
      canonicalJobId: "can_1",
      opportunityVersion: "ov_1",
      evaluationContextFingerprint: "fingerprint_A",
      evaluationState: "EVALUATED",
      decision: "PURSUE",
      qualityScore: 90,
      rationale: "Rationale",
      evidenceIds: [],
      evaluationJson: JSON.stringify({
        schemaVersion: "v4.2-intrinsic",
        vetoed: false,
        intrinsicVerdict: "PURSUE"
      }),
      materializedAt: new Date().toISOString(),
    });

    const row = await db.one<any>("SELECT vetoed, decision FROM materialized_evaluations WHERE id = 'mat_2'");
    expect(row.vetoed).toBe(0);
    expect(row.decision).toBe("PURSUE");
  });
});
