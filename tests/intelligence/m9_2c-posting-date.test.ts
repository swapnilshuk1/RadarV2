import { describe, it, expect, beforeAll } from "vitest";
import { DatabaseAdapter } from "../../src/data/database/adapter";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { serveEvaluation } from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";

describe("M9.2C Canonical Posting-Date Provenance", () => {
  let db: DatabaseAdapter;
  let sqliteDb: Database.Database;
  let ingestionService: CanonicalIngestionService;
  let servingStore: SqliteCanonicalServingStore;
  
  const tenantId = "tenant_pd";
  const personId = "person_pd";
  const scope = { tenantId, personId };

  beforeAll(async () => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    ingestionService = new CanonicalIngestionService(db);
    servingStore = new SqliteCanonicalServingStore(db);

    await runMigrations(db);

    sqliteDb.exec(`
      INSERT INTO tenants (id, status) VALUES ('${tenantId}', 'active');
      INSERT INTO people (id, email, tenant_id) VALUES ('${personId}', 'test_pd@test.com', '${tenantId}');
      INSERT INTO search_plans (id, tenant_id, person_id, title, criteria_json, status) VALUES 
        ('sp_1', '${tenantId}', '${personId}', 'Search', '{}', 'active');
      INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES 
        ('sps_1', '${tenantId}', '${personId}', 'sp_1', 'snap_hash_1', '{}');
      INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES 
        ('ctx_fp_1', '${tenantId}', '${personId}', 'sps_1', 'v2', 'ofp_1', 'v4.3', 'prof_1');
    `);
  });

  it("1. Valid source posting date is persisted correctly and isolated from created_at", async () => {
    const postedAt = "2023-10-01T00:00:00Z";
    const res = await ingestionService.ingestOpportunity({
      sourcePortal: "linkedin",
      sourceJobId: "job_valid",
      canonicalUrl: "https://linkedin.com/jobs/job_valid",
      jobTitle: "CEO",
      companyName: "Valid Corp",
      location: "Remote",
      postedAt,
      rawContent: "{}"
    }, scope);

    const row = await db.one<any>(`SELECT posted_at, created_at FROM opportunity_versions WHERE id = ?`, [res.opportunityVersion]);
    expect(row.posted_at).toBe(postedAt);
    expect(row.created_at).not.toBe(postedAt);
  });

  it("2. Missing posting date persists as NULL", async () => {
    const res = await ingestionService.ingestOpportunity({
      sourcePortal: "indeed",
      sourceJobId: "job_missing",
      canonicalUrl: "https://indeed.com/jobs/job_missing",
      jobTitle: "CTO",
      companyName: "Missing Corp",
      location: "Remote",
      rawContent: "{}" // Note: postedAt omitted
    }, scope);

    const row = await db.one<any>(`SELECT posted_at, created_at FROM opportunity_versions WHERE id = ?`, [res.opportunityVersion]);
    expect(row.posted_at).toBeNull();
    expect(row.created_at).toBeDefined();
  });

  it("3. Canonical serving of resulting value propagates 'Age unavailable' for NULL posted_at", async () => {
    const servingCtx = {
        jobHash: "test",
        canonicalJobId: "can_1",
        opportunityVersion: "ov_1",
        role: "Test",
        company: "Test",
        location: "Test",
        scrapedFrom: "Test",
        applyUrl: "Test",
        postedAt: null
    };

    const evaluated = serveEvaluation(
        {
            jobHash: "test",
            evaluationInputHash: "123",
            intrinsicQualityScore: 90,
            intrinsicVerdict: "PURSUE",
            baseNarrative: { 
              baseRecommendationProse: "Go",
              whyNow: "Now",
              positioning: "Test",
              primaryProof: "Proof",
              hiringRisk: "Risk",
              alternativePath: "Path",
              recommendationArchetype: "Arch",
              recommendationArchetypeTagline: "Tag",
              mandateArchetype: "Mandate",
              primaryDriver: "P",
              secondaryDriver: "S",
              primaryRisk: "R",
              tailoringEffort: "E",
              capabilityAlignmentText: "Cap",
              recommendedAction: "PURSUE"
            }
        } as any,
        { activePursuits: 0, attentionWindow: 5 },
        servingCtx as any,
        null
    );

    expect(evaluated.postedRelative).toBe("Age unavailable");
  });
});

import { normalizePostingDate } from "../../scripts/scraper/utils/date";

describe("Scraper Date Normalization Unit Tests", () => {
  const mockScrapedAt = "2023-10-15T12:00:00.000Z";

  it("handles valid ISO strings directly", () => {
    expect(normalizePostingDate("2023-10-01T00:00:00Z", mockScrapedAt)).toEqual({ date: "2023-10-01T00:00:00.000Z", precision: "EXACT" });
  });

  it("handles 'just now' and 'today'", () => {
    expect(normalizePostingDate("just now", mockScrapedAt)).toEqual({ date: mockScrapedAt, precision: "RELATIVE_ESTIMATE" });
    expect(normalizePostingDate("today", mockScrapedAt)).toEqual({ date: mockScrapedAt, precision: "RELATIVE_ESTIMATE" });
  });

  it("handles relative days correctly", () => {
    const expected = new Date(new Date(mockScrapedAt).getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(normalizePostingDate("2 days ago", mockScrapedAt)).toEqual({ date: expected, precision: "RELATIVE_ESTIMATE" });
    expect(normalizePostingDate("Posted 2 days ago", mockScrapedAt)).toEqual({ date: expected, precision: "RELATIVE_ESTIMATE" });
  });

  it("handles relative hours correctly", () => {
    const expected = new Date(new Date(mockScrapedAt).getTime() - 5 * 60 * 60 * 1000).toISOString();
    expect(normalizePostingDate("5 hours ago", mockScrapedAt)).toEqual({ date: expected, precision: "RELATIVE_ESTIMATE" });
  });

  it("handles 30+ days ago", () => {
    const expected = new Date(new Date(mockScrapedAt).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(normalizePostingDate("30+ days ago", mockScrapedAt)).toEqual({ date: expected, precision: "LOWER_BOUND" });
  });

  it("handles empty or malformed strings gracefully", () => {
    expect(normalizePostingDate("", mockScrapedAt)).toEqual({ precision: "UNKNOWN" });
    expect(normalizePostingDate(null, mockScrapedAt)).toEqual({ precision: "UNKNOWN" });
    expect(normalizePostingDate(undefined, mockScrapedAt)).toEqual({ precision: "UNKNOWN" });
    expect(normalizePostingDate("completely unrecognized format", mockScrapedAt)).toEqual({ precision: "UNKNOWN" });
  });
});
