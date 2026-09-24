import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import {
  AcquisitionIngressService,
  isValidAcquisitionIngressSecret,
  parseAcquisitionEnvelope,
  type AcquisitionEnvelope,
} from "@/lib/acquisition/ingress";
import { computeContentHash, type CanonicalIngestionResult } from "@/lib/acquisition/CanonicalIngestionService";

class TestAdapter implements DatabaseAdapter {
  constructor(readonly sqlite: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> {
    return (this.sqlite.prepare(sql).get(...(params || [])) as T) || null;
  }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...(params || [])) as T[];
  }
  async execute(sql: string, params?: QueryParams) {
    const result = this.sqlite.prepare(sql).run(...(params || []));
    return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.sqlite.exec("BEGIN");
    try { const result = await fn(this); this.sqlite.exec("COMMIT"); return result; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

const payload = {
  sourcePortal: "LinkedIn",
  sourceJobId: "ingress-job-1",
  canonicalUrl: "https://www.linkedin.com/jobs/view/ingress-job-1",
  jobTitle: "VP Sales",
  companyName: "Acme",
  location: "Delhi",
  employmentType: "Full-time",
  rawContent: "A substantive durable raw job description.",
  enrichmentDispatch: { detailedCard: { canonicalMaterial: { title: "VP Sales", companyName: "Acme", location: "Delhi", employmentType: "Full-time", rawContent: "A substantive durable raw job description." } }, pipelineVersion: "ingress-test" },
};

function envelope(): AcquisitionEnvelope {
  return {
    schemaVersion: "1", submissionId: "submission-1", runId: "run-ingress-1",
    tenantId: "tenant-1", personId: "person-1", searchPlanId: "plan-1",
    contentHash: computeContentHash({ title: payload.jobTitle, companyName: payload.companyName, location: payload.location, employmentType: payload.employmentType, rawContent: payload.rawContent }),
    payload,
  };
}

function setup(): TestAdapter {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tenants (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id));
    CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), person_id TEXT NOT NULL REFERENCES people(id));
    CREATE TABLE scrape_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, search_plan_id TEXT, status TEXT NOT NULL, portal_targets TEXT NOT NULL, config_json TEXT NOT NULL, metrics_json TEXT NOT NULL, total_discovered INTEGER NOT NULL, total_enqueued INTEGER NOT NULL, created_at TEXT, started_at TEXT, updated_at TEXT);
    CREATE TABLE acquisition_ledger (id TEXT PRIMARY KEY, canonical_job_id TEXT NOT NULL, source_portal TEXT NOT NULL, source_job_id TEXT NOT NULL, canonical_url TEXT NOT NULL, title TEXT NOT NULL, company_name TEXT NOT NULL, location TEXT, state TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_acquired_at TEXT, freshness_state TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source_portal, canonical_job_id));
    CREATE TABLE acquisition_ingestion_lineage (id TEXT PRIMARY KEY, scrape_run_id TEXT NOT NULL REFERENCES scrape_runs(id), tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, acquisition_ledger_id TEXT NOT NULL REFERENCES acquisition_ledger(id), card_id TEXT NOT NULL, ingestion_attempt INTEGER NOT NULL, source_portal TEXT NOT NULL, source_job_id TEXT NOT NULL, source_url TEXT NOT NULL, resolved_url TEXT, capture_state TEXT NOT NULL, document_state TEXT NOT NULL, content_hash TEXT, canonical_job_id TEXT, opportunity_version TEXT, UNIQUE(scrape_run_id, card_id, ingestion_attempt));
    CREATE TABLE acquisition_ingress_submissions (submission_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, search_plan_id TEXT, run_id TEXT NOT NULL, content_hash TEXT NOT NULL, canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL, response_json TEXT NOT NULL);
    INSERT INTO tenants VALUES ('tenant-1', 'active');
    INSERT INTO people VALUES ('person-1', 'tenant-1');
    INSERT INTO search_plans VALUES ('plan-1', 'tenant-1', 'person-1');
  `);
  return new TestAdapter(db);
}

const result: CanonicalIngestionResult = {
  canonicalJobId: "linkedin:ingress-job-1", opportunityVersion: "version-1", versionCreatedAt: "2026-09-24T00:00:00.000Z",
  contentHash: "a".repeat(64), sourcePayloadKey: "acquisition/linkedin:ingress-job-1/version-1/snapshot.json", sourceMediaType: "application/json",
  isNewOpportunity: true, isNewVersion: true, plansEvaluated: 1, candidatesProjected: 1, candidateDecisions: {}, candidateEligibility: {}, jobsEnqueued: 1, enrichmentJobId: "enrich-1", isNewEnrichmentJob: true,
};

describe("acquisition ingress boundary", () => {
  it("rejects missing and wrong secrets while accepting the configured secret", () => {
    expect(isValidAcquisitionIngressSecret(undefined, null)).toBe(false);
    expect(isValidAcquisitionIngressSecret("secret", null)).toBe(false);
    expect(isValidAcquisitionIngressSecret("secret", "wrong!")).toBe(false);
    expect(isValidAcquisitionIngressSecret("secret", "secret")).toBe(true);
  });

  it("rejects laptop paths and a mismatched canonical hash", () => {
    const localPath = envelope(); localPath.payload = { ...payload, sourcePayloadKey: "C:\\Users\\operator\\snapshot.json" };
    expect(() => parseAcquisitionEnvelope(localPath)).toThrow("LAPTOP_LOCAL_SOURCE_REFERENCE_REJECTED");
    expect(() => parseAcquisitionEnvelope({ ...envelope(), contentHash: "b".repeat(64) })).toThrow("CONTENT_HASH_MISMATCH");
  });

  it("creates the Oracle-owned run and one idempotent canonical lineage binding", async () => {
    const db = setup();
    let calls = 0;
    const service = new AcquisitionIngressService(db, { ingestOpportunity: async () => { calls++; return result; } } as any);
    const first = await service.submit(envelope());
    const replay = await service.submit(envelope());
    expect(replay).toEqual(first);
    expect(calls).toBe(1);
    expect(await db.one<{ status: string }>("SELECT status FROM scrape_runs WHERE id = ?", ["run-ingress-1"])).toEqual({ status: "running" });
    expect(await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM acquisition_ingestion_lineage")).toEqual({ n: 1 });
    expect(await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM acquisition_ingress_submissions")).toEqual({ n: 1 });
  });
});
