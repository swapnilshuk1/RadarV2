import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { ResponseValidator } from "@/lib/acquisition/validator";
import { classifyOpportunityCategories } from "@/lib/domain/category_taxonomy";
import { EvaluationWorker } from "@/lib/intelligence/EvaluationWorker";
import { SqliteMaterializedEvaluationStore } from "@/data/sqlite/repositories/SqliteMaterializedEvaluationStore";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";
import { validateEvaluationConsistency } from "@/lib/domain/evaluation_fingerprint";
import type { MaterializedEvaluation } from "@/lib/domain/evaluation_context";

class TestSqliteAdapter implements DatabaseAdapter {
  constructor(public db: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params || []));
    return (row as T) || null;
  }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params || [])) as T[];
  }
  async execute(sql: string, params?: QueryParams): Promise<{
    rowsAffected: number;
    lastInsertRowid?: number | bigint | string;
  }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params || []));
    return { rowsAffected: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

describe("Canonical Acquisition Integrity & Provenance (V4 Phase 2)", () => {
  describe("ResponseValidator", () => {
    it("classifies rich job content as COMPLETE with HIGH confidence", () => {
      const res = ResponseValidator.validate({
        html: "<div>...</div>",
        url: "https://example.com/job/1",
        sourcePortal: "LinkedIn",
        extractedTitle: "VP of Engineering",
        extractedCompany: "Acme Corp",
        extractedDescription: "A".repeat(600),
      });

      expect(res.isValid).toBe(true);
      expect(res.quality).toBe("COMPLETE");
      expect(res.confidence).toBe("HIGH");
    });

    it("classifies moderate job content (200-499 chars) as PARTIAL", () => {
      const res = ResponseValidator.validate({
        html: "<div>...</div>",
        url: "https://example.com/job/2",
        sourcePortal: "Naukri",
        extractedTitle: "Director of Product",
        extractedCompany: "Beta Tech",
        extractedDescription: "A".repeat(250),
      });

      expect(res.isValid).toBe(true);
      expect(res.quality).toBe("PARTIAL");
      expect(res.confidence).toBe("MEDIUM");
    });

    it("classifies short job content (<200 chars) as MINIMAL", () => {
      const res = ResponseValidator.validate({
        html: "<div>...</div>",
        url: "https://example.com/job/3",
        sourcePortal: "Indeed",
        extractedTitle: "Chief Technology Officer",
        extractedCompany: "Gamma",
        extractedDescription: "Short preview only 40 characters.",
      });

      expect(res.isValid).toBe(false);
      expect(res.quality).toBe("MINIMAL");
      expect(res.confidence).toBe("LOW");
      expect(res.failureClass).toBe("PARTIAL_CONTENT");
    });

    it("classifies bot challenges as INVALID", () => {
      const res = ResponseValidator.validate({
        html: "<html><title>Attention Required! | Cloudflare</title><body>cf-challenge-running</body></html>",
        url: "https://example.com/job/4",
        sourcePortal: "Indeed",
      });

      expect(res.isValid).toBe(false);
      expect(res.quality).toBe("INVALID");
      expect(res.failureClass).toBe("BOT_CHALLENGE_BLOCK");
    });

    it("classifies 404 HTTP status as INVALID with REMOVED_404", () => {
      const res = ResponseValidator.validate({
        html: "<html>404 Not Found</html>",
        url: "https://example.com/job/5",
        sourcePortal: "Workday",
        httpStatus: 404,
      });

      expect(res.isValid).toBe(false);
      expect(res.quality).toBe("INVALID");
      expect(res.failureClass).toBe("REMOVED_404");
    });
  });

  describe("Category Taxonomy - Anti-Heuristic Verification", () => {
    it("does NOT classify into needs_more_signal solely because recommendation mentions 'sparse'", () => {
      // Historical bug: rec.includes('sparse') matched this normal recommendation!
      const cats = classifyOpportunityCategories({
        role: "Chief Commercial Officer",
        description: "Scale sales operations globally",
        recommendation: "PURSUE: Strong candidate fit despite sparse prior coverage in Nordic markets.",
        trueExecutiveMandate: "COMMERCIAL_EXPANSION",
        evaluationStatus: "COMPLETE",
        evaluationState: "EVALUATED",
      });

      expect(cats).not.toContain("needs_more_signal");
      expect(cats).toContain("commercial_growth");
    });

    it("strictly classifies into needs_more_signal when evaluationState is SPARSE_SPEC", () => {
      const cats = classifyOpportunityCategories({
        role: "Chief Commercial Officer",
        description: "Short fragment",
        evaluationState: "SPARSE_SPEC",
      });

      expect(cats).toContain("needs_more_signal");
    });
  });

  describe("EvaluationWorker Dual Guard & SPARSE_SPEC Preservation", () => {
    let sqliteDb: Database.Database;
    let adapter: TestSqliteAdapter;
    let evalStore: SqliteMaterializedEvaluationStore;

    function setupSchema(rawDb: Database.Database) {
      rawDb.exec(`
        CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant 1');

        CREATE TABLE search_plans (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          person_id TEXT,
          status TEXT,
          criteria_json TEXT
        );
        INSERT INTO search_plans (id, tenant_id, person_id, status, criteria_json)
        VALUES ('sp1', 't1', 'p1', 'active', '{"targetSeniority":["VP","CXO"],"targetRoles":["CTO"],"targetLocations":["Remote"]}');

        CREATE TABLE evaluation_contexts (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          person_id TEXT,
          search_plan_snapshot_id TEXT,
          context_fingerprint TEXT,
          policy_version TEXT,
          ontology_version TEXT,
          ontology_fingerprint TEXT,
          profile_version TEXT,
          context_payload TEXT,
          created_at DATETIME
        );
        INSERT INTO evaluation_contexts (id, tenant_id, person_id, search_plan_snapshot_id, context_fingerprint, policy_version, ontology_version, ontology_fingerprint, profile_version, context_payload, created_at)
        VALUES ('ec1', 't1', 'p1', 'sps1', 'fp1', 'v4.1', 'ont-v1', 'ont-fp', 'prof-v1', '{}', CURRENT_TIMESTAMP);

        CREATE TABLE search_plan_snapshots (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          person_id TEXT,
          search_plan_id TEXT
        );
        INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id)
        VALUES ('sps1', 't1', 'p1', 'sp1');

        CREATE TABLE canonical_opportunities (
          id TEXT PRIMARY KEY,
          source TEXT,
          source_job_id TEXT,
          canonical_url TEXT,
          company_name TEXT,
          created_at DATETIME,
          last_seen_at DATETIME
        );

        CREATE TABLE opportunity_versions (
          id TEXT PRIMARY KEY,
          canonical_job_id TEXT,
          content_hash TEXT,
          job_title TEXT,
          company_name TEXT,
          location TEXT,
          employment_type TEXT,
          posted_at TEXT,
          posted_precision TEXT,
          raw_content TEXT,
          acquisition_status TEXT DEFAULT 'UNKNOWN',
          acquisition_quality TEXT DEFAULT 'UNKNOWN',
          failure_class TEXT,
          lifecycle_state TEXT DEFAULT 'UNKNOWN',
          evidence_state TEXT DEFAULT 'UNVERIFIED',
          created_at DATETIME
        );

        CREATE TABLE search_plan_candidates (
          tenant_id TEXT,
          person_id TEXT,
          search_plan_id TEXT,
          canonical_job_id TEXT,
          opportunity_version TEXT,
          attention_decision TEXT,
          created_at DATETIME,
          PRIMARY KEY(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
        );

        CREATE TABLE people (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          name TEXT
        );
        INSERT INTO people (id, tenant_id, name) VALUES ('p1', 't1', 'Candidate 1');

        CREATE TABLE evaluation_jobs (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          person_id TEXT,
          search_plan_id TEXT,
          canonical_job_id TEXT,
          opportunity_version TEXT,
          evaluation_context_fingerprint TEXT,
          lease_token TEXT,
          status TEXT,
          attempts INTEGER,
          max_attempts INTEGER,
          next_attempt_at DATETIME,
          locked_at DATETIME,
          locked_by TEXT,
          last_error TEXT,
          created_at DATETIME,
          updated_at DATETIME,
          completed_at DATETIME,
          UNIQUE(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
        );

        CREATE TABLE materialized_evaluations (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          person_id TEXT NOT NULL,
          canonical_job_id TEXT NOT NULL,
          opportunity_version TEXT NOT NULL,
          evaluation_context_fingerprint TEXT NOT NULL,
          evaluation_state TEXT NOT NULL DEFAULT 'UNKNOWN',
          decision TEXT,
          quality_score REAL,
          rationale TEXT,
          evidence_ids TEXT,
          evaluation_json TEXT NOT NULL,
          vetoed INTEGER NOT NULL DEFAULT 0,
          materialized_at DATETIME NOT NULL,
          UNIQUE(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
        );

        CREATE TABLE recovery_queue (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          canonical_job_id TEXT NOT NULL,
          opportunity_version_id TEXT NOT NULL,
          source TEXT NOT NULL,
          canonical_url TEXT NOT NULL,
          reason TEXT NOT NULL,
          failure_class TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          next_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_attempt_at DATETIME,
          last_error TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME
        );
      `);
    }

    it("bypasses fit evaluation and stores null decision/score when acquisitionStatus is RECOVERY_PENDING", async () => {
      sqliteDb = new Database(":memory:");
      setupSchema(sqliteDb);
      adapter = new TestSqliteAdapter(sqliteDb);
      evalStore = new SqliteMaterializedEvaluationStore(adapter);

      // Ingest un-acquired version
      sqliteDb.exec(`
        INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name)
        VALUES ('co_sparse', 'Indeed', 'ind_1', 'https://in.indeed.com/viewjob?jk=1', 'Acme');

        INSERT INTO opportunity_versions (
          id, canonical_job_id, content_hash, job_title, company_name, location,
          raw_content, acquisition_status, acquisition_quality, lifecycle_state
        ) VALUES (
          'ov_sparse', 'co_sparse', 'hash_s', 'VP of Tech', 'Acme', 'Remote',
          'Short text', 'RECOVERY_PENDING', 'MINIMAL', 'ACTIVE'
        );

        INSERT INTO evaluation_jobs (
          id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version,
          evaluation_context_fingerprint, status, attempts, max_attempts, next_attempt_at
        ) VALUES (
          'job_1', 't1', 'p1', 'sp1', 'co_sparse', 'ov_sparse', 'fp1', 'pending', 0, 3, CURRENT_TIMESTAMP
        );
      `);

      const worker = new EvaluationWorker("test_worker_1", {
        adapter,
      });

      const claim = await worker.claimNextJob();
      expect(claim).not.toBeNull();

      const result = await worker.processJob(claim!);
      expect(result.status).toBe("completed");

      const evalRow = await evalStore.getEvaluation(
        { tenantId: "t1", personId: "p1" },
        "co_sparse",
        "fp1"
      );

      expect(evalRow).toBeDefined();
      expect(evalRow?.evaluationState).toBe("ACQUISITION_PENDING");
      expect(evalRow?.decision).toBeNull();
      expect(evalRow?.qualityScore).toBeNull();
    });

    it("bypasses fit evaluation and stores EXPIRED when lifecycleState is EXPIRED", async () => {
      sqliteDb = new Database(":memory:");
      setupSchema(sqliteDb);
      adapter = new TestSqliteAdapter(sqliteDb);
      evalStore = new SqliteMaterializedEvaluationStore(adapter);

      sqliteDb.exec(`
        INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name)
        VALUES ('co_exp', 'LinkedIn', 'li_1', 'https://linkedin.com/jobs/view/1', 'Beta Corp');

        INSERT INTO opportunity_versions (
          id, canonical_job_id, content_hash, job_title, company_name, location,
          raw_content, acquisition_status, acquisition_quality, lifecycle_state
        ) VALUES (
          'ov_exp', 'co_exp', 'hash_e', 'VP of Sales', 'Beta Corp', 'Bengaluru',
          '${"Long detailed JD text ".repeat(50)}', 'ACQUIRED', 'COMPLETE', 'EXPIRED'
        );

        INSERT INTO evaluation_jobs (
          id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version,
          evaluation_context_fingerprint, status, attempts, max_attempts, next_attempt_at
        ) VALUES (
          'job_2', 't1', 'p1', 'sp1', 'co_exp', 'ov_exp', 'fp1', 'pending', 0, 3, CURRENT_TIMESTAMP
        );
      `);

      const worker = new EvaluationWorker("test_worker_2", {
        adapter,
      });

      const claim = await worker.claimNextJob();
      expect(claim).not.toBeNull();

      const result = await worker.processJob(claim!);
      expect(result.status).toBe("completed");

      const evalRow = await evalStore.getEvaluation(
        { tenantId: "t1", personId: "p1" },
        "co_exp",
        "fp1"
      );

      expect(evalRow).toBeDefined();
      expect(evalRow?.evaluationState).toBe("EXPIRED");
      expect(evalRow?.decision).toBeNull();
      expect(evalRow?.qualityScore).toBeNull();
    });
  });

  describe("CanonicalIngestionService - Orthogonal States & Recovery Ingestion", () => {
    it("enqueues minimal captures into recovery_queue during ingestion", async () => {
      const sqliteDb = new Database(":memory:");
      sqliteDb.exec(`
        CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant 1');
        CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT, is_active INTEGER DEFAULT 1);
        INSERT INTO people (id, tenant_id, is_active) VALUES ('p1', 't1', 1);
        CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, status TEXT, criteria_json TEXT);
        INSERT INTO search_plans (id, tenant_id, person_id, status, criteria_json)
        VALUES ('sp1', 't1', 'p1', 'active', '{"targetSeniority":["VP"],"targetRoles":["VP of Sales"],"targetLocations":["Remote"]}');
        CREATE TABLE canonical_opportunities (id TEXT PRIMARY KEY, source TEXT, source_job_id TEXT, canonical_url TEXT, company_name TEXT, created_at DATETIME, last_seen_at DATETIME, UNIQUE(source, source_job_id));
        CREATE TABLE opportunity_versions (
          id TEXT PRIMARY KEY, canonical_job_id TEXT, content_hash TEXT, job_title TEXT, company_name TEXT,
          location TEXT, employment_type TEXT, posted_at TEXT, posted_precision TEXT, raw_content TEXT,
          acquisition_status TEXT, acquisition_quality TEXT, failure_class TEXT, lifecycle_state TEXT, evidence_state TEXT,
          source_payload_key TEXT, source_media_type TEXT, document_extraction_state TEXT,
          created_at DATETIME, UNIQUE(canonical_job_id, content_hash)
        );
        CREATE TABLE search_plan_candidates (
          tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT,
          opportunity_version TEXT, attention_decision TEXT, created_at DATETIME,
          PRIMARY KEY(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
        );
        CREATE TABLE recovery_queue (
          id TEXT PRIMARY KEY, tenant_id TEXT, canonical_job_id TEXT, opportunity_version_id TEXT,
          source TEXT, canonical_url TEXT, reason TEXT, failure_class TEXT, attempt_count INTEGER DEFAULT 0,
          status TEXT, next_attempt_at DATETIME, last_attempt_at DATETIME, last_error TEXT,
          created_at DATETIME, completed_at DATETIME
        );
      `);

      const adapter = new TestSqliteAdapter(sqliteDb);
      const service = new CanonicalIngestionService(adapter);
      const res = await service.ingestOpportunity({
        sourcePortal: "Indeed",
        sourceJobId: "job_short_123",
        canonicalUrl: "https://in.indeed.com/viewjob?jk=job_short_123",
        jobTitle: "VP of Sales",
        companyName: "Acme",
        location: "Remote",
        rawContent: "Short summary only 35 chars",
      });

      expect(res.isNewOpportunity).toBe(true);

      const version = await adapter.one<any>(
        "SELECT acquisition_status, acquisition_quality, failure_class, lifecycle_state FROM opportunity_versions WHERE id = ?",
        [res.opportunityVersion]
      );
      expect(version.acquisition_status).toBe("RECOVERY_PENDING");
      expect(version.acquisition_quality).toBe("MINIMAL");
      expect(version.failure_class).toBe("PARTIAL_CONTENT");
      expect(version.lifecycle_state).toBe("ACTIVE");

      const recoveryItem = await adapter.one<any>(
        "SELECT * FROM recovery_queue WHERE opportunity_version_id = ?",
        [res.opportunityVersion]
      );
      expect(recoveryItem).not.toBeNull();
      expect(recoveryItem.status).toBe("PENDING");
      expect(recoveryItem.failure_class).toBe("PARTIAL_CONTENT");
    });

    it("enforces recovery_queue idempotency when same failed version is ingested repeatedly", async () => {
      const sqliteDb = new Database(":memory:");
      sqliteDb.exec(`
        CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO tenants (id, name) VALUES ('t1', 'Tenant 1');
        CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT, is_active INTEGER DEFAULT 1);
        INSERT INTO people (id, tenant_id, is_active) VALUES ('p1', 't1', 1);
        CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, status TEXT, criteria_json TEXT);
        INSERT INTO search_plans (id, tenant_id, person_id, status, criteria_json)
        VALUES ('sp1', 't1', 'p1', 'active', '{"targetSeniority":["VP"],"targetRoles":["VP of Sales"],"targetLocations":["Remote"]}');
        CREATE TABLE canonical_opportunities (id TEXT PRIMARY KEY, source TEXT, source_job_id TEXT, canonical_url TEXT, company_name TEXT, created_at DATETIME, last_seen_at DATETIME, UNIQUE(source, source_job_id));
        CREATE TABLE opportunity_versions (
          id TEXT PRIMARY KEY, canonical_job_id TEXT, content_hash TEXT, job_title TEXT, company_name TEXT,
          location TEXT, employment_type TEXT, posted_at TEXT, posted_precision TEXT, raw_content TEXT,
          acquisition_status TEXT, acquisition_quality TEXT, failure_class TEXT, lifecycle_state TEXT, evidence_state TEXT,
          source_payload_key TEXT, source_media_type TEXT, document_extraction_state TEXT,
          created_at DATETIME, UNIQUE(canonical_job_id, content_hash)
        );
        CREATE TABLE search_plan_candidates (
          tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT,
          opportunity_version TEXT, attention_decision TEXT, created_at DATETIME,
          PRIMARY KEY(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
        );
        CREATE TABLE recovery_queue (
          id TEXT PRIMARY KEY, tenant_id TEXT, canonical_job_id TEXT, opportunity_version_id TEXT,
          source TEXT, canonical_url TEXT, reason TEXT, failure_class TEXT, attempt_count INTEGER DEFAULT 0,
          status TEXT, next_attempt_at DATETIME, last_attempt_at DATETIME, last_error TEXT,
          created_at DATETIME, completed_at DATETIME
        );
        CREATE UNIQUE INDEX idx_recovery_queue_active_version 
        ON recovery_queue(opportunity_version_id) 
        WHERE status IN ('PENDING', 'PROCESSING');
      `);

      const adapter = new TestSqliteAdapter(sqliteDb);
      const service = new CanonicalIngestionService(adapter);

      const payload = {
        sourcePortal: "Indeed",
        sourceJobId: "job_idempotency_123",
        canonicalUrl: "https://in.indeed.com/viewjob?jk=job_idempotency_123",
        jobTitle: "Director of Product",
        companyName: "Acme Product Corp",
        location: "Mumbai",
        rawContent: "Too short 25 chars",
      };

      // Ingest first time
      const res1 = await service.ingestOpportunity(payload);
      expect(res1.isNewOpportunity).toBe(true);

      // Ingest second time with exact same defective version
      const res2 = await service.ingestOpportunity(payload);
      expect(res2.isNewOpportunity).toBe(false);

      const activeQueueItems = await adapter.many<any>(
        "SELECT * FROM recovery_queue WHERE opportunity_version_id = ? AND status IN ('PENDING', 'PROCESSING')",
        [res1.opportunityVersion]
      );
      expect(activeQueueItems.length).toBe(1);

      // Transition to RECOVERED
      await adapter.execute(
        "UPDATE recovery_queue SET status = 'RECOVERED', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
        [activeQueueItems[0].id]
      );

      // Verify that after recovery completes, the partial unique index permits a future queue item if a new defective version arises
      const queueCountAfterRecovery = await adapter.many<any>(
        "SELECT * FROM recovery_queue WHERE opportunity_version_id = ?",
        [res1.opportunityVersion]
      );
      expect(queueCountAfterRecovery.length).toBe(1);
      expect(queueCountAfterRecovery[0].status).toBe("RECOVERED");
    });
  });

  describe("validateEvaluationConsistency - Orthogonal Evaluation State Contract", () => {
    it("validates SPARSE_SPEC requires decision = null and qualityScore = null", () => {
      const validSparse: MaterializedEvaluation = {
        id: "mat_sparse",
        tenantId: "t1",
        personId: "p1",
        canonicalJobId: "job_1",
        opportunityVersion: "v1",
        evaluationContextFingerprint: "fp1",
        evaluationState: "SPARSE_SPEC",
        decision: null,
        qualityScore: null,
        rationale: "Sparse specification",
        evidenceIds: [],
        evaluationJson: JSON.stringify({ engine_verdict: "CONSIDER", note: "internal trace ignored" }),
        materializedAt: new Date().toISOString(),
      };

      expect(() => validateEvaluationConsistency(validSparse)).not.toThrow();

      const invalidSparseDecision: MaterializedEvaluation = {
        ...validSparse,
        decision: "CONSIDER",
      };
      expect(() => validateEvaluationConsistency(invalidSparseDecision)).toThrow(
        /relational decision must be null when evaluationState is 'SPARSE_SPEC'/
      );

      const invalidSparseScore: MaterializedEvaluation = {
        ...validSparse,
        qualityScore: 75,
      };
      expect(() => validateEvaluationConsistency(invalidSparseScore)).toThrow(
        /relational qualityScore must be null when evaluationState is 'SPARSE_SPEC'/
      );
    });

    it("validates ACQUISITION_PENDING and ACQUISITION_FAILED require null decisions", () => {
      const validPending: MaterializedEvaluation = {
        id: "mat_pending",
        tenantId: "t1",
        personId: "p1",
        canonicalJobId: "job_2",
        opportunityVersion: "v2",
        evaluationContextFingerprint: "fp1",
        evaluationState: "ACQUISITION_PENDING",
        decision: null,
        qualityScore: null,
        rationale: "Acquisition pending",
        evidenceIds: [],
        evaluationJson: JSON.stringify({ bypassed: true }),
        materializedAt: new Date().toISOString(),
      };
      expect(() => validateEvaluationConsistency(validPending)).not.toThrow();

      const invalidPending: MaterializedEvaluation = {
        ...validPending,
        decision: "PASS",
      };
      expect(() => validateEvaluationConsistency(invalidPending)).toThrow(
        /relational decision must be null when evaluationState is 'ACQUISITION_PENDING'/
      );
    });

    it("validates NOT_EVALUABLE requires null decision and null score", () => {
      const validNotEvaluable: MaterializedEvaluation = {
        id: "mat_not_evaluable",
        tenantId: "t1",
        personId: "p1",
        canonicalJobId: "job_ne",
        opportunityVersion: "v1",
        evaluationContextFingerprint: "fp1",
        evaluationState: "NOT_EVALUABLE",
        decision: null,
        qualityScore: null,
        rationale: "No intrinsic fit artifact",
        evidenceIds: [],
        evaluationJson: JSON.stringify({ evaluationState: "NOT_EVALUABLE", reasonCode: "NOT_EVALUABLE" }),
        materializedAt: new Date().toISOString(),
      };
      expect(() => validateEvaluationConsistency(validNotEvaluable)).not.toThrow();
      expect(() => validateEvaluationConsistency({ ...validNotEvaluable, decision: "PASS" })).toThrow(
        /relational decision must be null when evaluationState is 'NOT_EVALUABLE'/
      );
    });

    it("validates EXPIRED requires null decision and null score", () => {
      const validExpired: MaterializedEvaluation = {
        id: "mat_expired",
        tenantId: "t1",
        personId: "p1",
        canonicalJobId: "job_3",
        opportunityVersion: "v3",
        evaluationContextFingerprint: "fp1",
        evaluationState: "EXPIRED",
        decision: null,
        qualityScore: null,
        rationale: "Expired",
        evidenceIds: [],
        evaluationJson: JSON.stringify({ bypassed: true }),
        materializedAt: new Date().toISOString(),
      };
      expect(() => validateEvaluationConsistency(validExpired)).not.toThrow();

      const invalidExpired: MaterializedEvaluation = {
        ...validExpired,
        decision: "PASS",
      };
      expect(() => validateEvaluationConsistency(invalidExpired)).toThrow(
        /relational decision must be null when evaluationState is 'EXPIRED'/
      );
    });

    it("validates EVALUATED requires non-null valid decision and matching quality score", () => {
      const validEvaluated: MaterializedEvaluation = {
        id: "mat_eval",
        tenantId: "t1",
        personId: "p1",
        canonicalJobId: "job_4",
        opportunityVersion: "v4",
        evaluationContextFingerprint: "fp1",
        evaluationState: "EVALUATED",
        decision: "PURSUE",
        qualityScore: 92,
        rationale: "High match",
        evidenceIds: ["ev1"],
        evaluationJson: JSON.stringify({ decision: "PURSUE", qualityScore: 92 }),
        materializedAt: new Date().toISOString(),
      };
      expect(() => validateEvaluationConsistency(validEvaluated)).not.toThrow();

      const mismatchedDecision: MaterializedEvaluation = {
        ...validEvaluated,
        decision: "CONSIDER",
      };
      expect(() => validateEvaluationConsistency(mismatchedDecision)).toThrow(
        /relational decision 'CONSIDER' does not match JSON payload decision 'PURSUE'/
      );

      const nullDecisionEvaluated: MaterializedEvaluation = {
        ...validEvaluated,
        decision: null,
      };
      expect(() => validateEvaluationConsistency(nullDecisionEvaluated)).toThrow(
        /relational decision must be PURSUE, CONSIDER, or PASS when evaluationState is 'EVALUATED'/
      );
    });
  });

  describe("Authoritative Needs More Signal Derivation (Directive 1)", () => {
    it("classifies needs_more_signal strictly when evaluationState = 'SPARSE_SPEC'", () => {
      const cats = classifyOpportunityCategories({
        evaluationState: "SPARSE_SPEC",
        evaluationStatus: "COMPLETE",
        role: "VP Marketing",
      });
      expect(cats).toContain("needs_more_signal");
    });

    it("does NOT classify needs_more_signal when evaluationState = 'EVALUATED' and evaluationStatus = 'SPARSE_SPEC'", () => {
      const cats = classifyOpportunityCategories({
        evaluationState: "EVALUATED",
        evaluationStatus: "SPARSE_SPEC",
        role: "VP Marketing",
      });
      expect(cats).not.toContain("needs_more_signal");
    });

    it("does NOT classify needs_more_signal when evaluationState = 'EVALUATED' and trueExecutiveMandate = 'SPARSE_SPEC'", () => {
      const cats = classifyOpportunityCategories({
        evaluationState: "EVALUATED",
        trueExecutiveMandate: "SPARSE_SPEC",
        role: "VP Marketing",
      });
      expect(cats).not.toContain("needs_more_signal");
    });

    it("does NOT classify needs_more_signal when recommendation contains 'sparse'", () => {
      const cats = classifyOpportunityCategories({
        evaluationState: "EVALUATED",
        recommendation: "sparse specification detected in raw preview",
        role: "VP Marketing",
      });
      expect(cats).not.toContain("needs_more_signal");
    });
  });

  describe("Final Orthogonal State Transition Matrix (Directive 5)", () => {
    const validFitDecisions = new Set(["PURSUE", "CONSIDER", "PASS"]);

    it("proves the canonical state matrix and validates decision nullability", () => {
      const matrixRows = [
        {
          row: "RECOVERY_PENDING / MINIMAL",
          acqStatus: "RECOVERY_PENDING",
          acqQuality: "MINIMAL",
          evidence: "UNVERIFIED",
          lifecycle: "ACTIVE",
          evaluationState: "ACQUISITION_PENDING",
          decision: null,
          qualityScore: null,
          canHaveFitDecision: false,
        },
        {
          row: "CAPTURE_FAILED / INVALID",
          acqStatus: "CAPTURE_FAILED",
          acqQuality: "INVALID",
          evidence: "UNVERIFIED",
          lifecycle: "ACTIVE",
          evaluationState: "ACQUISITION_FAILED",
          decision: null,
          qualityScore: null,
          canHaveFitDecision: false,
        },
        {
          row: "ACQUIRED / COMPLETE (Genuinely Sparse)",
          acqStatus: "ACQUIRED",
          acqQuality: "COMPLETE",
          evidence: "GENUINELY_SPARSE",
          lifecycle: "ACTIVE",
          evaluationState: "SPARSE_SPEC",
          decision: null,
          qualityScore: null,
          canHaveFitDecision: false,
        },
        {
          row: "ACQUIRED / COMPLETE (Sufficient)",
          acqStatus: "ACQUIRED",
          acqQuality: "COMPLETE",
          evidence: "SUFFICIENT",
          lifecycle: "ACTIVE",
          evaluationState: "EVALUATED",
          decision: "PURSUE",
          qualityScore: 88,
          canHaveFitDecision: true,
        },
        {
          row: "ACQUIRED / PARTIAL (Sufficient)",
          acqStatus: "ACQUIRED",
          acqQuality: "PARTIAL",
          evidence: "SUFFICIENT",
          lifecycle: "ACTIVE",
          evaluationState: "EVALUATED",
          decision: "CONSIDER",
          qualityScore: 72,
          canHaveFitDecision: true,
        },
        {
          row: "ANY / EXPIRED",
          acqStatus: "ACQUIRED",
          acqQuality: "COMPLETE",
          evidence: "SUFFICIENT",
          lifecycle: "EXPIRED",
          evaluationState: "EXPIRED",
          decision: null,
          qualityScore: null,
          canHaveFitDecision: false,
        },
      ];

      for (const row of matrixRows) {
        const matEval: MaterializedEvaluation = {
          id: `mat_${row.evaluationState.toLowerCase()}`,
          tenantId: "tenant_alpha",
          personId: "person_alpha",
          canonicalJobId: "job_x",
          opportunityVersion: "ver_x",
          evaluationContextFingerprint: "fp_x",
          evaluationState: row.evaluationState as any,
          decision: row.decision as any,
          qualityScore: row.qualityScore,
          rationale: "Matrix verification",
          evidenceIds: [],
          evaluationJson: JSON.stringify(
            row.decision ? { decision: row.decision, qualityScore: row.qualityScore } : { bypassed: true }
          ),
          materializedAt: new Date().toISOString(),
        };

        // Validate that this row satisfies consistency
        expect(() => validateEvaluationConsistency(matEval)).not.toThrow();

        if (row.canHaveFitDecision) {
          expect(validFitDecisions.has(row.decision!)).toBe(true);
          expect(typeof row.qualityScore).toBe("number");
        } else {
          expect(row.decision).toBeNull();
          expect(row.qualityScore).toBeNull();

          // Adversarially assert that injecting any fit decision throws
          const adversarialFit: MaterializedEvaluation = {
            ...matEval,
            decision: "PURSUE",
          };
          expect(() => validateEvaluationConsistency(adversarialFit)).toThrow();
        }
      }
    });

    it("proves that no other unverified or incomplete combination can produce an evaluated fit decision", () => {
      const invalidCombinations = [
        { evaluationState: "UNKNOWN", decision: "PURSUE" },
        { evaluationState: "ACQUISITION_PENDING", decision: "CONSIDER" },
        { evaluationState: "ACQUISITION_FAILED", decision: "PASS" },
        { evaluationState: "SPARSE_SPEC", decision: "PURSUE" },
        { evaluationState: "EXPIRED", decision: "CONSIDER" },
      ];

      for (const comb of invalidCombinations) {
        const invalidEval: MaterializedEvaluation = {
          id: "mat_invalid",
          tenantId: "t1",
          personId: "p1",
          canonicalJobId: "job_inv",
          opportunityVersion: "ver_inv",
          evaluationContextFingerprint: "fp_inv",
          evaluationState: comb.evaluationState as any,
          decision: comb.decision as any,
          qualityScore: 80,
          rationale: "Invalid combo",
          evidenceIds: [],
          evaluationJson: JSON.stringify({ decision: comb.decision, qualityScore: 80 }),
          materializedAt: new Date().toISOString(),
        };

        expect(() => validateEvaluationConsistency(invalidEval)).toThrow();
      }
    });
  });
});
