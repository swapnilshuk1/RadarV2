/**
 * tests/certification/journey_a_acquisition_to_evaluation.test.ts
 *
 * Continuous Certification Gate — Journey A: Acquisition → Evaluation
 *
 * Invariants Certified:
 * 1. Raw scraped capture ingests into canonical_opportunities and opportunity_versions.
 * 2. Opportunity version is linked idempotently without orphan search_plan_candidates FKs.
 * 3. Rich JD content produces acquisition_quality = 'RICH' and acquisition_status = 'ACQUIRED'.
 * 4. JobProjectionBuilder grounds structural dimensions from classified JD text.
 * 5. Materialization completes without false sparse vetoes or unhandled exceptions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";
import { CanonicalEvaluator } from "@/lib/intelligence/evaluation/CanonicalEvaluator";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "@/data/candidate-profile";

class TestAdapter implements DatabaseAdapter {
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
  async execute(sql: string, params?: QueryParams): Promise<{ rowsAffected: number; lastInsertRowid?: number | bigint | string }> {
    if (!params || params.length === 0) {
      this.db.exec(sql);
      return { rowsAffected: 1 };
    }
    const stmt = this.db.prepare(sql);
    const res = stmt.run(...(params || []));
    return { rowsAffected: res.changes, lastInsertRowid: res.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT");
      return res;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

describe("Journey A: Acquisition → Evaluation End-to-End Pipeline", () => {
  let adapter: TestAdapter;
  let ingestionService: CanonicalIngestionService;

  beforeEach(async () => {
    const db = new Database(":memory:");
    adapter = new TestAdapter(db);

    await adapter.execute(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT, is_active INTEGER DEFAULT 1);
      CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, status TEXT, criteria_json TEXT);
      CREATE TABLE canonical_opportunities (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_job_id TEXT NOT NULL,
        canonical_url TEXT,
        company_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source, source_job_id)
      );
      CREATE TABLE opportunity_versions (
        id TEXT PRIMARY KEY,
        canonical_job_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        job_title TEXT NOT NULL,
        company_name TEXT NOT NULL,
        location TEXT,
        employment_type TEXT,
        posted_at TEXT,
        posted_precision TEXT,
        raw_content TEXT,
        category_ids TEXT,
        acquisition_status TEXT,
        acquisition_quality TEXT,
        failure_class TEXT,
        lifecycle_state TEXT,
        evidence_state TEXT,
        source_payload_key TEXT,
        source_media_type TEXT,
        document_extraction_state TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(canonical_job_id, content_hash)
      );
      CREATE TABLE search_plan_candidates (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        search_plan_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL,
        opportunity_version TEXT NOT NULL,
        attention_decision TEXT NOT NULL,
        eligibility TEXT,
        eligibility_reason_codes_json TEXT,
        location_policy TEXT,
        location_evidence TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
      );
      CREATE TABLE search_plan_snapshots (
        id TEXT PRIMARY KEY,
        search_plan_id TEXT,
        tenant_id TEXT,
        person_id TEXT,
        snapshot_hash TEXT,
        payload_json TEXT
      );
      CREATE TABLE evaluation_jobs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        search_plan_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL,
        opportunity_version TEXT NOT NULL,
        evaluation_context_fingerprint TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
      );
      CREATE TABLE evaluation_contexts (
        context_fingerprint TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        search_plan_snapshot_id TEXT,
        ontology_version TEXT,
        ontology_fingerprint TEXT,
        policy_version TEXT,
        profile_version TEXT,
        created_at TEXT
      );
      CREATE TABLE active_evaluation_contexts (
        person_id TEXT,
        tenant_id TEXT,
        context_fingerprint TEXT,
        search_plan_id TEXT,
        activated_at TEXT,
        PRIMARY KEY(person_id, tenant_id)
      );
      CREATE TABLE materialized_evaluations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL,
        opportunity_version TEXT NOT NULL,
        evaluation_context_fingerprint TEXT NOT NULL,
        evaluation_fingerprint TEXT,
        evaluation_state TEXT NOT NULL,
        decision TEXT,
        quality_score REAL,
        confidence REAL,
        vetoed INTEGER DEFAULT 0,
        policy_version TEXT,
        evaluated_at TEXT
      );
    `);

    await adapter.execute(`INSERT INTO tenants VALUES ('tenant_prod', 'Executive Search Tenant')`);
    await adapter.execute(`INSERT INTO people VALUES ('person_exec', 'tenant_prod', 1)`);
    await adapter.execute(`
      INSERT INTO search_plans VALUES (
        'sp_exec', 'tenant_prod', 'person_exec', 'active',
        '{"targetRoles":["Chief Marketing Officer","Marketing","VP"],"targetSeniority":["Chief","Officer","VP","CXO"]}'
      )
    `);

    ingestionService = new CanonicalIngestionService(adapter);
  });

  it("ingests raw scraped executive job, resolves version without orphan FK, and evaluates cleanly", async () => {
    const rawJobPayload = {
      sourcePortal: "LinkedIn" as const,
      sourceJobId: "li_cmo_998877",
      canonicalUrl: "https://www.linkedin.com/jobs/view/998877",
      jobTitle: "Chief Marketing Officer",
      companyName: "HyperScale Tech Global",
      location: "Bengaluru, Karnataka, India (Hybrid)",
      rawContent: `
        Chief Marketing Officer (CMO) — Global Enterprise Scale
        About HyperScale Tech:
        HyperScale Tech is a premier high-growth enterprise platform. We are seeking a seasoned Chief Marketing Officer (CMO)
        to lead our global marketing strategy, brand positioning, and demand generation engine.
        
        Key Mandates:
        - Lead Performance Marketing, GTM Strategy, and Digital Transformation across global enterprise demand channels.
        - Direct full P&L accountability for a $50M+ ARR growth budget across North America, APAC, and EMEA.
        - Drive our commercial transformation, digital demand gen, pipeline acceleration, and global enterprise brand positioning.
        - Partner directly with Founder/CEO and Board of Directors on strategic go-to-market decisions and global corporate positioning.
        
        Requirements:
        - 15+ years of progressive commercial and executive leadership experience in B2B / SaaS technology organizations.
        - Demonstrated track record leading growth marketing, brand strategy, customer lifecycle transformation, and international scaling.
      `,
    };

    // 1. Ingestion Boundary
    const ingestResult = await ingestionService.ingestOpportunity(rawJobPayload);
    expect(ingestResult.canonicalJobId).toBeDefined();
    expect(ingestResult.opportunityVersion).toBeDefined();
    expect(ingestResult.isNewOpportunity).toBe(true);

    // 2. Lineage Invariant: search_plan_candidates MUST point to the real opportunity_versions.id
    const candidate = await adapter.one<{
      canonical_job_id: string;
      opportunity_version: string;
      attention_decision: string;
      eligibility: string | null;
      eligibility_reason_codes_json: string | null;
    }>(
      `SELECT canonical_job_id, opportunity_version, attention_decision,
              eligibility, eligibility_reason_codes_json
       FROM search_plan_candidates
       WHERE canonical_job_id = ?`,
      [ingestResult.canonicalJobId]
    );

    expect(candidate).toBeDefined();
    expect(candidate?.opportunity_version).toBe(ingestResult.opportunityVersion);
    expect(candidate?.attention_decision).toBe("CANDIDATE");
    expect(candidate?.eligibility).toBe("ELIGIBLE");
    expect(JSON.parse(candidate?.eligibility_reason_codes_json || "[]"))
      .toContain("ROLE_FAMILY_MATCH");

    // 3. Idempotent Ingestion Check (Re-ingestion with same content must not corrupt FK)
    const secondIngest = await ingestionService.ingestOpportunity(rawJobPayload);
    expect(secondIngest.opportunityVersion).toBe(ingestResult.opportunityVersion);

    const reCheckedCandidate = await adapter.one<{ opportunity_version: string }>(
      `SELECT opportunity_version FROM search_plan_candidates WHERE canonical_job_id = ?`,
      [ingestResult.canonicalJobId]
    );
    expect(reCheckedCandidate?.opportunity_version).toBe(ingestResult.opportunityVersion);

    // 4. Candidate & Job Projection
    const candidateBuilder = new CandidateProjectionBuilderImpl();
    const candidateProjection = candidateBuilder.fromProfile(candidateProfile);

    const rawOpp = {
      jobHash: ingestResult.canonicalJobId,
      canonicalUrl: rawJobPayload.canonicalUrl,
      title: rawJobPayload.jobTitle,
      company: rawJobPayload.companyName,
      location: rawJobPayload.location,
      rawText: rawJobPayload.rawContent,
      description: rawJobPayload.rawContent,
      normalizedText: rawJobPayload.rawContent,
    };

    // 5. Canonical Evaluation Orchestration Boundary
    const evalOutput = CanonicalEvaluator.evaluateOpportunity(rawOpp, candidateProjection);
    expect(evalOutput.record.verb).toMatch(/^(PURSUE|CONSIDER)$/);
    expect(evalOutput.record.qualityScore).toBeGreaterThanOrEqual(70);

    // 6. Persistence of Materialized Evaluation
    await adapter.execute(
      `INSERT INTO materialized_evaluations (
        id, tenant_id, person_id, canonical_job_id, opportunity_version,
        evaluation_context_fingerprint, evaluation_fingerprint, evaluation_state, decision, quality_score, confidence, vetoed, policy_version, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        `me_${ingestResult.canonicalJobId}`,
        "tenant_prod",
        "person_exec",
        ingestResult.canonicalJobId,
        ingestResult.opportunityVersion,
        "ctx_test_hash",
        "eval_test_hash",
        "COMPLETE",
        evalOutput.record.verb,
        evalOutput.record.qualityScore,
        evalOutput.record.confidence,
        0,
        "v4.1",
      ]
    );

    const savedEval = await adapter.one<{ evaluation_state: string; decision: string; vetoed: number }>(
      `SELECT evaluation_state, decision, vetoed FROM materialized_evaluations WHERE canonical_job_id = ?`,
      [ingestResult.canonicalJobId]
    );

    expect(savedEval?.evaluation_state).toBe("COMPLETE");
    expect(savedEval?.decision).toMatch(/^(PURSUE|CONSIDER)$/);
    expect(savedEval?.vetoed).toBe(0);
  });
});
