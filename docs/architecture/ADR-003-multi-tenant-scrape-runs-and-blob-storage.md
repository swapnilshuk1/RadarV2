# ADR-003 — Multi-Tenant Scrape Runs and Durable Blob Storage Architecture

- **Status**: Proposed / Approved for Design (Phase 3)
- **Date**: 2026-09-01
- **Domain**: Scraping Pipeline, Multi-Tenancy, Distributed Ingestion & Storage

---

## 1. Context & Problem Statement

Following Checkpoints A–D and Phases 1–2 of the RADAR v2 state plane remediation:
1. **Queue State is Durable**: `enrichment_jobs` and `enrichment_events` reside in Turso Cloud via `DatabaseAdapter` (Migration 030). Leases, retries, and state transitions survive worker restarts.
2. **Serving & Search Plans are Unified**: Keyset cursor pagination is consolidated behind `repos.canonicalServing`, singleflight request coalescing is process-global and scope-isolated, and candidate career intent plan activation is atomic.

However, two critical distributed-state boundaries remain bound to the local host filesystem:

### A. Scrape Run Control & Progress are Global and Filesystem-Bound (Gap 1 & Gap 3)
- Scraper launch is authenticated and RBAC-authorized (`resolveScraperAuthContext`), but subsequent operations (`getRunProgressFn`, `confirmScrapeFn`, `abortScrapeFn`, `getLatestRunFn`) read and write local JSON manifests (`.radar/artifacts/runs/<runId>/manifest.json`).
- `activeScrapeRunLock` is an in-memory, single-process mutex. One tenant's active scrape blocks every other tenant from initiating an acquisition run.
- Progress polling and cancellation do not verify whether the requesting user owns the run.

### B. Enrichment Payloads are Filesystem-Bound (Gap 2)
- While `enrichment_jobs` metadata (status, lease owner, attempt count, job hash) is durable in Turso, each record stores `snapshot_path` pointing to a local file (e.g. `.radar/artifacts/snapshots/<hash>.json`).
- If RADAR runs in ephemeral cloud containers (e.g., Render, Kubernetes) or distributed worker nodes, a worker on Node B can lease a job from Turso Cloud but cannot load the snapshot payload created on Node A.
- Directly storing raw scraped card snapshots (1–5 MB of HTML and DOM trees) inside Turso Cloud rows would cause rapid database bloat, inflate LibSQL sync traffic, and spike WAN query latency.

---

## 2. Decision 1: Durable, Tenant-Scoped `scrape_runs` in Turso Cloud

To eliminate local manifest files and enforce strict tenant ownership across all scraper control surfaces, scrape run lifecycle state will move to Turso Cloud.

### Schema Specification (`src/data/sqlite/migrations/031_scrape_runs.sql`)

```sql
-- 1. Scrape Runs Core Lifecycle Table
CREATE TABLE IF NOT EXISTS scrape_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'queued', 'initializing', 'running', 'waiting_for_confirmation',
        'stopping', 'aborted', 'completed', 'failed'
    )),
    portal_targets TEXT NOT NULL, -- JSON array: ["LinkedIn", "Naukri", "Indeed"]
    config_json TEXT NOT NULL DEFAULT '{}',
    metrics_json TEXT NOT NULL DEFAULT '{}',
    total_discovered INTEGER NOT NULL DEFAULT 0,
    total_enqueued INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (person_id) REFERENCES people(id),
    FOREIGN KEY (search_plan_id) REFERENCES search_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_tenant_person 
ON scrape_runs(tenant_id, person_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_status 
ON scrape_runs(status);

-- 2. Scrape Run Audit Events (Replaces disk journal.ndjson for UI consumption)
CREATE TABLE IF NOT EXISTS scrape_run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    portal TEXT,
    event_type TEXT NOT NULL, -- 'DISCOVERY', 'ENQUEUE', 'RATE_LIMIT', 'ERROR', 'WARN', 'INFO'
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES scrape_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scrape_run_events_run_id 
ON scrape_run_events(run_id, id ASC);
```

### Control Plane Ownership Invariants

All scraper server functions in `src/lib/intelligence/scrape-server.ts` must enforce tenant-scoped authorization:

1. **`getLatestRunFn`**:
   ```sql
   SELECT * FROM scrape_runs 
   WHERE tenant_id = :tenantId AND person_id = :personId 
   ORDER BY created_at DESC LIMIT 1
   ```
2. **`getRunProgressFn(runId)`**:
   - Queries `scrape_runs WHERE id = :runId AND tenant_id = :tenantId AND person_id = :personId`.
   - If no matching row exists, throws `TenantIsolationError("Run not found or unauthorized")`.
3. **`abortScrapeFn(runId)` & `confirmScrapeFn(runId)`**:
   - Verifies caller ownership before setting `status = 'stopping'` or `'running'`.
4. **Concurrency Model**:
   - The global `activeScrapeRunLock` is replaced with a per-scope concurrency check:
     ```sql
     SELECT id FROM scrape_runs 
     WHERE tenant_id = :tenantId AND person_id = :personId 
       AND status IN ('queued', 'initializing', 'running', 'waiting_for_confirmation')
     LIMIT 1
     ```
   - This isolates tenants: Candidate A running a scrape never blocks Candidate B.

---

## 3. Decision 2: Durable Object Storage Abstraction (`BlobStore`)

To decouple worker execution from local container filesystems without polluting Turso with multi-megabyte DOM dumps, RADAR v2 will introduce a lightweight `BlobStore` abstraction.

### Interface Definition (`src/lib/storage/blob-store.ts`)

```ts
export interface BlobMetadata {
  key: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
}

export interface BlobStore {
  /**
   * Uploads a payload buffer or string and returns its content-addressed or designated key.
   */
  put(key: string, data: Buffer | Uint8Array | string, contentType?: string): Promise<string>;

  /**
   * Retrieves the raw payload buffer. Returns null if not found.
   */
  get(key: string): Promise<Buffer | null>;

  /**
   * Checks if a blob exists without transferring its payload.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Deletes a blob by key.
   */
  delete(key: string): Promise<void>;
}
```

### Storage Backends

1. **`LocalFsBlobStore` (Development / Test Environment)**:
   - Persists blobs under `.radar/artifacts/blobs/<prefix>/<hash>.json`.
   - Used for zero-cloud local testing and CI pipelines.
2. **`S3CompatibleBlobStore` (Production / Cloud Deployment)**:
   - Uses `@aws-sdk/client-s3` (or lightweight native `fetch` over S3 REST API).
   - Fully compatible with AWS S3, Cloudflare R2, MinIO, or Google Cloud Storage (via S3 interoperability).
   - Configured via standard environment variables:
     - `BLOB_STORAGE_ENDPOINT`
     - `BLOB_STORAGE_BUCKET`
     - `BLOB_STORAGE_ACCESS_KEY_ID`
     - `BLOB_STORAGE_SECRET_ACCESS_KEY`

### Queue & Worker Integration

1. In `enrichment_jobs`:
   - Replace `snapshot_path TEXT` with `payload_key TEXT NOT NULL`.
   - Content-addressed key: `snapshots/${job_hash}.json`.
2. When the scraper acquires a detailed card:
   ```ts
   const payloadKey = `snapshots/${jobHash}.json`;
   await blobStore.put(payloadKey, JSON.stringify(detailedCard), "application/json");
   await queue.enqueue({
     jobHash,
     payloadKey, // durable reference!
     portal,
     page,
     runId,
   });
   ```
3. When `enrich.ts` leases a job from Turso Cloud:
   ```ts
   const rawPayload = await blobStore.get(job.payload_key);
   if (!rawPayload) {
     throw new Error(`Orphaned payload: Blob ${job.payload_key} missing in BlobStore`);
   }
   const detailedCard = JSON.parse(rawPayload.toString("utf-8"));
   ```
   **Invariant**: Any worker node with access to Turso Cloud and the shared `BlobStore` can process any leased job with 100% reliability, even across dynamic container restarts.

---

## 4. Decision 3: Explicit Operational Scraper Limitations (Interim Architecture)

Until the `scrape_runs` schema and `BlobStore` implementation are fully certified and deployed:

1. **Single-Instance Execution**: Live Playwright browser scraping must run as a single-instance Node process hosted on the production server (`130.210.41.232`).
2. **Local Host State Plane for Raw DOMs**: Snapshot payloads remain on the host filesystem under `.radar/artifacts/snapshots/`.
3. **Queue Lease Colocation**: The enrichment worker daemon (`EvaluationWorker` / `scripts/enrich.ts`) must run on the same host instance as the scraper process so that `snapshot_path` references remain resolvable.
4. **Tenant Isolation Boundary**: Tenant isolation is strictly enforced at:
   - Scraper launch authorization (`resolveScraperAuthContext`).
   - Active search plan compilation and atomic pointer selection (`replaceActiveSearchPlan`).
   - Evaluation contexts, candidates, and materialized evaluations (Migration 021).
   - Feed keyset queries and singleflight request coalescing (`repos.canonicalServing`).
   - Cross-tenant progress observation and abort/confirm endpoints remain single-tenant until ADR-003 migration is deployed.

---

## 5. Implementation & Rollout Phasing

When ready to implement distributed execution:
1. **Migration 031**: Deploy `scrape_runs` and `scrape_run_events` to Turso Cloud.
2. **BlobStore Implementation**: Provide `LocalFsBlobStore` and `S3CompatibleBlobStore` implementations.
3. **Worker Transition**: Migrate `enrichment_jobs` column from `snapshot_path` to `payload_key`.
4. **Targeted Invariant Contracts**:
   - `tests/persistence/cross-instance-payload-retrieval.test.ts`
   - `tests/security/scrape-run-ownership.test.ts`
5. **Certification & Deployment**: Integrate into Continuous Certification Gate (`npm run certify`) and deploy once.
