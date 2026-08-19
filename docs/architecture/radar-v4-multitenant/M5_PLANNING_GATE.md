# Phase M5 — Distributed Worker Runtime & Durable Work Queue Planning Gate

## 1. System Purpose & Core Architectural Boundary

Phase M5 establishes the **Distributed Worker Runtime & Durable Work Queue** for RADAR v2 multi-tenant evaluation processing.

### The Immutable Boundary Rule (Non-Leakage Invariant)
> **M4 decides what deserves evaluation. M5 decides how evaluation work is durably scheduled, claimed, executed, retried, observed, and recovered.**

```
[ M4 SearchPlanCandidate (attention_decision = 'CANDIDATE') ]
                            │
                            ▼
     [ EvaluationContext (Immutable Snapshot Chain) ]
                            │
                            ▼
========================================================================
                     M5 DURABLE EXECUTION BOUNDARY                     
========================================================================
                            │
                            ├──► 1. Enqueue EvaluationJob (Deduplicated & Provenance-Linked)
                            ├──► 2. Atomic Worker Claim (Lease Token & Lock Safety)
                            ├──► 3. AuthContext Isolation Verification
                            ├──► 4. Execute V4 Opportunity Engine
                            ├──► 5. Error Classification (Transient Retry vs Fatal Dead-Letter)
                            └──► 6. Queue Telemetry, Observability & Health Reconciliation
```

#### Core Invariants:
1. **Zero Backward Leakage into M4**: M5 MUST NOT recalculate `canonical_job_id`, `opportunity_version`, Attention Gate decisions, or source acquisition identity.
2. **Zero Forward Leakage into V4 Policy**: M5 MUST NOT modify V4 decision policies, scoring weights, or evidence compilation algorithms.
3. **Composite Multi-Tenant Lineage Invariant**:
   - `FOREIGN KEY (person_id, tenant_id) REFERENCES people(id, tenant_id)`
   - `FOREIGN KEY (search_plan_id, tenant_id, person_id) REFERENCES search_plans(id, tenant_id, person_id)`
4. **M4 Candidate Provenance Invariant**:
   - `FOREIGN KEY (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version) REFERENCES search_plan_candidates(...)`
5. **Canonical Acquisition Version Invariant**:
   - `FOREIGN KEY (canonical_job_id, opportunity_version) REFERENCES opportunity_versions(canonical_job_id, id)`
6. **Lease Token & Stale Worker Protection**:
   - Claims MUST generate a unique `lease_token`. Completions and state transitions MUST check `WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`.
7. **Durable Retry Scheduling**:
   - Retries MUST set `next_attempt_at = datetime('now', '+X seconds')`. Retry state remains durable across worker process crashes.
8. **AuthContext Boundary Check**:
   - If worker `AuthContext` does not match job `tenant_id` / `person_id`, execution is rejected before invoking the V4 Evaluation Engine.

---

## 2. Certified Queue Domain Schema (`021_evaluation_work_queue.sql`)

```sql
-- Phase M5: Durable Evaluation Work Queue

CREATE TABLE IF NOT EXISTS evaluation_jobs (
    id TEXT PRIMARY KEY,

    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,

    canonical_job_id TEXT NOT NULL,
    opportunity_version TEXT NOT NULL,
    evaluation_context_fingerprint TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed, dead_letter

    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,

    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    last_error TEXT,

    locked_by TEXT,
    lease_token TEXT,
    locked_at DATETIME,

    completed_at DATETIME,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Composite Tenant / Person Lineage Invariant
    FOREIGN KEY (person_id, tenant_id)
        REFERENCES people(id, tenant_id),

    -- Composite Tenant / Person / SearchPlan Lineage Invariant
    FOREIGN KEY (search_plan_id, tenant_id, person_id)
        REFERENCES search_plans(id, tenant_id, person_id)
        ON DELETE CASCADE,

    -- Composite Canonical Job / Version Lineage Invariant
    FOREIGN KEY (canonical_job_id, opportunity_version)
        REFERENCES opportunity_versions(canonical_job_id, id),

    -- Provenance Invariant: Every EvaluationJob MUST correspond to a valid SearchPlanCandidate
    FOREIGN KEY (
        tenant_id,
        person_id,
        search_plan_id,
        canonical_job_id,
        opportunity_version
    )
        REFERENCES search_plan_candidates(
            tenant_id,
            person_id,
            search_plan_id,
            canonical_job_id,
            opportunity_version
        ),

    -- Deduplication & Context Version Identity
    CONSTRAINT unq_eval_job_context UNIQUE (
        tenant_id,
        search_plan_id,
        canonical_job_id,
        opportunity_version,
        evaluation_context_fingerprint
    )
);

CREATE INDEX IF NOT EXISTS idx_eval_jobs_status_next_attempt 
    ON evaluation_jobs(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_eval_jobs_claim_lease 
    ON evaluation_jobs(status, locked_at);
```

---

## 3. Sub-Phase Breakdown & Operational Contracts

### **M5.1 — Evaluation Queue Schema & Repository Layer**
- **Artifacts**: `src/data/sqlite/migrations/021_evaluation_work_queue.sql`, repository methods in `StorageProvider`.
- **Invariants**: Enforces 4-layer composite foreign keys (people, search_plans, opportunity_versions, search_plan_candidates). Rejects orphan cross-tenant records.

### **M5.2 — Work Enqueuer & Idempotent Projection Sync (`enqueueEvaluationJobs.ts`)**
- **Artifacts**: `src/lib/intelligence/enqueueEvaluationJobs.ts`.
- **Invariants**: Consumes `SearchPlanCandidate` records where `attention_decision = CANDIDATE` and immutable `EvaluationContext`. Idempotent enqueuing under `unq_eval_job_context`. Zero enqueuing for `NOT_CANDIDATE`.

### **M5.3 — Distributed Worker Lease & Lock Manager (`EvaluationWorker.ts`)**
- **Artifacts**: `src/lib/intelligence/EvaluationWorker.ts`.
- **Invariants**: Atomic claim query:
  ```sql
  UPDATE evaluation_jobs 
  SET status = 'processing', locked_by = ?, lease_token = ?, locked_at = CURRENT_TIMESTAMP
  WHERE id IN (
      SELECT id FROM evaluation_jobs 
      WHERE (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP)
         OR (status = 'processing' AND locked_at <= datetime('now', '-300 seconds'))
      ORDER BY next_attempt_at ASC 
      LIMIT 1
  ) RETURNING *;
  ```
  Completion updates MUST check `WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`. Prevents stale workers from overriding reclaimed leases.

### **M5.4 — Durable Execution, Error Classification & Retry Engine**
- **Artifacts**: Error classifier in `EvaluationWorker.ts`.
- **Error Classification**:
  - `TRANSIENT` (DB deadlock, network timeout, rate limit) ➔ increment `attempts`, calculate exponential backoff (`next_attempt_at = now + 2^attempts * 5s`), set `status = 'pending'`.
  - `FATAL` (malformed evaluation context, FK lineage violation, contract breach) OR `attempts >= max_attempts` ➔ set `status = 'dead_letter'`.
- **Invariants**: Worker host process never crashes on job exceptions.

### **M5.5 — Observability, Telemetry & Integration Suite**
- **Artifacts**: `scripts/m5-queue-telemetry.ts`, `tests/intelligence/m5-queue.test.ts`.
- **Metrics**: Queue depth, pending count, processing count, retrying count, dead-letter count, lease-expiry recovery count, tenant-scoped metrics.

---

## 4. Exit Verification Matrix

### M5.1 Exit Criteria
- [x] Schema migration `021_evaluation_work_queue.sql` strictly additive.
- [x] Enforces composite tenant/person lineage (`FOREIGN KEY (person_id, tenant_id)`).
- [x] Enforces composite candidate provenance (`FOREIGN KEY (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)`).
- [x] Invalid cross-tenant records rejected at DB constraint layer.

### M5.2 Exit Criteria
- [x] Only `CANDIDATE` projections enqueue (`NOT_CANDIDATE` never enqueues).
- [x] Same context + same version ➔ single job (idempotent).
- [x] Changed version or changed context ➔ new job.

### M5.3 Exit Criteria
- [x] Multi-worker claim atomicity (Worker A claims job; Worker B cannot claim simultaneously).
- [x] Expired lease reclaimed automatically after timeout.
- [x] Fresh lease protected from stolen claim.
- [x] Stale worker cannot complete a job after its lease has been reclaimed (`lease_token` check).
- [x] `AuthContext` mismatch rejects execution before invoking V4 engine.

### M5.4 Exit Criteria
- [x] Successful execution ➔ `completed`.
- [x] Transient error ➔ `pending` with durable `next_attempt_at` exponential backoff.
- [x] Exhausted retries (>= 3) or fatal error ➔ `dead_letter`.
- [x] Exception does not terminate worker host loop.

### M5.5 Exit Criteria
- [x] Telemetry reports queue depth, pending age, processing, retrying, and dead-letter totals.
- [x] Full test suite (617+ tests), EQE certification harness, `npx tsc --noEmit`, and `npm run build` pass 100% clean.
