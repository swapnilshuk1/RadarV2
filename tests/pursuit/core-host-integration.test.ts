import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database";
import { writeAuthorizedDecision } from "../../src/data/sqlite/repositories/SqliteDecisionSupportStore";
import { openPursuitInTransaction, insertThesis, publishPreparation, requireApprovedArtifact, recordApprovedOutreachSent, listArchetypes, saveArchetype, type PreparationJob } from "../../src/pursuit/store";
import { projectLedger } from "../../src/pursuit/ledger";
import { ledgerApprovalBlockers } from "../../src/pursuit/approval";
import { createSqliteModelInvocationSink } from "../../src/lib/model/model-invocation";
import type { PursuitThesis, CandidateClaim } from "../../src/pursuit/types";

describe("Pursuit in the RADAR host", () => {
  const prior = process.env.RADAR_ENV;
  let db: ReturnType<typeof getDatabaseAdapter>;
  const scope = { tenantId: "tenant_A", personId: "person_A" };
  const lineage = { canonicalJobId: "job_A", opportunityVersion: "version_A", evaluationContextFingerprint: "fingerprint_A", evaluationFingerprint: null, profileVersion: "v1" };

  beforeAll(async () => {
    process.env.RADAR_ENV = "test";
    resetDatabaseAdapter();
    db = getDatabaseAdapter();
    await db.execute("INSERT INTO tenants(id,status) VALUES ('tenant_A','active'),('tenant_B','active')");
    await db.execute("INSERT INTO people(id,email,tenant_id) VALUES ('person_A','a@a.com','tenant_A'),('person_B','b@b.com','tenant_B')");
    await db.execute("INSERT INTO search_plans(id,tenant_id,person_id,status,title,criteria_json) VALUES ('plan_A','tenant_A','person_A','active','Plan A','{}')");
    await db.execute("INSERT INTO search_plan_snapshots(id,tenant_id,person_id,search_plan_id,snapshot_hash,payload_json) VALUES ('sps_A','tenant_A','person_A','plan_A','hashA','{}')");
    await db.execute("INSERT INTO evaluation_contexts(context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES ('fingerprint_A','tenant_A','person_A','sps_A','v1','hash','v1','v1')");
    await db.execute("INSERT INTO evaluation_context_scopes(context_fingerprint,tenant_id,person_id,search_plan_id) VALUES ('fingerprint_A','tenant_A','person_A','plan_A')");
    await db.execute("INSERT INTO active_evaluation_contexts(tenant_id,person_id,search_plan_id,context_fingerprint,activated_by) VALUES ('tenant_A','person_A','plan_A','fingerprint_A','test')");
    await db.execute("INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url) VALUES ('job_A','test','hash_A','https://example.test/job')");
    await db.execute("INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,raw_content) VALUES ('version_A','job_A','hash','Director','role')");
    await db.execute("INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision) VALUES ('tenant_A','person_A','plan_A','job_A','version_A','CANDIDATE')");
  });
  afterAll(() => {
    resetDatabaseAdapter();
    if (prior === undefined) delete process.env.RADAR_ENV;
    else process.env.RADAR_ENV = prior;
  });

  it("uses the canonical decision store and rolls back both writes together", async () => {
    await expect(db.transaction(async (tx) => {
      await writeAuthorizedDecision(tx, scope.personId, scope.tenantId, "hash_A", "PURSUE");
      await openPursuitInTransaction(tx, scope, { jobHash: "hash_A", roleTitle: "Director" }, "user", lineage);
      throw new Error("simulate launch failure");
    })).rejects.toThrow("simulate launch failure");
    expect(await db.one("SELECT id FROM canonical_decisions WHERE canonical_job_id='job_A'")).toBeNull();
    expect(await db.one("SELECT id FROM opportunity_pursuits WHERE job_hash='hash_A'")).toBeNull();
    expect(await db.one("SELECT id FROM pursuit_preparation_jobs WHERE job_hash='hash_A'")).toBeNull();
    expect(await db.one("SELECT id FROM pursuit_activities WHERE activity_type='PURSUIT_OPENED'")).toBeNull();

    for (let i = 0; i < 2; i++) await db.transaction(async (tx) => {
      await writeAuthorizedDecision(tx, scope.personId, scope.tenantId, "hash_A", "PURSUE");
      await openPursuitInTransaction(tx, scope, { jobHash: "hash_A" }, "user", lineage);
    });
    expect((await db.one<{ n: number }>("SELECT count(*) AS n FROM canonical_decisions WHERE canonical_job_id='job_A'"))?.n).toBe(1);
    expect((await db.one<{ n: number }>("SELECT count(*) AS n FROM opportunity_pursuits WHERE job_hash='hash_A'"))?.n).toBe(1);
    expect((await db.one<{ n: number }>("SELECT count(*) AS n FROM pursuit_preparation_jobs WHERE job_hash='hash_A' AND status='queued'"))?.n).toBe(1);
    expect((await db.one<{ n: number }>("SELECT count(*) AS n FROM pursuit_activities WHERE activity_type='PURSUIT_OPENED'"))?.n).toBe(1);
    await expect(writeAuthorizedDecision(db, "person_B", "tenant_B", "hash_A", "PURSUE")).rejects.toThrow("OUT_OF_SCOPE_OPPORTUNITY");
  });

  it("commits thesis and checkpoint together and fences stale publication", async () => {
    const pursuit = await db.one<{ id: string }>("SELECT id FROM opportunity_pursuits WHERE job_hash='hash_A'");
    await db.execute("UPDATE pursuit_preparation_jobs SET status='completed' WHERE pursuit_id=? AND status='queued'", [pursuit!.id]);
    const job: PreparationJob = { id: "prep_A", tenantId: scope.tenantId, personId: scope.personId, pursuitId: pursuit!.id, jobHash: "hash_A", requestedBy: "user", preferredArchetypeId: null, attempts: 1, maxAttempts: 3, leaseToken: "token_A" };
    await db.execute(
      `INSERT INTO pursuit_preparation_jobs(id,tenant_id,person_id,pursuit_id,job_hash,requested_by,status,lease_token,lease_expires_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'processing',?,?,'now','now')`,
      [job.id, job.tenantId, job.personId, job.pursuitId, job.jobHash, job.requestedBy, job.leaseToken, new Date(Date.now() + 60_000).toISOString()],
    );
    expect(await db.one("SELECT id FROM pursuit_preparation_jobs WHERE id = ? AND lease_token = ? AND status = 'processing' AND lease_expires_at > ?", [job.id, job.leaseToken, new Date().toISOString()])).not.toBeNull();
    const base = { archetypeId: null, targetMandate: "Build a practice", winTheme: "Commercial builder", recommendedPositioning: "Builder", primaryProof: [], objections: [], narrativesToAvoid: [], targetAudience: [], archetypeScores: [], archetypeMatchReasoning: null, routeStrategy: [], semantic: null, derivation: "DETERMINISTIC", modelId: null, lineage: { ...lineage, ledgerBindingFingerprint: null, anchorDocumentId: null } } as Omit<PursuitThesis, "id" | "pursuitId" | "version" | "createdAt">;
    const thesis = await insertThesis(pursuit!.id, base, job);
    expect((await db.one<{ payload: string }>("SELECT payload FROM pursuit_stage_checkpoints WHERE job_id='prep_A' AND stage='thesis_row'"))?.payload).toContain(thesis.id);
    await expect(insertThesis(pursuit!.id, base, job)).rejects.toThrow();
    expect((await db.one<{ n: number }>("SELECT count(*) AS n FROM pursuit_theses WHERE pursuit_id=?", [pursuit!.id]))?.n).toBe(1);

    await db.execute("UPDATE pursuit_preparation_jobs SET lease_token='new_owner' WHERE id='prep_A'");
    await expect(publishPreparation(job, thesis, [], "done")).rejects.toThrow("LEASE_LOST");
    expect((await db.one<{ active_thesis_id: string | null }>("SELECT active_thesis_id FROM opportunity_pursuits WHERE id=?", [pursuit!.id]))?.active_thesis_id).toBeNull();
  });

  it("keeps the existing telemetry status constraint and indexes while attributing Pursuit calls", async () => {
    const indexes = (await db.many<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='model_invocations'")).map((x) => x.name);
    for (const name of ["idx_model_invocations_job", "idx_model_invocations_scope", "idx_model_invocations_live", "idx_model_invocations_telemetry", "idx_model_invocations_pursuit_job"]) expect(indexes).toContain(name);
    const sink = createSqliteModelInvocationSink(db, { pipeline: "pursuit", tenantId: scope.tenantId, personId: scope.personId, canonicalJobId: "job_A", opportunityVersion: "version_A", evaluationContextFingerprint: "fingerprint_A", pursuitId: "pursuit_A", pursuitPreparationJobId: "prep_A" });
    await sink({ invocationId: "call_A", provider: "test", modelId: "test", modelVersion: "1", modelConfigurationFingerprint: "cfg", requestFingerprint: "req", stage: "resume", attempt: 1, startedAt: Date.now(), status: "completed" });
    expect(await db.one("SELECT id FROM model_invocations WHERE id='call_A' AND pursuit_id='pursuit_A' AND pursuit_preparation_job_id='prep_A' AND pipeline='pursuit'")).not.toBeNull();
    await expect(db.execute(`UPDATE model_invocations SET status='bogus' WHERE id='call_A'`)).rejects.toThrow();
  });

  it("rejects cross-scope archetype, artifact and learning relationships", async () => {
    await db.execute("INSERT INTO opportunity_pursuits(id,tenant_id,person_id,job_hash,status,preparation_state,created_at,updated_at) VALUES ('pursuit_B','tenant_B','person_B','hash_B','PREPARING','QUEUED','now','now')");
    const a = await db.one<{ id: string }>("SELECT id FROM opportunity_pursuits WHERE job_hash='hash_A'");
    await db.execute("INSERT INTO candidate_archetypes(id,tenant_id,person_id,name,created_at,updated_at) VALUES ('arch_B','tenant_B','person_B','Other person','now','now')");
    await expect(db.execute("UPDATE opportunity_pursuits SET active_archetype_id='arch_B' WHERE id=?", [a!.id])).rejects.toThrow("PURSUIT_ACTIVE_ARCHETYPE_SCOPE");
    await db.execute("INSERT INTO pursuit_theses(id,pursuit_id,version,target_mandate,win_theme,recommended_positioning,created_at) VALUES ('thesis_B','pursuit_B',1,'Mandate','Theme','Position','now')");
    await expect(db.execute("INSERT INTO pursuit_artifacts(id,pursuit_id,thesis_id,artifact_type,version,content_json,created_at,updated_at) VALUES (?,?,?,'RESUME',1,'{}','now','now')", ["bad_artifact", a!.id, "thesis_B"])).rejects.toThrow("PURSUIT_ARTIFACT_THESIS_FOREIGN");
    await expect(db.execute("INSERT INTO candidate_learning_signals(id,tenant_id,person_id,pursuit_id,signal_type,created_at) VALUES ('bad_signal','tenant_A','person_A','pursuit_B','MESSAGE_REWRITTEN','now')")).rejects.toThrow("LEARNING_SIGNAL_PURSUIT_SCOPE");
  });

  it("licenses direct wording to the cited assertion and preserves currency", () => {
    const claim = { id: "proof", statement: "Owned a $8M fee book", metricBaseline: null, metricResult: null } as CandidateClaim;
    const message = (text: string, ids: string[]) => ({ kind: "MESSAGE" as const, message: { subject: null, targetWords: null, body: text, proofAssertions: [{ text, claimIds: ids }] } });
    expect(ledgerApprovalBlockers(message("I have done this before: owned a $8M fee book.", ["proof"]), { claims: [claim], proofRelationships: { proof: "ANALOGOUS" } })).not.toEqual([]);
    expect(ledgerApprovalBlockers(message("I have done this before: owned a $8M fee book.", ["proof"]), { claims: [claim], proofRelationships: { proof: "DIRECT" } })).toEqual([]);
    expect(ledgerApprovalBlockers(message("I have done this before: owned a €8M fee book.", ["proof"]), { claims: [claim], proofRelationships: { proof: "DIRECT" } })).not.toEqual([]);
  });

  it("leaves archetypes absent on read until an explicit save", async () => {
    expect(await listArchetypes(scope)).toEqual([]);
    expect((await db.one<{ n: number }>("SELECT count(*) AS n FROM candidate_archetypes WHERE tenant_id='tenant_A' AND person_id='person_A'"))?.n).toBe(0);
    await saveArchetype(scope, { name: "Builder", emphasize: [], deEmphasize: [], targetRoles: [], pinnedClaimIds: [], anchorDocumentIds: [], isDefault: true });
    expect((await listArchetypes(scope)).map((item) => item.name)).toEqual(["Builder"]);
  });

  it("requires approval before artifact export or outreach sent", async () => {
    const pursuit = await db.one<{ id: string }>("SELECT id FROM opportunity_pursuits WHERE job_hash='hash_A'");
    for (const [id, type, version, status] of [["draft_note", "EXEC_NOTE", 1, "DRAFT"], ["approved_note", "EXEC_NOTE", 2, "APPROVED"], ["approved_resume", "RESUME", 1, "APPROVED"]]) {
      await db.execute("INSERT INTO pursuit_artifacts(id,pursuit_id,artifact_type,version,content_json,status,created_at,updated_at) VALUES (?,?,?,?, '{}',?,'now','now')", [id, pursuit!.id, type, version, status]);
    }
    await expect(requireApprovedArtifact(pursuit!.id, "draft_note")).rejects.toThrow("ARTIFACT_NOT_APPROVED");
    await expect(recordApprovedOutreachSent(scope, "hash_A", "draft_note")).rejects.toThrow("APPROVED_OUTREACH_REQUIRED");
    await expect(recordApprovedOutreachSent(scope, "hash_A", "approved_resume")).rejects.toThrow("APPROVED_OUTREACH_REQUIRED");
    expect((await db.one<{ status: string }>("SELECT status FROM opportunity_pursuits WHERE id=?", [pursuit!.id]))?.status).not.toBe("OUTREACH_SENT");
    expect((await requireApprovedArtifact(pursuit!.id, "approved_note")).id).toBe("approved_note");
    await recordApprovedOutreachSent(scope, "hash_A", "approved_note");
    expect((await db.one<{ status: string }>("SELECT status FROM opportunity_pursuits WHERE id=?", [pursuit!.id]))?.status).toBe("OUTREACH_SENT");
    expect((await db.one<{ n: number }>("SELECT count(*) AS n FROM pursuit_activities WHERE pursuit_id=? AND activity_type='OUTREACH_SENT'", [pursuit!.id]))?.n).toBe(1);
  });

  it("keeps claims from an older graph unchanged when a new graph reuses a fact ID", async () => {
    await db.execute("INSERT INTO candidate_documents(id,person_id,tenant_id,filename,storage_uri,mime_type,document_hash) VALUES ('doc_A','person_A','tenant_A','cv.txt','memory://cv','text/plain','doc-hash')");
    const graph = (value: string) => JSON.stringify({ facts: [{ id: "reused_fact", type: "ACHIEVEMENT", value, sourceSpan: value }] });
    await db.execute("INSERT INTO evidence_graphs(id,person_id,tenant_id,document_id,graph_json,extractor_version,prompt_version,model) VALUES ('graph_v1','person_A','tenant_A','doc_A',?,'1','1','test')", [graph("Owned a $8M fee book")]);
    await db.execute("INSERT INTO profile_projection_source_bindings(tenant_id,person_id,profile_version,document_id,evidence_graph_id,document_text_hash) VALUES ('tenant_A','person_A','v1','doc_A','graph_v1','doc-hash')");
    await projectLedger(scope, { profileVersion: "v1" });
    const old = await db.one<{ id: string; statement: string; current_projection: number }>("SELECT id,statement,current_projection FROM candidate_claims WHERE source_evidence_graph_id='graph_v1'");
    await db.execute("INSERT INTO evidence_graphs(id,person_id,tenant_id,document_id,graph_json,extractor_version,prompt_version,model) VALUES ('graph_v2','person_A','tenant_A','doc_A',?,'2','2','test')", [graph("Owned a €12M fee book")]);
    await db.execute("INSERT INTO profile_projection_source_bindings(tenant_id,person_id,profile_version,document_id,evidence_graph_id,document_text_hash) VALUES ('tenant_A','person_A','v2','doc_A','graph_v2','doc-hash')");
    await projectLedger(scope, { profileVersion: "v2" });
    const rows = await db.many<{ id: string; statement: string; current_projection: number; source_evidence_graph_id: string }>("SELECT id,statement,current_projection,source_evidence_graph_id FROM candidate_claims WHERE source_fact_id='reused_fact' ORDER BY source_evidence_graph_id");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ...old, source_evidence_graph_id: "graph_v1", current_projection: 0 });
    expect(rows[1]).toMatchObject({ statement: "Owned a €12M fee book", source_evidence_graph_id: "graph_v2", current_projection: 1 });
    expect(rows[1].id).not.toBe(old?.id);
  });
});
