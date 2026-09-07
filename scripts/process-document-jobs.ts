/** Durable CV/document worker. Run explicitly by a worker bootstrap, never a request handler. */
import crypto from "node:crypto";
import { getDatabaseAdapter } from "../src/data/database";
import { ProjectionPipeline } from "../src/lib/intelligence/pipeline/ProjectionPipeline";

export async function processNextDocumentJob(workerId = `document-worker-${crypto.randomUUID()}`): Promise<boolean> {
  const db = getDatabaseAdapter();
  const job = await db.one<{ id: string; person_id: string; document_id: string; payload_json: string; attempts: number; max_attempts: number }>(
    `SELECT j.id, j.person_id, j.document_id, j.payload_json, j.attempts, j.max_attempts
     FROM candidate_document_jobs j
     JOIN candidate_documents d ON d.id = j.document_id AND d.person_id = j.person_id
     WHERE j.status = 'pending' OR (j.status = 'processing' AND j.locked_at < datetime('now', '-300 seconds'))
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
      documentId: job.document_id, personId: job.person_id, filename: payload.filename,
      storageUri: `turso://document_contents/${job.document_id}`, mimeType: payload.mimeType,
      documentHash: payload.documentHash, documentText: payload.documentText,
      fileBuffer: payload.base64Buffer ? Buffer.from(payload.base64Buffer, "base64") : undefined,
    });
    if (!result.success) throw new Error(result.error || "Document pipeline failed");
    await db.execute(
      `UPDATE candidate_document_jobs SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
      [job.id, workerId, leaseToken],
    );
    return true;
  } catch (error: any) {
    const attempts = job.attempts + 1;
    const terminal = attempts >= job.max_attempts;
    await db.execute(
      `UPDATE candidate_document_jobs
       SET status = ?, attempts = ?, last_error = ?, locked_by = NULL, lease_token = NULL, locked_at = NULL
       WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
      [terminal ? "dead_letter" : "pending", attempts, error?.message || String(error), job.id, workerId, leaseToken],
    );
    return true;
  }
}

if (process.argv[1]?.endsWith("process-document-jobs.ts")) {
  processNextDocumentJob().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
