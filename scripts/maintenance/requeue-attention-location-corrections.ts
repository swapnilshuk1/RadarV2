/*
 * One-off, bounded repair for a persisted attention-gate geography conflict.
 *
 * Scope: only LOCATION_CONTRADICTION rows created by one named scrape run.
 * It re-applies the current deterministic gate, updates the corresponding
 * search-plan candidate record, queues only newly eligible rows, then drains
 * only that otherwise-empty queue through the normal EvaluationWorker.
 */
import crypto from "node:crypto";
import { getDatabaseAdapter } from "../../src/data/database";
import { evaluateAttentionGate } from "../../src/lib/intelligence/AttentionGate";
import { EvaluationWorker } from "../../src/lib/intelligence/EvaluationWorker";

const runId = process.argv[2] || "run-1788945245759";

async function main() {
  const db = getDatabaseAdapter();
  const outstanding = await db.one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM evaluation_jobs WHERE status IN ('pending', 'processing')",
  );
  if ((outstanding?.count || 0) > 0) {
    throw new Error(`Refusing a bounded drain: ${outstanding!.count} queue job(s) already pending or processing.`);
  }

  const rows = await db.many<any>(
    `SELECT spc.tenant_id, spc.person_id, spc.search_plan_id, spc.canonical_job_id, spc.opportunity_version,
            ov.content_hash, ov.job_title, ov.company_name, ov.location, ov.employment_type, ov.raw_content,
            ov.acquisition_status, ov.acquisition_quality, ov.failure_class, ov.lifecycle_state, ov.evidence_state,
            sp.criteria_json
       FROM acquisition_ingestion_lineage l
       JOIN search_plan_candidates spc ON spc.tenant_id=l.tenant_id AND spc.person_id=l.person_id
          AND spc.canonical_job_id=l.canonical_job_id AND spc.opportunity_version=l.opportunity_version
       JOIN opportunity_versions ov ON ov.id=l.opportunity_version
       JOIN search_plans sp ON sp.id=spc.search_plan_id
      WHERE l.scrape_run_id=? AND spc.attention_decision='NOT_CANDIDATE'
        AND spc.eligibility_reason_codes_json='["LOCATION_CONTRADICTION"]'`,
    [runId],
  );

  let candidates = 0;
  let reclassified = 0;
  const queuedJobIds: string[] = [];
  const reasonCounts = new Map<string, number>();

  for (const row of rows) {
    const criteria = JSON.parse(row.criteria_json);
    const gate = evaluateAttentionGate({
      id: row.opportunity_version,
      canonicalJobId: row.canonical_job_id,
      contentHash: row.content_hash,
      jobTitle: row.job_title,
      companyName: row.company_name,
      location: row.location,
      employmentType: row.employment_type,
      rawContent: row.raw_content,
      acquisitionStatus: row.acquisition_status,
      acquisitionQuality: row.acquisition_quality,
      failureClass: row.failure_class,
      lifecycleState: row.lifecycle_state,
      evidenceState: row.evidence_state,
      createdAt: new Date().toISOString(),
    }, criteria);
    const nextCodes = JSON.stringify(gate.reasonCodes);
    await db.execute(
      `UPDATE search_plan_candidates
          SET attention_decision=?, eligibility=?, eligibility_reason_codes_json=?, location_policy=?, location_evidence=?
        WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND canonical_job_id=? AND opportunity_version=?`,
      [
        gate.decision,
        gate.eligibility,
        nextCodes,
        gate.locationPolicy ?? null,
        gate.locationEvidence ?? null,
        row.tenant_id,
        row.person_id,
        row.search_plan_id,
        row.canonical_job_id,
        row.opportunity_version,
      ],
    );
    reclassified++;
    const code = gate.reasonCodes.join(",") || "NONE";
    reasonCounts.set(`${gate.decision}/${gate.eligibility}/${code}`, (reasonCounts.get(`${gate.decision}/${gate.eligibility}/${code}`) || 0) + 1);
    if (gate.decision !== "CANDIDATE") continue;

    const context = await db.one<{ context_fingerprint: string }>(
      `SELECT aec.context_fingerprint
         FROM active_evaluation_contexts aec
         JOIN evaluation_contexts ec ON ec.context_fingerprint=aec.context_fingerprint
           AND ec.tenant_id=aec.tenant_id AND ec.person_id=aec.person_id
        WHERE aec.tenant_id=? AND aec.person_id=? AND aec.search_plan_id=?
        LIMIT 1`,
      [row.tenant_id, row.person_id, row.search_plan_id],
    );
    if (!context?.context_fingerprint) {
      throw new Error(`Active evaluation context is missing for plan ${row.search_plan_id}.`);
    }
    const id = `job_${crypto.randomUUID()}`;
    const insert = await db.execute(
      `INSERT INTO evaluation_jobs (
         id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version,
         evaluation_context_fingerprint, status, attempts, max_attempts, next_attempt_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
       DO NOTHING`,
      [id, row.tenant_id, row.person_id, row.search_plan_id, row.canonical_job_id, row.opportunity_version, context.context_fingerprint],
    );
    if (insert.rowsAffected > 0) {
      candidates++;
      queuedJobIds.push(id);
    }
  }

  const worker = new EvaluationWorker("attention_location_repair");
  const drained = await worker.drainQueue({ maxJobs: queuedJobIds.length, timeoutMs: 300_000, concurrency: 1 });
  const completion = queuedJobIds.length
    ? await db.many<{ status: string; count: number }>(
        `SELECT status, COUNT(*) AS count FROM evaluation_jobs WHERE id IN (${queuedJobIds.map(() => "?").join(",")}) GROUP BY status`,
        queuedJobIds,
      )
    : [];
  console.log(JSON.stringify({ runId, examined: rows.length, reclassified, queued: candidates, reasonCounts: Object.fromEntries(reasonCounts), drained, completion }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
