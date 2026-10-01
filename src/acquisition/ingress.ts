import fs from "node:fs";
import { timingSafeEqual, createHash } from "node:crypto";
import { getDatabaseAdapter, type DatabaseAdapter } from "../data/database";
import { getBlobStore, type BlobStore } from "../lib/storage/blob-store";
import { resolveServingScope } from "../lib/security/scope-resolver";
import { CanonicalIngestionService, type CanonicalIngestionResult } from "./ingestion-service";
import { EvaluationWorkScheduler, type EvaluationWorkIdentity } from "../evaluation/work-scheduler";
import { byteHash, decodeEnvelope, handoffPrefix, HANDOFF_MAX_BYTES, type AcquisitionReference } from "./handoff";

export interface AcquisitionDevice { tokenSha256: string; userId: string; tenantId: string; personId: string; }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

async function completeReceipt(db: DatabaseAdapter, submissionId: string, serialized: string): Promise<CanonicalIngestionResult> {
  const receipt = JSON.parse(serialized) as CanonicalIngestionResult | { state: "DISPATCH_PENDING"; result: CanonicalIngestionResult; work: EvaluationWorkIdentity[] };
  if (!("state" in receipt)) return receipt;
  const result = { ...receipt.result };
  for (const work of receipt.work) {
    await new EvaluationWorkScheduler(db).ensureWork(work);
  }
  // Count durable obligations, rather than whichever replay happened to create them.
  result.jobsEnqueued = receipt.work.length;
  await db.execute("UPDATE acquisition_ingress_submissions SET response_json=? WHERE submission_id=? AND response_json=?",
    [JSON.stringify(result), submissionId, serialized]);
  return result;
}

async function readReference(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { reader.releaseLock(); }
}

export async function acquisitionIngress(request: Request, deps?: { db?: DatabaseAdapter; store?: BlobStore; devices?: AcquisitionDevice[] }): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const deviceFile = process.env.RADAR_ACQUISITION_DEVICES_FILE;
  if (!deps?.devices && !deviceFile) return json({ error: "Acquisition ingress disabled" }, 503);
  try {
    const devices: AcquisitionDevice[] = deps?.devices || JSON.parse(fs.readFileSync(deviceFile!, "utf8"));
    const presented = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!presented) return json({ error: "Unauthorized" }, 401);
    const digest = createHash("sha256").update(presented).digest();
    const device = devices.find(d => /^[a-f0-9]{64}$/.test(d.tokenSha256) && timingSafeEqual(Buffer.from(d.tokenSha256, "hex"), digest));
    if (!device) return json({ error: "Unauthorized" }, 401);
    const text = await readReference(request);
    if (text === null) return json({ error: "Reference too large" }, 413);
    const ref = JSON.parse(text) as AcquisitionReference;
    const prefix = handoffPrefix(device.tenantId, device.personId);
    if (!/^[a-f0-9]{64}$/.test(ref.sha256) || ref.submissionId !== ref.sha256 ||
        ref.payloadKey !== `${prefix}${ref.sha256}.json` || !Number.isSafeInteger(ref.sizeBytes) ||
        ref.sizeBytes < 1 || ref.sizeBytes > HANDOFF_MAX_BYTES || !ref.lease?.owner || !ref.lease?.token) return json({ error: "Invalid reference" }, 400);
    const db = deps?.db || getDatabaseAdapter();
    const { scope } = await resolveServingScope(device.userId, device.tenantId, db, device.personId, "write:person");
    const receipt = await db.one<{ content_hash: string; response_json: string; tenant_id: string; person_id: string }>(
      "SELECT content_hash, response_json, tenant_id, person_id FROM acquisition_ingress_submissions WHERE submission_id=?", [ref.submissionId]);
    if (receipt) {
      if (receipt.content_hash !== ref.sha256 || receipt.tenant_id !== device.tenantId || receipt.person_id !== device.personId) return json({ error: "Submission conflict" }, 409);
      return json(await completeReceipt(db, ref.submissionId, receipt.response_json));
    }
    const store = deps?.store || getBlobStore({ enforceDistributed: true });
    const bytes = await store.get(ref.payloadKey);
    if (!bytes) return json({ error: "Payload missing" }, 422);
    if (bytes.length !== ref.sizeBytes || byteHash(bytes) !== ref.sha256) return json({ error: "Payload integrity failure" }, 409);
    const envelope = decodeEnvelope(bytes);
    if (envelope.scope.tenantId !== scope.tenantId || envelope.scope.personId !== scope.personId) return json({ error: "Scope mismatch" }, 403);
    const payload = { ...envelope.payload, ...(envelope.sourcePayloadBase64 ? { sourcePayload: Buffer.from(envelope.sourcePayloadBase64, "base64") } : {}) };
    await new CanonicalIngestionService(db, store).ingestOpportunity(payload, {
      scope: envelope.scope, scrapeLease: ref.lease,
      deferPostCommitDispatch: true,
      onCanonicalCommit: async (tx, result, work) => {
        await tx.execute(`INSERT INTO acquisition_ingress_submissions
          (submission_id,tenant_id,person_id,search_plan_id,run_id,content_hash,canonical_job_id,opportunity_version,response_json)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO NOTHING`, [ref.submissionId, scope.tenantId, scope.personId,
          envelope.scope.searchPlanId || null, envelope.scope.runId, ref.sha256, result.canonicalJobId, result.opportunityVersion,
          JSON.stringify({ state: "DISPATCH_PENDING", result, work })]);
      },
    });
    const accepted = await db.one<{ response_json: string }>("SELECT response_json FROM acquisition_ingress_submissions WHERE submission_id=?", [ref.submissionId]);
    return json(await completeReceipt(db, ref.submissionId, accepted!.response_json));
  } catch (error) {
    const name = (error as Error).name;
    if (name === "SyntaxError") return json({ error: "Invalid JSON" }, 400);
    if (name === "TenantIsolationError") return json({ error: "Forbidden" }, 403);
    if (name === "AcquisitionIntegrityError" || name === "BlobIntegrityError") return json({ error: "Acquisition integrity conflict" }, 409);
    console.error("Acquisition ingress failed", name);
    return json({ error: "Acquisition unavailable" }, 503);
  }
}
