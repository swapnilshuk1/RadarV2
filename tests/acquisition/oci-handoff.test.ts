import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture, activateLineageTestContext } from "../persistence/lineage_fixture";
import { MemoryBlobStore } from "../../src/lib/storage/blob-store";
import { AcquisitionOutbox } from "../../src/acquisition/outbox";
import { acquisitionIngress } from "../../src/acquisition/ingress";
import { byteHash, encodeEnvelope, handoffPrefix } from "../../src/acquisition/handoff";
import { assertAcquisitionHost } from "../../src/acquisition/execution-role";
import { STAGED_POLICY_VERSION } from "../../src/evaluation/policy";
import type { CanonicalIngestionResult, IngestOpportunityPayload } from "../../src/acquisition/ingestion-service";

const scope = { mode: "SCOPED" as const, tenantId: "tenant_A", personId: "person_A", searchPlanId: "plan_A", runId: "oci-run" };
const lease = { owner: "local-worker", token: "test-lease" };
const token = "synthetic-test-device-token-never-used-live";
const device = { tokenSha256: byteHash(Buffer.from(token)), userId: "person_A", tenantId: "tenant_A", personId: "person_A" };
const payload: IngestOpportunityPayload = { sourcePortal: "LinkedIn", sourceJobId: "1234567",
  canonicalUrl: "https://www.linkedin.com/jobs/view/1234567", jobTitle: "VP Engineering", companyName: "Test Company",
  location: "Mumbai", rawContent: "We are hiring a VP Engineering to lead engineering strategy and delivery. Responsibilities include building and mentoring engineering teams, defining product architecture, managing technical roadmaps and collaborating with the executive leadership team. Requirements include fifteen years of engineering experience and proven leadership of large software teams. The successful candidate will own engineering operations, hiring, delivery quality and platform reliability. This full time leadership role is based in Mumbai." };
payload.enrichmentDispatch = { pipelineVersion: "1.0.0", detailedCard: { title: payload.jobTitle,
  company: payload.companyName, location: payload.location, cardHash: payload.sourceJobId,
  portal: payload.sourcePortal, detailUrl: payload.canonicalUrl, detail: { fetched: true, rawText: payload.rawContent } } };
const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function fixture() {
  const sqlite = new Database(":memory:"); const db = new SqliteAdapter(sqlite);
  await setupLineageTestFixture(db);
  await activateLineageTestContext(db);
  await db.execute("UPDATE evaluation_contexts SET policy_version=?", [STAGED_POLICY_VERSION]);
  await db.execute("INSERT INTO users(id,email) VALUES('person_A','a@a.com')");
  await db.execute("INSERT INTO memberships(user_id,tenant_id,role,permissions,status) VALUES('person_A','tenant_A','admin','[]','active')");
  await db.execute(`INSERT INTO scrape_runs(id,tenant_id,person_id,search_plan_id,status,portal_targets,lease_owner,lease_token,lease_expires_at)
    VALUES(?,?,?,?, 'running','[]',?,?,?)`, [scope.runId, scope.tenantId, scope.personId, scope.searchPlanId, lease.owner, lease.token, Date.now()+60_000]);
  const store = new MemoryBlobStore();
  return { db, store, sqlite };
}
function request(ref: unknown, credential = token) {
  return new Request("https://radar.example/api/acquisition/submit", { method: "POST", headers: { authorization: `Bearer ${credential}` }, body: JSON.stringify(ref) });
}
function reference(bytes: Buffer) {
  const sha256 = byteHash(bytes);
  return { submissionId: sha256, sha256, payloadKey: `${handoffPrefix(scope.tenantId,scope.personId)}${sha256}.json`, sizeBytes: bytes.length, lease };
}

describe("OCI acquisition handoff", () => {
  it("admits through ingress and replays the original receipt after the run stops", async () => {
    const { db, store, sqlite } = await fixture();
    try {
      const bytes = encodeEnvelope(payload,scope); const ref = reference(bytes); await store.put(ref.payloadKey, bytes);
      const first = await acquisitionIngress(request(ref), { db, store, devices: [device] });
      expect(first.status).toBe(200); const receipt = await first.json();
      expect(receipt.isNewOpportunity).toBe(true);
      await db.execute("UPDATE scrape_runs SET status='completed', lease_expires_at=0 WHERE id=?", [scope.runId]);
      const replay = await acquisitionIngress(request(ref), { db, store, devices: [device] });
      expect(replay.status).toBe(200); expect(await replay.json()).toEqual(receipt);
      expect(await db.one("SELECT COUNT(*) AS count FROM opportunity_versions")).toEqual({ count: 1 });
    } finally { sqlite.close(); }
  });
  it("rejects stale ownership without committing canonical rows", async () => {
    const { db, store, sqlite } = await fixture();
    try {
      const bytes = encodeEnvelope(payload,scope); const ref = reference(bytes); await store.put(ref.payloadKey, bytes);
      ref.lease = { owner: "stale", token: "stale" };
      expect((await acquisitionIngress(request(ref), { db, store, devices: [device] })).status).toBe(409);
      expect(await db.one("SELECT COUNT(*) AS count FROM canonical_opportunities")).toEqual({ count: 0 });
      expect(await db.one("SELECT COUNT(*) AS count FROM acquisition_ingress_submissions")).toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });
  it("rejects invalid credentials, foreign object prefixes and corrupt bytes", async () => {
    const { db, store, sqlite } = await fixture();
    try {
      const bytes = encodeEnvelope(payload,scope); const ref = reference(bytes);
      expect((await acquisitionIngress(request(ref,"wrong"), { db, store, devices: [device] })).status).toBe(401);
      expect((await acquisitionIngress(request({ ...ref, payloadKey: "handoff/another-tenant/payload" }), { db, store, devices: [device] })).status).toBe(400);
      await store.put(ref.payloadKey, "corrupt");
      expect((await acquisitionIngress(request(ref), { db, store, devices: [device] })).status).toBe(409);
    } finally { sqlite.close(); }
  });
  it("recovers a persisted dispatch receipt without re-admission", async () => {
    const { db, store, sqlite } = await fixture();
    try {
      const bytes = encodeEnvelope(payload,scope); const ref = reference(bytes); await store.put(ref.payloadKey, bytes);
      const first = await acquisitionIngress(request(ref), { db, store, devices: [device] });
      const result = await first.json();
      await db.execute("DELETE FROM evaluation_jobs");
      const work = [{ tenantId: scope.tenantId, personId: scope.personId, searchPlanId: scope.searchPlanId,
        canonicalJobId: result.canonicalJobId, opportunityVersion: result.opportunityVersion, evaluationContextFingerprint: "fingerprint_A" }];
      await db.execute("UPDATE acquisition_ingress_submissions SET response_json=? WHERE submission_id=?", [JSON.stringify({ state: "DISPATCH_PENDING", result, work }), ref.submissionId]);
      await db.execute("UPDATE scrape_runs SET status='completed' WHERE id=?", [scope.runId]);
      const replay = await acquisitionIngress(request(ref), { db, store, devices: [device] });
      expect(replay.status).toBe(200); expect(await replay.json()).toEqual(result);
      expect(await db.one("SELECT COUNT(*) AS count FROM evaluation_jobs")).toEqual({ count: 1 });
    } finally { sqlite.close(); }
  });
  it("keeps staged bytes across upload and acknowledgement failures and process restart", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),"radar-outbox-")); tempDirs.push(directory);
    const store = new MemoryBlobStore(); let attempts = 0;
    const result = { canonicalJobId: "job", opportunityVersion: "v1" } as CanonicalIngestionResult;
    const submit = async () => { attempts++; if (attempts===1) throw new Error("Lost acknowledgement"); return result; };
    const outbox = new AcquisitionOutbox(directory,store,submit);
    await expect(outbox.acquire(payload,scope,lease)).rejects.toThrow("Lost acknowledgement");
    expect(fs.readdirSync(directory)).toHaveLength(1);
    const restarted = new AcquisitionOutbox(directory,store,submit);
    expect(await restarted.replayRun(scope.runId,lease)).toBe(1);
    expect(await restarted.acquire(payload,scope,lease)).toEqual(result);
    expect(attempts).toBe(2);
  });
  it("keeps HTML local and rejects credential/session metadata", () => {
    const withHtml = { ...payload, enrichmentDispatch: { pipelineVersion: "test", detailedCard: { rawHtml: "private browser HTML", rawText: payload.rawContent } } };
    expect(encodeEnvelope(withHtml,scope).toString()).not.toContain("private browser HTML");
    expect(() => encodeEnvelope({ ...payload, enrichmentDispatch: { pipelineVersion: "test", detailedCard: { cookies: "secret" } } },scope)).toThrow("SESSION_MATERIAL");
  });
  it("prevents processing hosts from launching portal acquisition", () => {
    expect(() => assertAcquisitionHost({ RADAR_RUNTIME_ROLE: "processing" })).toThrow("DISABLED");
    expect(() => assertAcquisitionHost({ RADAR_DEPLOYMENT_MODE: "distributed" })).toThrow("DESIGNATED");
    expect(() => assertAcquisitionHost({ RADAR_DEPLOYMENT_MODE: "distributed", RADAR_RUNTIME_ROLE: "acquisition" })).not.toThrow();
  });
});
