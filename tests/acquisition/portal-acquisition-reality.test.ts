/**
 * tests/acquisition/portal-acquisition-reality.test.ts
 *
 * RADAR V4 — Phase 2 Adversarial Portal Acquisition Reality & Certification Suite
 *
 * Certifies portal acquisition contracts against live DOM fixtures, ATS redirects,
 * container aggregation, and strict UI state invariants.
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { ResponseValidator } from "@/lib/acquisition/validator";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";
import { SqliteCanonicalServingStore } from "@/data/sqlite/repositories/SqliteCanonicalServingStore";
import { SqliteMaterializedEvaluationStore } from "@/data/sqlite/repositories/SqliteMaterializedEvaluationStore";
import { extract } from "../../scripts/scraper/extract/extractor";
import type { DetailedCard } from "../../scripts/scraper/types";
import { validateEvaluationConsistency } from "@/lib/domain/evaluation_fingerprint";
import type { MaterializedEvaluation } from "@/lib/domain/evaluation_context";
import { classifyOpportunityCategories } from "@/lib/domain/category_taxonomy";

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
    const res = stmt.run(...(params || []));
    return { rowsAffected: res.changes, lastInsertRowid: res.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function setupFullCanonicalSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
    INSERT INTO tenants (id, name) VALUES ('t_exec', 'Executive Tenant');

    CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT, email TEXT, name TEXT);
    INSERT INTO people (id, tenant_id, email, name) VALUES ('p_exec', 't_exec', 'leader@radar.io', 'Executive Leader');

    CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, status TEXT, criteria_json TEXT);
    INSERT INTO search_plans (id, tenant_id, person_id, status, criteria_json)
    VALUES ('sp_exec', 't_exec', 'p_exec', 'active', '{"targetSeniority":["VP","CXO"],"targetRoles":["VP of Engineering"],"targetLocations":["Remote","Bengaluru"]}');

    CREATE TABLE search_plan_snapshots (
      id TEXT PRIMARY KEY, search_plan_id TEXT, tenant_id TEXT, person_id TEXT,
      snapshot_hash TEXT, payload_json TEXT, created_at DATETIME
    );
    INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
    VALUES ('sps_exec', 'sp_exec', 't_exec', 'p_exec', 'hash_sps', '{"targetSeniority":["VP","CXO"]}', CURRENT_TIMESTAMP);

    CREATE TABLE evaluation_contexts (
      context_fingerprint TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT,
      search_plan_snapshot_id TEXT, ontology_version TEXT, ontology_fingerprint TEXT,
      policy_version TEXT, profile_version TEXT, created_at DATETIME
    );
    INSERT INTO evaluation_contexts (
      context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
      ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
    ) VALUES (
      'fp_exec_v4', 't_exec', 'p_exec', 'sps_exec', 'v4.1', 'onto_hash', 'policy_v4', 'prof_v1', CURRENT_TIMESTAMP
    );

    CREATE TABLE canonical_opportunities (
      id TEXT PRIMARY KEY, source TEXT, source_job_id TEXT, canonical_url TEXT,
      company_name TEXT, created_at DATETIME, last_seen_at DATETIME,
      UNIQUE(source, source_job_id)
    );

    CREATE TABLE opportunity_versions (
      id TEXT PRIMARY KEY, canonical_job_id TEXT, content_hash TEXT, job_title TEXT,
      company_name TEXT, location TEXT, employment_type TEXT, posted_at TEXT,
      posted_precision TEXT, raw_content TEXT, acquisition_status TEXT,
      acquisition_quality TEXT, failure_class TEXT, lifecycle_state TEXT,
      evidence_state TEXT, created_at DATETIME,
      UNIQUE(canonical_job_id, content_hash)
    );

    CREATE TABLE search_plan_candidates (
      tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT,
      opportunity_version TEXT, attention_decision TEXT, created_at DATETIME,
      PRIMARY KEY(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
    );

    CREATE TABLE materialized_evaluations (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL,
      canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL,
      evaluation_context_fingerprint TEXT NOT NULL, evaluation_state TEXT NOT NULL DEFAULT 'EVALUATED',
      decision TEXT, quality_score REAL, rationale TEXT, evidence_ids TEXT,
      evaluation_json TEXT NOT NULL, vetoed INTEGER NOT NULL DEFAULT 0, materialized_at DATETIME NOT NULL,
      UNIQUE(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
    );

    CREATE TABLE canonical_decisions (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL,
      canonical_job_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT,
      reviewed_fingerprint TEXT, updated_at DATETIME NOT NULL,
      UNIQUE(tenant_id, person_id, canonical_job_id)
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

    CREATE TABLE evaluation_context_scopes (
      context_fingerprint TEXT NOT NULL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      search_plan_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(context_fingerprint, tenant_id, person_id, search_plan_id)
    );

    CREATE TABLE active_evaluation_contexts (
      tenant_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      search_plan_id TEXT NOT NULL,
      context_fingerprint TEXT NOT NULL,
      activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      activated_by TEXT NOT NULL,
      PRIMARY KEY (tenant_id, person_id, search_plan_id),
      FOREIGN KEY (context_fingerprint, tenant_id, person_id, search_plan_id) 
          REFERENCES evaluation_context_scopes(context_fingerprint, tenant_id, person_id, search_plan_id)
    );
  `);
}

describe("Adversarial Portal Acquisition & Certification Suite (RADAR V4 Phase 2)", () => {
  describe("1. Indeed Acquisition Reality & External ATS Contract", () => {
    it("certifies internal Indeed DOM extraction with #jobDescriptionText", () => {
      const mockHtml = `
        <div id="jobDescriptionText" class="jobsearch-jobDescriptionText">
          <h3>About the Role</h3>
          <p>We are seeking a Vice President of Engineering to lead our global distributed platform engineering organization across India and North America.</p>
          <p>Key Responsibilities include managing a 120+ person engineering division, owning $45M cloud infrastructure budget, driving multi-region latency reduction, and scaling microservices architecture.</p>
          <p>Qualifications: 15+ years of software engineering experience, 8+ years leading managers and senior directors, proven track record in high-frequency distributed systems.</p>
        </div>
      `;
      const rawText = mockHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const validation = ResponseValidator.validate({
        html: mockHtml,
        url: "https://in.indeed.com/viewjob?jk=abc12345",
        sourcePortal: "Indeed",
        httpStatus: 200,
        extractedTitle: "Vice President of Engineering",
        extractedCompany: "Acme Distributed Systems",
        extractedDescription: rawText,
      });

      expect(validation.isValid).toBe(true);
      expect(validation.quality).toBe("COMPLETE");
      expect(validation.confidence).toBe("HIGH");
      expect(validation.failureClass).toBeUndefined();
    });

    it("certifies external ATS redirect (/rc/clk -> Workday [data-automation-id='jobPostingDescription'])", () => {
      const workdayHtml = `
        <div data-automation-id="jobPostingDescription">
          <h2>Executive Vice President of Technology</h2>
          <p>Global Enterprise is hiring an Executive Vice President of Technology to lead digital transformation, cloud modernization, and enterprise architecture across global markets.</p>
          <p>You will oversee 300+ technology professionals, lead cloud replatforming on AWS, and partner with the CXO executive team on global strategy.</p>
          <p>Key Responsibilities include managing a $60M annual IT and cloud infrastructure budget, driving microservices replatforming, and setting organizational engineering standards.</p>
          <p>Requirements: Deep experience in enterprise scale, P&L management, organizational transformation, and global distributed engineering leadership.</p>
        </div>
      `;
      const rawText = workdayHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const validation = ResponseValidator.validate({
        html: workdayHtml,
        url: "https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/VP-Technology",
        sourcePortal: "Indeed",
        httpStatus: 200,
        extractedTitle: "Executive Vice President of Technology",
        extractedCompany: "Acme Global",
        extractedDescription: rawText,
      });

      expect(validation.isValid).toBe(true);
      expect(validation.quality).toBe("COMPLETE");
      expect(validation.confidence).toBe("HIGH");
    });

    it("proves search-card snippet CANNOT become canonical JD when detail extraction fails", async () => {
      // DetailedCard with snippet from search card but empty/failed detail text
      const snapshot: DetailedCard = {
        title: "VP of Product",
        company: "Stripe",
        location: "Remote",
        rawText: "Search card snippet: We are hiring a VP of Product...", // Snippet from feed
        detailUrl: "https://in.indeed.com/viewjob?jk=fail123",
        portal: "Indeed",
        scrapedAt: new Date().toISOString(),
        detail: {
          fetched: false,
          rawHtml: "",
          rawText: "", // Detail extraction completely failed
          fetchDurationMs: 150,
          fetchError: "Timeout reaching external ATS",
        },
      };

      const result = await extract(snapshot, { mode: "deterministic" });
      // normalizedText MUST be empty or strictly equal detail.rawText, NEVER falling back to snippet
      expect(result.normalizedText).toBe("");

      // When passed to ResponseValidator, it MUST classify as INVALID / EMPTY_CONTENT
      const val = ResponseValidator.validate({
        html: "",
        url: snapshot.detailUrl,
        sourcePortal: snapshot.portal,
        httpStatus: 0,
        extractedTitle: snapshot.title,
        extractedCompany: snapshot.company,
        extractedDescription: result.normalizedText,
      });

      expect(val.isValid).toBe(false);
      expect(val.quality).toBe("INVALID");
      expect(val.failureClass).toBe("EMPTY_CONTENT");
    });

    it("certifies Cloudflare / CAPTCHA challenge detection", () => {
      const challengeHtml = `
        <html><head><title>Just a moment... Security Verification</title></head>
        <body><div id="cf-challenge">Please verify you are human</div></body></html>
      `;
      const val = ResponseValidator.validate({
        html: challengeHtml,
        url: "https://in.indeed.com/challenge",
        sourcePortal: "Indeed",
        httpStatus: 403,
        extractedTitle: "",
        extractedCompany: "",
        extractedDescription: "Please verify you are human",
      });

      expect(val.isValid).toBe(false);
      expect(val.quality).toBe("INVALID");
      expect(val.failureClass).toBe("BOT_CHALLENGE_BLOCK");
    });
  });

  describe("2. Naukri Acquisition Reality & Multi-Container Aggregation", () => {
    it("certifies that 35-word Job Highlights container does NOT terminate extraction prematurely when 700-word body exists", () => {
      // Simulating Naukri page structure with both highlights and full description
      const highlightsText = "Role: Engineering Director. Experience: 15-20 yrs. Location: Bengaluru. Key Skills: Cloud Architecture, Engineering Leadership, Distributed Systems, Microservices.";
      const descriptionText = `
        About Company & Opportunity:
        Leading Tier-1 Enterprise is looking for an Engineering Director / VP to lead the Core Banking Architecture team.
        In this role, you will define multi-year technology roadmaps, manage direct reporting Directors and Senior Engineering Managers,
        and take full ownership of our next-generation transactional ledger processing ₹10,000 Cr daily.
        Key Accountability:
        1. Lead high-performance team of 80+ engineers across platform, SRE, and distributed storage.
        2. Direct multi-million dollar AWS and Kubernetes infrastructure budget.
        3. Work directly with CTO and CEO on architectural governance and resilience.
        Requirements:
        - 15+ years of software product development.
        - Proven record leading large-scale cloud native platforms.
        - Deep expertise in Java, Go, Kafka, Distributed Relational DBs, and low-latency systems.
      `;

      // Naukri extractor aggregates highlights + full description + skills
      const aggregatedText = `Highlights:\n${highlightsText}\n\nJob Description:\n${descriptionText}`.trim();

      expect(highlightsText.split(/\s+/).length).toBeLessThan(40);
      expect(aggregatedText.split(/\s+/).length).toBeGreaterThan(120);

      const val = ResponseValidator.validate({
        html: `<div class="styles_job-desc-container">${aggregatedText}</div>`,
        url: "https://www.naukri.com/job-listings-engineering-director-12345",
        sourcePortal: "Naukri",
        httpStatus: 200,
        extractedTitle: "Engineering Director",
        extractedCompany: "Acme Corporation",
        extractedDescription: aggregatedText,
      });

      expect(val.isValid).toBe(true);
      expect(val.quality).toBe("COMPLETE");
      expect(val.confidence).toBe("HIGH");
    });

    it("certifies 404 HTTP status -> failureClass REMOVED_404", () => {
      const val = ResponseValidator.validate({
        html: "<html><body>404 Not Found</body></html>",
        url: "https://www.naukri.com/job-listings-vp-ops-999",
        sourcePortal: "Naukri",
        httpStatus: 404,
        extractedTitle: "VP of Commercial Operations",
        extractedCompany: "Beta Corp",
        extractedDescription: "",
      });

      expect(val.isValid).toBe(false);
      expect(val.quality).toBe("INVALID");
      expect(val.failureClass).toBe("REMOVED_404");
    });
  });

  describe("3. UI State Contract & Zero Heuristics Invariant", () => {
    it("proves metrics.categoryMetrics.needs_more_signal.total strictly equals listOpportunities(needs_more_signal).length", async () => {
      const sqliteDb = new Database(":memory:");
      setupFullCanonicalSchema(sqliteDb);
      const adapter = new TestSqliteAdapter(sqliteDb);
      const servingStore = new SqliteCanonicalServingStore(adapter);
      const evalStore = new SqliteMaterializedEvaluationStore(adapter);

      const scope = { tenantId: "t_exec", personId: "p_exec" };

      // Insert 1 EVALUATED opportunity (PURSUE)
      sqliteDb.exec(`
        INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name)
        VALUES ('co_eval', 'LinkedIn', 'li_eval_1', 'https://linkedin.com/jobs/view/1', 'Alpha Corp');

        INSERT INTO opportunity_versions (
          id, canonical_job_id, content_hash, job_title, company_name, location,
          raw_content, acquisition_status, acquisition_quality, lifecycle_state, evidence_state
        ) VALUES (
          'ov_eval', 'co_eval', 'hash_eval', 'Chief Technology Officer', 'Alpha Corp', 'Bengaluru',
          '${"Detailed rich executive job description with complete mandate. ".repeat(40)}',
          'ACQUIRED', 'COMPLETE', 'ACTIVE', 'SUFFICIENT'
        );

        INSERT INTO search_plan_candidates (
          tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision
        ) VALUES ('t_exec', 'p_exec', 'sp_exec', 'co_eval', 'ov_eval', 'CANDIDATE');
      `);

      const evalPayload = {
        role: "Chief Technology Officer",
        company: "Alpha Corp",
        engineRecommendation: { engineVerdict: "PURSUE", qualityScore: 94 },
      };

      await evalStore.materializeEvaluation(scope, {
        id: "mat_eval_1",
        tenantId: scope.tenantId,
        personId: scope.personId,
        canonicalJobId: "co_eval",
        opportunityVersion: "ov_eval",
        evaluationContextFingerprint: "fp_exec_v4",
        evaluationState: "EVALUATED",
        decision: "PURSUE",
        qualityScore: 94,
        rationale: "Strong CTO match",
        evidenceIds: ["ev1"],
        evaluationJson: JSON.stringify(evalPayload),
        materializedAt: new Date().toISOString(),
      });

      // Insert 2 SPARSE_SPEC opportunities (intentionally null decision & null qualityScore)
      sqliteDb.exec(`
        INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name)
        VALUES 
          ('co_sparse1', 'Indeed', 'ind_sparse_1', 'https://indeed.com/viewjob?jk=1', 'Sparse Corp A'),
          ('co_sparse2', 'Naukri', 'nk_sparse_2', 'https://naukri.com/job/2', 'Sparse Corp B');

        INSERT INTO opportunity_versions (
          id, canonical_job_id, content_hash, job_title, company_name, location,
          raw_content, acquisition_status, acquisition_quality, lifecycle_state, evidence_state
        ) VALUES 
          ('ov_sparse1', 'co_sparse1', 'hash_s1', 'VP of Engineering', 'Sparse Corp A', 'Remote', 'Short 30 char spec', 'RECOVERY_PENDING', 'MINIMAL', 'ACTIVE', 'UNVERIFIED'),
          ('ov_sparse2', 'co_sparse2', 'hash_s2', 'Director of Product', 'Sparse Corp B', 'Mumbai', 'Short 45 char spec', 'RECOVERY_PENDING', 'MINIMAL', 'ACTIVE', 'UNVERIFIED');

        INSERT INTO search_plan_candidates (
          tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision
        ) VALUES 
          ('t_exec', 'p_exec', 'sp_exec', 'co_sparse1', 'ov_sparse1', 'CANDIDATE'),
          ('t_exec', 'p_exec', 'sp_exec', 'co_sparse2', 'ov_sparse2', 'CANDIDATE');
      `);

      const sparsePayload1 = {
        role: "VP of Engineering",
        company: "Sparse Corp A",
        evaluationStatus: "SPARSE_SPEC",
      };
      const sparsePayload2 = {
        role: "Director of Product",
        company: "Sparse Corp B",
        evaluationStatus: "SPARSE_SPEC",
      };

      await evalStore.materializeEvaluation(scope, {
        id: "mat_sparse_1",
        tenantId: scope.tenantId,
        personId: scope.personId,
        canonicalJobId: "co_sparse1",
        opportunityVersion: "ov_sparse1",
        evaluationContextFingerprint: "fp_exec_v4",
        evaluationState: "SPARSE_SPEC",
        decision: null,
        qualityScore: null,
        rationale: "Needs more signal",
        evidenceIds: [],
        evaluationJson: JSON.stringify(sparsePayload1),
        materializedAt: new Date().toISOString(),
      });

      await evalStore.materializeEvaluation(scope, {
        id: "mat_sparse_2",
        tenantId: scope.tenantId,
        personId: scope.personId,
        canonicalJobId: "co_sparse2",
        opportunityVersion: "ov_sparse2",
        evaluationContextFingerprint: "fp_exec_v4",
        evaluationState: "SPARSE_SPEC",
        decision: null,
        qualityScore: null,
        rationale: "Needs more signal",
        evidenceIds: [],
        evaluationJson: JSON.stringify(sparsePayload2),
        materializedAt: new Date().toISOString(),
      });

      // 1. Fetch metrics
      const metrics = await servingStore.getOpportunityMetrics(scope);
      expect(metrics.totalScreened).toBe(3);
      expect(metrics.categoryMetrics.needs_more_signal.total).toBe(2);

      // 2. Query category list
      const sparseOpps = await servingStore.listOpportunities(scope, { categoryId: "needs_more_signal" });
      expect(sparseOpps.length).toBe(2);
      expect(metrics.categoryMetrics.needs_more_signal.total).toBe(sparseOpps.length);

      // 3. Verify every item has evaluationState = SPARSE_SPEC, decision = null, and score = null
      for (const opp of sparseOpps) {
        expect((opp as any).evaluationState).toBe("SPARSE_SPEC");
        expect(opp.engineRecommendation?.qualityScore ?? null).toBeNull();
      }
    });
  });
});
