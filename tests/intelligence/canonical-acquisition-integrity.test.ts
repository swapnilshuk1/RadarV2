import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { ResponseValidator } from "@/lib/acquisition/validator";
import { classifyOpportunityCategories, resolveCanonicalCategoryId } from "@/lib/domain/category_taxonomy";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";

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

    it("classifies short job content (<50 chars) as INSUFFICIENT_CONTENT", () => {
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
      expect(res.failureClass).toBe("INSUFFICIENT_CONTENT");
    });

    it("classifies unprovenanced short job content (50-199 chars) as PARTIAL_CONTENT", () => {
      const res = ResponseValidator.validate({
        html: "<div>...</div>",
        url: "https://example.com/job/3-partial",
        sourcePortal: "Indeed",
        extractedTitle: "Chief Technology Officer",
        extractedCompany: "Gamma",
        extractedDescription: "Short preview between fifty and two hundred characters long without detail document origin.",
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

    it("rejects a substantive detail document whose extracted title conflicts with the listing", () => {
      const res = ResponseValidator.validate({
        html: "<div>job detail</div>",
        url: "https://example.com/job/identity-conflict",
        sourcePortal: "Indeed",
        extractedTitle: "Principal AI Engineer, Director",
        documentTitle: "Principal Engineer, Java, VP",
        extractedCompany: "NatWest",
        extractedDescription: "Java Spring Boot microservices Kubernetes architecture delivery ownership ".repeat(18),
      });

      expect(res.isValid).toBe(false);
      expect(res.failureClass).toBe("LISTING_DOCUMENT_IDENTITY_MISMATCH");
      expect(res.document.titleAgreement).toBe("MISMATCHED");
    });

    it("keeps an absent document title as UNKNOWN rather than inventing a mismatch", () => {
      const res = ResponseValidator.validate({
        html: "<div>job detail</div>",
        url: "https://example.com/job/no-document-title",
        sourcePortal: "Indeed",
        extractedTitle: "VP Growth",
        extractedCompany: "Acme",
        extractedDescription: "Own commercial growth, revenue operations, client strategy and executive leadership. ".repeat(12),
      });

      expect(res.isValid).toBe(true);
      expect(res.document.titleAgreement).toBe("UNKNOWN");
    });
  });

  describe("Category Taxonomy - Anti-Heuristic Verification", () => {
    it("resolves canonical category IDs and maintains classification consistency", () => {
      expect(resolveCanonicalCategoryId("Commercial Growth")).toBe("commercial_growth");
      expect(resolveCanonicalCategoryId("COMMERCIAL")).toBe("commercial_growth");
      expect(resolveCanonicalCategoryId("high_growth")).toBe("commercial_growth");
      expect(resolveCanonicalCategoryId("Transformation")).toBe("transformation");
      expect(resolveCanonicalCategoryId("Needs More Signal")).toBe("needs_more_signal");
      expect(resolveCanonicalCategoryId("Country Leadership")).toBe("country_leadership");
      expect(resolveCanonicalCategoryId("Platform & Digital")).toBe("platform_digital");

      const sampleOpp = {
        role: "VP Commercial Growth & Sales",
        description: "Drive revenue expansion and GTM strategy across APAC.",
        recommendation: "PURSUE",
        trueExecutiveMandate: "COMMERCIAL_EXPANSION",
      };

      const categories = classifyOpportunityCategories(sampleOpp);
      expect(categories).toContain("all");
      expect(categories).toContain("commercial_growth");
    });

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

  describe("CanonicalIngestionService - Orthogonal States & Recovery Ingestion", () => {
    it("keeps a discovery-card fallback out of canonical ingestion and recovery_queue", async () => {
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
      await expect(
        service.ingestOpportunity(
          {
            sourcePortal: "Indeed",
            sourceJobId: "job_short_123",
            canonicalUrl: "https://in.indeed.com/viewjob?jk=job_short_123",
            jobTitle: "VP of Sales",
            companyName: "Acme",
            location: "Remote",
            rawContent: "Short summary only 35 chars",
            contentOrigin: "DISCOVERY_CARD_FALLBACK",
          },
          {
            mode: "GLOBAL_MARKET",
          },
        ),
      ).rejects.toThrow("Cannot canonically ingest unusable document");

      expect(sqliteDb.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities").get()).toEqual({ count: 0 });
      expect(sqliteDb.prepare("SELECT COUNT(*) AS count FROM opportunity_versions").get()).toEqual({ count: 0 });
      expect(sqliteDb.prepare("SELECT COUNT(*) AS count FROM recovery_queue").get()).toEqual({ count: 0 });
    });

    it("remains idempotently non-admitting when the same failed capture is retried", async () => {
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

      const globalScope = {
        mode: "GLOBAL_MARKET" as const,
      };

      await expect(
        service.ingestOpportunity(
          {
            ...payload,
            contentOrigin: "DISCOVERY_CARD_FALLBACK",
          },
          globalScope,
        ),
      ).rejects.toThrow("Cannot canonically ingest unusable document");

      await expect(
        service.ingestOpportunity(
          {
            ...payload,
            contentOrigin: "DISCOVERY_CARD_FALLBACK",
          },
          globalScope,
        ),
      ).rejects.toThrow("Cannot canonically ingest unusable document");

      expect(sqliteDb.prepare("SELECT COUNT(*) AS count FROM canonical_opportunities").get()).toEqual({ count: 0 });
      expect(sqliteDb.prepare("SELECT COUNT(*) AS count FROM opportunity_versions").get()).toEqual({ count: 0 });
      expect(sqliteDb.prepare("SELECT COUNT(*) AS count FROM recovery_queue").get()).toEqual({ count: 0 });
    });
  });
});
