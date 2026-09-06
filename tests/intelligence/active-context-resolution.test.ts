import { describe, it, expect, beforeAll } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import Database from "better-sqlite3";
import { SqliteEvaluationContextStore } from "../../src/data/sqlite/repositories/SqliteEvaluationContextStore";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";

describe("Active Context Resolution", () => {
  let db: SqliteAdapter;
  let contexts: SqliteEvaluationContextStore;
  let queries: SqliteOpportunityQueries;
  const scopeA = { tenantId: "tenant_A", personId: "person_A", roles: [] } as any;
  const scopeB = { tenantId: "tenant_B", personId: "person_B", roles: [] } as any;

  beforeAll(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    for (const [userId, tenantId] of [["person_A", "tenant_A"], ["person_B", "tenant_B"]] as const) {
      await db.execute(`INSERT INTO users (id, email) VALUES (?, ?)`, [userId, `${userId}@example.com`]);
      await db.execute(`INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES (?, ?, 'user', '[]', 'active')`, [userId, tenantId]);
    }
    contexts = new SqliteEvaluationContextStore(db);
    queries = new SqliteOpportunityQueries(db);
    expect(await contexts.bindEvaluationContextScope("fingerprint_A", "tenant_A", "person_A", "plan_A")).toBe(true);
    expect(await contexts.activateContextPointer("fingerprint_A", "tenant_A", "person_A", "plan_A")).toBe(true);
  });

  it("uses an explicit active pointer instead of a newer inactive or unbound context", async () => {
    await db.execute(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES (?, ?, ?, 'archived', ?, '{}')`, ["plan_inactive", "tenant_A", "person_A", "Inactive Plan"]);
    await db.execute(`INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, '{}')`, ["sps_inactive", "tenant_A", "person_A", "plan_inactive", "hashInactive"]);
    await db.execute(`INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, 'v1', 'hash_ontology', 'v1', 'v1', '2030-01-01 12:00:00')`, ["fingerprint_inactive_new", "tenant_A", "person_A", "sps_inactive"]);
    await expect(contexts.getActiveContext(scopeA)).resolves.toEqual({ searchPlanId: "plan_A", contextFingerprint: "fingerprint_A" });
  });

  it("keeps pointers tenant/person scoped and can deliberately activate a new bound context", async () => {
    await db.execute(`INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, '{}')`, ["sps_B", "tenant_B", "person_B", "plan_B", "hashB"]);
    await db.execute(`INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, 'v1', 'hash_ontology', 'v1', 'v1')`, ["fingerprint_B", "tenant_B", "person_B", "sps_B"]);
    expect(await contexts.bindEvaluationContextScope("fingerprint_B", "tenant_B", "person_B", "plan_B")).toBe(true);
    expect(await contexts.activateContextPointer("fingerprint_B", "tenant_B", "person_B", "plan_B")).toBe(true);
    await expect(contexts.getActiveContext(scopeB)).resolves.toEqual({ searchPlanId: "plan_B", contextFingerprint: "fingerprint_B" });

    await db.execute(`INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, '{}')`, ["sps_A2", "tenant_A", "person_A", "plan_A", "hashA2"]);
    await db.execute(`INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, 'v1', 'hash_ontology', 'v1', 'v1')`, ["fingerprint_A_new", "tenant_A", "person_A", "sps_A2"]);
    expect(await contexts.bindEvaluationContextScope("fingerprint_A_new", "tenant_A", "person_A", "plan_A")).toBe(true);
    expect(await contexts.activateContextPointer("fingerprint_A_new", "tenant_A", "person_A", "plan_A")).toBe(true);
    await expect(contexts.getActiveContext(scopeA)).resolves.toEqual({ searchPlanId: "plan_A", contextFingerprint: "fingerprint_A_new" });
  });

  it("serves a materialized candidate only through the selected explicit context", async () => {
    await db.execute(`INSERT INTO companies (id, name) VALUES (?, ?)`, ["comp_1", "Company"]);
    await db.execute(`INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES (?, 'Indeed', ?, ?, ?)`, ["job_1", "source_job_1", "https://in.indeed.com/viewjob?jk=job_1", "Company"]);
    await db.execute(`INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content, acquisition_status, lifecycle_state) VALUES (?, ?, ?, ?, ?, 'ACQUIRED', 'ACTIVE')`, ["v1", "job_1", "hash", "Title", "{}"]);
    await db.execute(`INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, 'CANDIDATE')`, ["tenant_A", "person_A", "plan_A", "job_1", "v1"]);
    const payload = JSON.stringify({
      schemaVersion: "v4.3-intrinsic", evaluationContractVersion: "v4.3", evaluationState: "EVALUATED",
      canonicalJobId: "job_1", opportunityVersion: "v1", jobHash: "source_job_1", evaluationInputHash: "eval_hash_1",
      contextFingerprint: "fingerprint_A_new", tenantId: "tenant_A", personId: "person_A", policyVersion: "v1",
      ontologyVersion: "v1", ontologyFingerprint: "hash_ontology", profileVersion: "v1", evaluatedAt: "2026-01-01T00:00:00.000Z",
      decision: "PURSUE", score: 100, diligenceStatus: "UNKNOWN", jobProjection: { title: "Title" },
    });
    await db.execute(`INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_fingerprint, decision, quality_score, evaluation_state, evaluation_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EVALUATED', ?)`, ["mat_1", "tenant_A", "person_A", "job_1", "v1", "fingerprint_A_new", "eval_hash_1", "PURSUE", 100, payload]);

    const feed = await queries.getFeed(scopeA, undefined, undefined, 10);
    expect(feed.items).toHaveLength(1);
    const dossier = await queries.getDossier(scopeA, "source_job_1");
    expect(dossier?.evaluationState).toBe("EVALUATED");
    expect(await queries.getDossier(scopeB, "source_job_1")).toBeNull();
  });
});
