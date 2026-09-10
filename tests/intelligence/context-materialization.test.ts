import { describe, expect, it, vi } from "vitest";
import { materializeExistingCanonicalPool } from "@/lib/intelligence/context-materialization";
import { runEngineSingleIntrinsic } from "@/lib/intelligence/engine";
import { resolveExactCandidateProjectionForScope } from "@/data/sqlite/repositories/profile-projection-version";

vi.mock("@/lib/intelligence/engine", () => ({ runEngineSingleIntrinsic: vi.fn() }));
vi.mock("@/data/sqlite/repositories/profile-projection-version", () => ({
  resolveExactCandidateProjectionForScope: vi.fn(),
}));

const scope = { tenantId: "tenant", personId: "person", roles: [] };
const prepared = {
  plan: { id: "prepared-plan", criteria: { targetSeniority: ["VP"], targetRoles: ["VP Growth"], targetLocations: ["Bengaluru"] } },
  context: {
    contextFingerprint: "ctx", profileVersion: "profile", tenantId: "tenant", personId: "person",
    searchPlanSnapshotId: "snapshot", ontologyVersion: "ontology", ontologyFingerprint: "ontology-fp",
    policyVersion: "policy", createdAt: "2026-01-01T00:00:00.000Z",
  },
} as any;

function sourceRow(overrides: Record<string, unknown>) {
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
  return {
    one: vi.fn(async () => ({ id: "source-plan" })),
    many: vi.fn(async () => [row]), execute,
    transaction: vi.fn(async (fn) => fn({ execute })),
  } as any;
}

const projection = { version: "1", id: "candidate", tenantId: "tenant", personId: "person", capabilities: [], semanticEvidence: [] } as any;
const evaluatedArtifact = {
  opportunity: { jobHash: "source-job" },
  record: { jobHash: "source-job", verb: "PURSUE", qualityScore: 75, diligenceStatus: "READY" },
  jobProjection: { capabilities: [], roleWorkEvidence: [{ id: "work-1", statement: "Own commercial growth", kind: "RESPONSIBILITY" }] },
  decisionTrace: { version: "canonical-decision-trace/v1", relationships: [{ evaluatorTraceId: "trace-1", jobEvidenceIds: ["work-1"], candidateEvidenceIds: [], relationship: "MATCH" }], components: [] },
} as any;

describe("materializeExistingCanonicalPool source trust boundary", () => {
  it.each([
    ["untrusted acquisition", sourceRow({ acquisition_status: "CAPTURE_PENDING" }), "ACQUISITION_PENDING"],
    ["expired lifecycle", sourceRow({ lifecycle_state: "EXPIRED" }), "EXPIRED"],
  ])("does not invoke the engine or create V2 for %s", async (_name, row, expectedState) => {
    vi.mocked(runEngineSingleIntrinsic).mockReset();
    vi.mocked(resolveExactCandidateProjectionForScope).mockResolvedValue(null as any);
    const db = adapter(row);

    await materializeExistingCanonicalPool(scope, prepared, { sourceSearchPlanId: "source-plan" }, db);

    expect(runEngineSingleIntrinsic).not.toHaveBeenCalled();
    const evaluationInsert = db.execute.mock.calls.find(([sql]: [string]) => sql.includes("materialized_evaluations"));
    expect(evaluationInsert).toBeDefined();
    expect(JSON.stringify(evaluationInsert)).toContain(expectedState);
    expect(db.execute.mock.calls.some(([sql]: [string]) => sql.includes("materialized_dossier_presentations"))).toBe(false);
  });

  it("does not force incomplete genuinely-sparse evidence into SPARSE_SPEC", async () => {
    vi.mocked(resolveExactCandidateProjectionForScope).mockResolvedValue(projection);
    vi.mocked(runEngineSingleIntrinsic).mockReturnValue(evaluatedArtifact);
    const db = adapter(sourceRow({ evidence_state: "GENUINELY_SPARSE", acquisition_quality: "PARTIAL" }));

    await materializeExistingCanonicalPool(scope, prepared, { sourceSearchPlanId: "source-plan" }, db);

    expect(runEngineSingleIntrinsic).toHaveBeenCalledWith("source-job", projection, 0, expect.any(Array));
    expect(JSON.stringify(db.execute.mock.calls)).toContain("EVALUATED");
    expect(JSON.stringify(db.execute.mock.calls)).not.toContain("SPARSE_SPEC");
  });

  it("preserves separate canonical, source, and version identity through evaluated V2 materialization", async () => {
    vi.mocked(resolveExactCandidateProjectionForScope).mockResolvedValue(projection);
    vi.mocked(runEngineSingleIntrinsic).mockReturnValue(evaluatedArtifact);
    const db = adapter(sourceRow({ canonical_job_id: "canonical-job", opportunity_version: "version-1" }));

    await materializeExistingCanonicalPool(scope, prepared, { sourceSearchPlanId: "source-plan" }, db);

    expect(runEngineSingleIntrinsic).toHaveBeenCalledWith("source-job", projection, 0, expect.any(Array));
    const writes = JSON.stringify(db.execute.mock.calls);
    expect(writes).toContain("canonical-job");
    expect(writes).toContain("version-1");
    expect(writes).toContain("materialized_dossier_presentations");
    expect(evaluatedArtifact.decisionTrace.relationships[0].jobEvidenceIds.every((id: string) =>
      evaluatedArtifact.jobProjection.roleWorkEvidence.some((e: { id: string }) => e.id === id),
    )).toBe(true);
  });
});
