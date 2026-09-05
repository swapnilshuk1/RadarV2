import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { SqliteDocumentStore } from "../../src/data/sqlite/repositories/SqliteDocumentStore";
import { SqliteEvaluationContextStore } from "../../src/data/sqlite/repositories/SqliteEvaluationContextStore";
import { requireDecisionAcknowledgement } from "../../src/lib/intelligence/decision-acknowledgement";
import { resolveProjectionCompletionStage } from "../../src/lib/intelligence/pipeline/projection-completion-state";
import { resolveProfilePipelineStepState } from "../../src/lib/intelligence/profile-pipeline-presentation";
import { resolveIntentActivationPresentation } from "../../src/lib/intelligence/profile-intent-presentation";

async function createDocumentFixture() {
  const db = new SqliteAdapter(new Database(":memory:"));
  await runMigrations(db);
  await db.execute("INSERT INTO people (id, email) VALUES ('person-a', 'a@example.test'), ('person-b', 'b@example.test')");
  return { db, store: new SqliteDocumentStore(db) };
}

describe("Gate 4 write and refresh edge contracts", () => {
  it("keeps byte-identical documents and their durable jobs owned by their uploader", async () => {
    const { db, store } = await createDocumentFixture();
    const hash = "a".repeat(64);
    for (const [personId, documentId] of [["person-a", "doc-a"], ["person-b", "doc-b"]] as const) {
      await store.saveDocument({
        id: documentId, personId, filename: "cv.pdf", storageUri: `turso://${documentId}`,
        mimeType: "application/pdf", documentHash: hash, status: "UPLOADED", stage: "DOCUMENT_REGISTERED",
        createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
      });
      await store.enqueueDocumentProcessing({
        id: `job-${documentId}`, personId, documentId, jobHash: `document-job:${documentId}`, payloadJson: "{}",
      });
    }

    const rows = await db.many<{ document_id: string; person_id: string; document_hash: string; job_person_id: string }>(
      `SELECT d.id AS document_id, d.person_id, d.document_hash, j.person_id AS job_person_id
       FROM candidate_documents d JOIN candidate_document_jobs j ON j.document_id = d.id ORDER BY d.id`,
    );
    expect(rows).toEqual([
      { document_id: "doc-a", person_id: "person-a", document_hash: hash, job_person_id: "person-a" },
      { document_id: "doc-b", person_id: "person-b", document_hash: hash, job_person_id: "person-b" },
    ]);
  });

  it("creates the first explicit active context without a predecessor pointer", async () => {
    const db = new SqliteAdapter(new Database(":memory:"));
    await runMigrations(db);
    await db.execute("INSERT INTO tenants (id, status) VALUES ('tenant-a', 'active')");
    await db.execute("INSERT INTO people (id, email, tenant_id) VALUES ('person-a', 'a@example.test', 'tenant-a')");
    const store = new SqliteEvaluationContextStore(db);
    const scope = { tenantId: "tenant-a", personId: "person-a", roles: [] };
    expect(await db.one("SELECT 1 FROM active_evaluation_contexts WHERE tenant_id = 'tenant-a'")).toBeNull();

    const prepared = await store.prepareSearchPlan(scope, {
      title: "First plan",
      criteria: { targetSeniority: ["VP"], targetRoles: ["VP Growth"], targetLocations: ["Bengaluru"] },
      ontologyVersion: "v1", ontologyFingerprint: "ontology", policyVersion: "v1",
      profileVersion: "projection-v1", activatedBy: "first-intent",
    });
    await store.activatePreparedSearchPlan(scope, prepared.plan.id, prepared.context.contextFingerprint, "first-intent");
    const active = await store.getActiveSearchPlanWithSnapshot(scope);
    expect(active.planId).toBe(prepared.plan.id);
    expect(active.contextFingerprint).toBe(prepared.context.contextFingerprint);
  });

  it("uses a fresh runnable job for a same-owner byte-identical re-upload", async () => {
    const { db, store } = await createDocumentFixture();
    for (const documentId of ["doc-first", "doc-reupload"]) {
      await store.saveDocument({
        id: documentId, personId: "person-a", filename: "cv.pdf", storageUri: `turso://${documentId}`,
        mimeType: "application/pdf", documentHash: "b".repeat(64), status: "UPLOADED", stage: "DOCUMENT_REGISTERED",
        createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
      });
      await store.enqueueDocumentProcessing({
        id: `job-${documentId}`, personId: "person-a", documentId, jobHash: `document-job:${documentId}`, payloadJson: "{}",
      });
    }
    await db.execute("UPDATE candidate_document_jobs SET status = 'completed' WHERE document_id = 'doc-first'");
    const retry = await db.one<{ status: string; document_id: string }>(
      "SELECT status, document_id FROM candidate_document_jobs WHERE document_id = 'doc-reupload'",
    );
    expect(retry).toEqual({ status: "pending", document_id: "doc-reupload" });
  });

  it("preserves omitted canonical intent preferences as unknown", async () => {
    const { db, store } = await createDocumentFixture();
    await store.saveCareerIntent({ personId: "person-a", preferredLocations: ["Bengaluru"], targetTitles: ["VP Growth"] });
    const intent = await store.getLatestCareerIntent("person-a");
    expect(intent?.preferredWorkModel).toBeUndefined();
    expect(intent?.travelTolerance).toBeUndefined();
    const row = await db.one<{ preferred_work_model: string | null; travel_tolerance: string | null }>(
      "SELECT preferred_work_model, travel_tolerance FROM career_intents WHERE person_id = 'person-a'",
    );
    expect(row).toEqual({ preferred_work_model: null, travel_tolerance: null });
  });

  it("does not permit undo or clear local changes before canonical acknowledgement", async () => {
    const decisions = { job: { verb: "PURSUE" as const, at: 1 } };
    await expect(requireDecisionAcknowledgement(async () => ({ success: false }), "undo rejected")).rejects.toThrow("undo rejected");
    expect(decisions.job.verb).toBe("PURSUE");
    await requireDecisionAcknowledgement(async () => ({ success: true }), "clear rejected");
    delete decisions.job;
    expect(decisions).toEqual({});
  });

  it("marks a CV without intent profile-ready rather than evaluation-complete", () => {
    expect(resolveProjectionCompletionStage(false)).toBe("PROFILE_READY");
    expect(resolveProjectionCompletionStage(true)).toBe("EVALUATED");
  });

  it("does not visually complete recommendation evaluation for PROFILE_READY", () => {
    expect(resolveProfilePipelineStepState("PROFILE_READY", "PROFILE_READY")).toBe("current");
    expect(resolveProfilePipelineStepState("PROFILE_READY", "EVALUATED")).toBe("pending");
    expect(resolveProfilePipelineStepState("PROFILE_READY", "COMPLETED")).toBe("pending");
    expect(resolveProfilePipelineStepState("COMPLETED", "EVALUATED")).toBe("complete");
  });

  it("keeps persisted-but-pending activation on the profile page", () => {
    expect(resolveIntentActivationPresentation({ success: true, activationState: "ACTIVE" })).toMatchObject({
      persisted: true, activationPending: false, navigateHome: true,
    });
    expect(resolveIntentActivationPresentation({
      success: true, activationState: "PENDING_ACTIVATION", activationError: "coverage incomplete",
    })).toMatchObject({
      persisted: true, activationPending: true, navigateHome: false,
    });
  });
});
