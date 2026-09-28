import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture, activateLineageTestContext } from "../persistence/lineage_fixture";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import type { AuthorizedPersonScope } from "../../src/lib/security/auth";

describe("current serving boundary", () => {
  let db: SqliteAdapter;
  let queries: SqliteOpportunityQueries;
  let scope: AuthorizedPersonScope;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES ('person_A', 'a@a.com')`);
    await db.execute(
      `INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, permissions, status)
       VALUES ('person_A', 'tenant_A', 'admin', '["*"]', 'active')`,
    );
    await activateLineageTestContext(db);
    queries = new SqliteOpportunityQueries(db);
    scope = (await resolveServingScope("person_A", "tenant_A", db)).scope;
  });

  it("resolves canonical_job_id before an overlapping source_job_id", async () => {
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source_job_id, company_name, source, canonical_url)
       VALUES ('opp_exact_id', 'src_different', 'Corp A', 'LinkedIn', 'https://example.com/a')`,
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, content_hash, raw_content, lifecycle_state)
       VALUES ('ver_exact_id', 'opp_exact_id', 'Role A', 'Remote', 'hash_a', 'Content A', 'ACTIVE')`,
    );
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', 'opp_exact_id', 'ver_exact_id', 'CANDIDATE')`,
    );
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source_job_id, company_name, source, canonical_url)
       VALUES ('opp_other_id', 'opp_exact_id', 'Corp B', 'LinkedIn', 'https://example.com/b')`,
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, content_hash, raw_content, lifecycle_state)
       VALUES ('ver_other_id', 'opp_other_id', 'Role B', 'Remote', 'hash_b', 'Content B', 'ACTIVE')`,
    );
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', 'opp_other_id', 'ver_other_id', 'CANDIDATE')`,
    );

    const served = await queries.getDossier(scope, "opp_exact_id");
    expect(served).not.toBeNull();
    expect(served?.role).toBe("Role A");
  });

  it("routes OAuth callback errors through the authentication handler rather than route 404", async () => {
    const server = (await import("../../src/server")).default;
    const req = new Request("http://localhost:3000/api/auth/callback?error=access_denied", {
      headers: { host: "localhost:3000" },
    });
    const res = await server.fetch(req, {}, {});
    expect(res.status).not.toBe(404);
    const body = await res.json();
    expect(body).not.toEqual({ error: "Not Found", path: "/api/auth/callback" });
    expect(body).toMatchObject({ error: "OAuth authentication failed" });
  });
});
