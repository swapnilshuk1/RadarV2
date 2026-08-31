# Autonomous Pipeline Certification — Experiment 2 Defect Analysis

## 1. Proven Exact Failing SQL & Constraints

The exact statement producing the `ON CONFLICT clause does not match` error is the `INSERT INTO materialized_evaluations` statement located in `src/lib/intelligence/EvaluationWorker.ts`:

- **File**: `src/lib/intelligence/EvaluationWorker.ts`
- **Function**: `EvaluationWorker.processJob` (both the sparse/bypassed path and the evaluated path)
- **Table**: `materialized_evaluations`
- **SQL**:
  ```sql
  INSERT INTO materialized_evaluations (
    id, tenant_id, person_id, canonical_job_id, opportunity_version,
    evaluation_context_fingerprint, evaluation_state, decision, quality_score,
    rationale, evidence_ids, evaluation_json, materialized_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint) 
  DO UPDATE SET ...
  ```
- **ON CONFLICT target**: `(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)`
- **Expected unique constraint**: `(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)`
- **Actual unique constraint in Turso**: `sqlite_autoindex_materialized_evaluations_2: tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint`
- **Exact failure**: `SQLITE_UNKNOWN: SQLite error: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`

### The Causal Chain (The Root Cause)
As demonstrated above, the code in the local repository exactly matches the unique constraint in the Turso database. **The code is structurally sound.**

The failure occurred because of a distributed race condition involving the **Oracle Cloud Server**:
1. During Experiment 1's preparation, the previous agent successfully ran `db:reset-corpus`, which applied the new database schema (including `tenant_id` and `person_id` constraints) to the live Turso Cloud database.
2. The agent updated the local code in `EvaluationWorker.ts` to match this schema.
3. However, the agent **never deployed** the updated code to the live Oracle Server.
4. The live Oracle Server is continuously running `EvaluationDaemon`, polling the `evaluation_jobs` queue on Turso Cloud every 2 seconds.
5. When Experiment 2 (Naukri) ran locally, it enqueued 114 evaluation jobs to Turso Cloud.
6. Before the local script could process these jobs in its own `drainQueue` step, the Oracle Server picked them up. The Oracle Server attempted to execute the **old, un-migrated code** against the **newly migrated database**, triggering the `ON CONFLICT clause does not match` error on every job, exhausting their retries, and permanently stranding them as `dead_letter`.

### Why Did Experiment 1 Succeed?
Experiment 1 succeeded because LinkedIn scraping was extremely fast (only 1 page). The local `scrape.ts` script completed its run and immediately called its local `EvaluationWorker.drainQueue()`. Because the local code was correct, it successfully processed and completed all 125 jobs *before* the Oracle Server had time to exhaust their retries and move them to `dead_letter`.
Naukri (Experiment 2), however, takes several minutes to process, giving the Oracle Server plenty of time to fail the jobs before the local script finishes.

---

## 2. Queue-Drain Infinite Loop

My previous diagnosis regarding the infinite loop was partially conflated. The `[Enrich] Active jobs in retry cooling-down. Sleeping for 5000ms...` log was entirely unrelated to the `evaluation_jobs` table.

That loop occurred inside `scripts/enrich.ts` (the HTTP/LLM enrichment queue), which encountered network failures from Naukri and applied a 240-second retry cooldown. The script was waiting correctly on enrichment retries, not evaluation jobs.

The actual `EvaluationWorker.drainQueue()` (added by the previous agent) correctly aborts if the queue is empty or if all remaining jobs are terminally failed (`dead_letter`), avoiding an infinite loop.

---

## 3. One-Job Verification

I have successfully run a targeted regression test for one of the failed Experiment 2 jobs (`job_bc11c995-278f-43ac-9ccb-45a48e42115d`).
By manually restoring its status to `processing` and passing it through the local `EvaluationWorker.ts`, it successfully processed without any schema or Foreign Key errors, producing a `decision: 'PASS'`.

## 4. Minimum Required Fix

1. **Deploy to Oracle**: Run `npm run deploy` to synchronize the Oracle Cloud Server with the updated codebase, neutralizing the outdated daemon.
2. **Requeue Stranded Jobs**: Run a targeted SQL `UPDATE` statement to return the 114 `dead_letter` jobs back to `pending` with `attempts = 0`.
3. **Drain the Queue Locally**: Re-run the local evaluation worker to securely process the rest of Experiment 2's dataset.
