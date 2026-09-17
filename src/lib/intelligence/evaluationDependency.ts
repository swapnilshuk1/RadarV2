import type { DatabaseAdapter } from '@/data/database';

/** Complete both sides of a dependency failure in one transaction. No retries. */
export async function failEvaluationDependency(db: DatabaseAdapter, requirementId: string, reason: string): Promise<number> {
  return db.transaction(async tx => {
    const changed = await tx.execute(
      `UPDATE evaluation_requirements SET status='FAILED', blocked_reason=? WHERE id=? AND status='WAITING_ENRICHMENT'`,
      [reason, requirementId],
    );
    if (!changed.rowsAffected) return 0;
    await tx.execute(
      `UPDATE evaluation_jobs SET status=CASE WHEN status='staged_waiting_enrichment' THEN 'staged_dead_letter' ELSE 'dead_letter' END,
         last_error=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
       WHERE status IN ('waiting_enrichment','staged_waiting_enrichment') AND EXISTS (
         SELECT 1 FROM evaluation_requirements er WHERE er.id=? AND er.tenant_id=evaluation_jobs.tenant_id
           AND er.person_id=evaluation_jobs.person_id AND er.search_plan_id=evaluation_jobs.search_plan_id
           AND er.canonical_job_id=evaluation_jobs.canonical_job_id AND er.opportunity_version=evaluation_jobs.opportunity_version
           AND er.evaluation_context_fingerprint=evaluation_jobs.evaluation_context_fingerprint)`,
      [reason, requirementId],
    );
    return changed.rowsAffected;
  });
}
