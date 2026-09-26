/** Durable CV/document worker. Run explicitly by a worker bootstrap, never a request handler. */
import crypto from "node:crypto";
import { getDatabaseAdapter } from "../src/data/database";
import { ProjectionPipeline } from "../src/lib/intelligence/pipeline/ProjectionPipeline";

export async function processNextDocumentJob(workerId = `document-worker-${crypto.randomUUID()}`): Promise<boolean> {
  const db = getDatabaseAdapter();
  const job = await db.one<{ id: string; tenant_id: string; person_id: string; document_id: string; payload_json: string; attempts: number; max_attempts: number }>(
    `SELECT j.id, j.tenant_id, j.person_id, j.document_id, j.payload_json, j.attempts, j.max_attempts
     FROM candidate_document_jobs j
     JOIN candidate_documents d ON d.id = j.document_id AND d.tenant_id = j.tenant_id AND d.person_id = j.person_id
     WHERE (j.status = 'pending' AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= CURRENT_TIMESTAMP)) OR (j.status = 'processing' AND j.locked_at < datetime('now', '-300 seconds'))
     ORDER BY j.created_at LIMIT 1`,
  );
  if (!job) return false;
  const leaseToken = crypto.randomUUID();
  const claimed = await db.execute(
    `UPDATE candidate_document_jobs SET status = 'processing', locked_by = ?, lease_token = ?, locked_at = CURRENT_TIMESTAMP
     WHERE id = ? AND (status = 'pending' OR (status = 'processing' AND locked_at < datetime('now', '-300 seconds')))`,
    [workerId, leaseToken, job.id],
  );
  if (claimed.rowsAffected !== 1) return false;
  try {
    const payload = JSON.parse(job.payload_json);
    const result = await new ProjectionPipeline().run({
      scope: { tenantId: job.tenant_id, personId: job.person_id }, documentId: job.document_id, filename: payload.filename,
      storageUri: `turso://document_contents/${job.document_id}`, mimeType: payload.mimeType,
      documentHash: payload.documentHash, documentText: payload.documentText,
      fileBuffer: payload.base64Buffer ? Buffer.from(payload.base64Buffer, "base64") : undefined,
    });
    if (!result.success) throw new Error(result.error || "Document pipeline failed");
    const completed = await db.execute(
      `UPDATE candidate_document_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
      [job.id, workerId, leaseToken],
    );
    if (completed.rowsAffected !== 1) throw new Error("DOCUMENT_JOB_LEASE_LOST");
    await db.execute(`UPDATE candidate_document_jobs SET payload_json = '{}' WHERE id = ? AND status = 'completed'`, [job.id]);
    return true;
  } catch (error: any) {
    const attempts = job.attempts + 1;
    const terminal = attempts >= job.max_attempts;
    const failed = await db.execute(
      `UPDATE candidate_document_jobs
       SET status = ?, attempts = ?, last_error = ?, locked_by = NULL, lease_token = NULL, locked_at = NULL,
           next_attempt_at = CASE WHEN ? = 'pending' THEN datetime('now', '+30 seconds') ELSE NULL END
       WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
      [terminal ? "dead_letter" : "pending", attempts, error?.message || String(error), terminal ? "dead_letter" : "pending", job.id, workerId, leaseToken],
    );
    if (failed.rowsAffected !== 1) throw new Error("DOCUMENT_JOB_LEASE_LOST");
    return true;
  }
}

if (process.argv[1]?.endsWith("process-document-jobs.ts")) {
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const workerId = `document-worker-${crypto.randomUUID()}`;
  const run = async () => {
    while (!stopping) {
      try {
        const processed = await processNextDocumentJob(workerId);
        if (!processed) await new Promise(resolve => setTimeout(resolve, 1_000));
      } catch (error) {
        console.error(error);
        await new Promise(resolve => setTimeout(resolve, 5_000));
      }
    }
  };
  run().catch((error) => { console.error(error); process.exitCode = 1; });
}
