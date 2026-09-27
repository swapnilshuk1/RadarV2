import { describe, expect, it, vi } from "vitest";
import { materializeExistingCanonicalPool } from "@/lib/intelligence/context-materialization";

const scope = { tenantId: "tenant", personId: "person", roles: [] };
const prepared = {
  plan: { id: "prepared-plan", criteria: { targetSeniority: ["VP"], targetRoles: ["VP Growth"], targetLocations: ["Bengaluru"] } },
  context: {
    contextFingerprint: "ctx", profileVersion: "profile", tenantId: "tenant", personId: "person",
    searchPlanSnapshotId: "snapshot", ontologyVersion: "ontology", ontologyFingerprint: "ontology-fp",
    policyVersion: "staged-v8", createdAt: "2026-01-01T00:00:00.000Z",
  },
} as any;

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    canonical_job_id: "canonical-job", opportunity_version: "version-1", id: "version-1",
    job_title: "VP Growth", company_name: "Acme", location: "Bengaluru", employment_type: "FULL_TIME",
    raw_content: JSON.stringify({ jobHash: "source-job", role: "VP Growth", company: "Acme", rawDescription: "Own commercial growth and revenue planning." }),
    acquisition_status: "ACQUIRED", acquisition_quality: "COMPLETE", failure_class: null,
    lifecycle_state: "ACTIVE", evidence_state: "SUFFICIENT", ...overrides,
  };
}

function adapter(row: Record<string, unknown>) {
  const execute = vi.fn(async () => ({ rowsAffected: 1 }));
  const tx = {
    execute,
    one: vi.fn(async (sql: string) =>
      sql.includes("FROM evaluation_requirements") ? { status: "READY" } : null,
    ),
    many: vi.fn(),
  };
  return {
    one: vi.fn(async (sql: string) => {
      if (sql.includes("FROM search_plans")) return { id: "source-plan" };
      if (sql.includes("FROM evaluation_jobs")) return null;
      if (sql.includes("FROM evaluation_contexts")) return { policy_version: "staged-v8" };
      if (sql.includes("FROM enrichment_jobs")) return { status: "COMPLETE" };
      return null;
    }),
    many: vi.fn(async () => [row]),
    execute,
    transaction: vi.fn(async (fn) => fn(tx)),
  } as any;
}

describe("materializeExistingCanonicalPool staged-v8 boundary", () => {
  it("rejects non-current evaluation policies instead of falling back", async () => {
    const old = structuredClone(prepared);
    old.context.policyVersion = "obsolete-policy";
    await expect(materializeExistingCanonicalPool(scope, old, { sourceSearchPlanId: "source-plan" }, adapter(sourceRow())))
      .rejects.toThrow("UNSUPPORTED_EVALUATION_POLICY:obsolete-policy");
  });

  it("persists the candidate association before scheduling staged-v8 work", async () => {
    const db = adapter(sourceRow());
    const result = await materializeExistingCanonicalPool(scope, prepared, { sourceSearchPlanId: "source-plan" }, db);
    expect(result).toMatchObject({ examined: 1, candidates: 1, materialized: 1, queued: 1 });
    const writes = JSON.stringify(db.execute.mock.calls);
    expect(writes).toContain("search_plan_candidates");
  });

  it("does not materialize deterministic evaluation artifacts for a non-candidate", async () => {
    const db = adapter(sourceRow({ acquisition_status: "CAPTURE_FAILED", acquisition_quality: "INVALID" }));
    const result = await materializeExistingCanonicalPool(scope, prepared, { sourceSearchPlanId: "source-plan" }, db);
    expect(result.queued).toBe(0);
    expect(JSON.stringify(db.execute.mock.calls)).not.toContain("materialized_evaluations");
  });
});
