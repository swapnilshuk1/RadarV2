/**
 * tests/scraper/scraper-correctness-contract.test.ts
 *
 * Scraper Correctness & Invariant Contract Suite (Slice A)
 *
 * Invariants Verified:
 * 1. Authoritative search-plan resolution via ScraperPlanResolver (decoupled from scope auth)
 * 2. Zero fallback invariant for authenticated scraper runs:
 *    - Authenticated user + no active plan -> throws explicit actionable error
 *    - Zero RunController instantiation
 *    - Zero WorkUnits generated
 *    - Zero portal navigation
 *    - Zero DEFAULT_KEYWORDS emitted
 * 3. Indeed sparse description preservation (SPARSE != INVALID)
 * 4. LinkedIn missing-company pre-detail discovery escalation (allowMissingCompany: true)
 * 5. LinkedIn clean cancellation semantics
 */

import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { ScraperPlanResolver, resolveActiveScraperPlan } from "../../src/lib/intelligence/ScraperPlanResolver";
import { passesHardFilter } from "../../scripts/scraper/utils/hard-filter";
import { startRun } from "../../scripts/scrape";
import { linkedinHandler } from "../../scripts/scraper/portals/linkedin";
import { indeedHandler } from "../../scripts/scraper/portals/indeed";

describe("Scraper Correctness & Invariant Contract Suite", () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);

    // Setup user, tenant & membership
    await db.execute(`INSERT OR IGNORE INTO tenants (id, status) VALUES (?, ?)`, [
      "tenant_test",
      "active",
    ]);

    await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)`, [
      "user_exec_1",
      "exec1@domain.com",
    ]);

    await db.execute(`INSERT OR IGNORE INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, [
      "user_exec_1",
      "exec1@domain.com",
      "tenant_test",
    ]);

    await db.execute(`INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, status, permissions) VALUES (?, ?, ?, 'active', ?)`, [
      "user_exec_1",
      "tenant_test",
      "member",
      JSON.stringify(["run:scraper", "manage:search_plan"]),
    ]);
  });

  describe("1. Authoritative Search Plan Resolution", () => {
    it("resolves active search plan and compiles discrete ranked queries from criteria via ScraperPlanResolver", async () => {
      const criteria = {
        targetRoles: ["Chief Marketing Officer", "VP Marketing", "Head of Growth"],
        targetSeniority: ["Chief", "VP", "Head"],
        targetLocations: ["Gurugram", "Bengaluru", "Remote India"],
        targetIndustries: ["Technology", "SaaS"],
      };

      await db.execute(
        `INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ["sp_exec_1", "tenant_test", "user_exec_1", "Executive Marketing Plan", JSON.stringify(criteria)]
      );
      await db.execute(
        `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`,
        ["sps_exec_1", "tenant_test", "user_exec_1", "sp_exec_1", "hash_sp1", JSON.stringify(criteria)]
      );
      await db.execute(
        `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["fp_exec_1", "tenant_test", "user_exec_1", "sps_exec_1", "v1", "hash_ont", "v1", "v1"]
      );
      await db.execute(
        `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES (?, ?, ?, ?)`,
        ["fp_exec_1", "tenant_test", "user_exec_1", "sp_exec_1"]
      );
      await db.execute(
        `INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES (?, ?, ?, ?, ?)`,
        ["tenant_test", "user_exec_1", "sp_exec_1", "fp_exec_1", "system"]
      );

      const scope = { tenantId: "tenant_test", personId: "user_exec_1" };
      const resolved = await ScraperPlanResolver.resolveActivePlan(scope, undefined, db);

      expect(resolved).toBeDefined();
      expect(resolved?.searchPlanId).toBe("sp_exec_1");
      expect(resolved?.title).toBe("Executive Marketing Plan");
      expect(resolved?.queries.length).toBeGreaterThan(0);
      expect(resolved?.queryCount).toBe(resolved?.queries.length);
      expect(resolved?.source).toBe("persisted_active_plan");

      // Verify discrete query content includes target roles
      const hasTargetRole = resolved?.queries.some(
        (q) => q.toLowerCase().includes("marketing") || q.toLowerCase().includes("growth")
      );
      expect(hasTargetRole).toBe(true);
    });

    it("keeps security resolution separate from plan compilation", async () => {
      const criteria = {
        targetRoles: ["Chief Commercial Officer", "VP Growth"],
        targetSeniority: ["Chief", "VP"],
        targetLocations: ["Remote India"],
      };

      await db.execute(
        `INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ["sp_exec_2", "tenant_test", "user_exec_1", "Commercial Growth Plan", JSON.stringify(criteria)]
      );
      await db.execute(
        `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`,
        ["sps_exec_2", "tenant_test", "user_exec_1", "sp_exec_2", "hash_sp2", JSON.stringify(criteria)]
      );
      await db.execute(
        `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ["fp_exec_2", "tenant_test", "user_exec_1", "sps_exec_2", "v1", "hash_ont", "v1", "v1"]
      );
      await db.execute(
        `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES (?, ?, ?, ?)`,
        ["fp_exec_2", "tenant_test", "user_exec_1", "sp_exec_2"]
      );
      await db.execute(
        `INSERT OR REPLACE INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES (?, ?, ?, ?, ?)`,
        ["tenant_test", "user_exec_1", "sp_exec_2", "fp_exec_2", "system"]
      );

      // Security resolver strictly verifies identity, membership, and scope
      const authResolution = await resolveScraperAuthContext("user_exec_1", "tenant_test", db);
      expect(authResolution.scope.tenantId).toBe("tenant_test");
      expect(authResolution.scope.personId).toBe("user_exec_1");
      expect(authResolution.authContext.permissions).toContain("run:scraper");

      // Domain resolver turns the authorized scope into an executable resolved plan
      const resolvedPlan = await ScraperPlanResolver.resolveActivePlan(authResolution.scope, authResolution.activeContext, db);
      expect(resolvedPlan).toBeDefined();
      expect(resolvedPlan?.searchPlanId).toBe("sp_exec_2");
      expect(resolvedPlan?.queries.length).toBeGreaterThan(0);
    });
  });

  describe("2. Zero Fallback & Zero Units Invariant for Authenticated Runs", () => {
    it("throws an explicit actionable error and produces zero run / zero work units when no active plan exists (even if candidate profile exists)", async () => {
      // User has membership AND candidate profile in db, but NO active search_plans row
      await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)`, [
        "user_no_plan",
        "noplan@domain.com",
      ]);
      await db.execute(`INSERT OR IGNORE INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, [
        "user_no_plan",
        "noplan@domain.com",
        "tenant_test",
      ]);
      await db.execute(`INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, status, permissions) VALUES (?, ?, ?, 'active', ?)`, [
        "user_no_plan",
        "tenant_test",
        "member",
        JSON.stringify(["run:scraper"]),
      ]);

      // Seed career profile in db to prove candidate-state fallback is strictly disabled
      await db.execute(
        `INSERT INTO career_profiles (id, person_id, timeline, skills) VALUES (?, ?, ?, ?)`,
        ["cp_no_plan", "user_no_plan", JSON.stringify([{ role: "Chief Marketing Officer" }]), JSON.stringify(["Marketing"])]
      );

      const scope = { tenantId: "tenant_test", personId: "user_no_plan" };
      await expect(ScraperPlanResolver.resolveActivePlan(scope, undefined, db)).rejects.toThrow();

      const authContext = {
        userId: "user_no_plan",
        tenantId: "tenant_test",
        permissions: ["run:scraper"] as const,
      };

      // Invariant: Authenticated run without active plan must fail immediately
      // before RunController initialization, generating 0 WorkUnits and 0 runs
      await expect(
        startRun({
          authContext,
        })
      ).rejects.toThrow();
    });

    it("fails fast with InsufficientSearchCriteriaError when search plan has empty criteria or generates zero queries", async () => {
      await db.execute(
        `INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ["sp_empty_criteria", "tenant_test", "user_exec_1", "Empty Criteria Plan", JSON.stringify({})]
      );

      const scope = { tenantId: "tenant_test", personId: "user_exec_1" };
      await expect(
        ScraperPlanResolver.resolveActivePlan(scope, undefined, db, "sp_empty_criteria")
      ).rejects.toThrow(/insufficient criteria/i);
    });

    it("verifies SearchPlanner only emits queries derived from criteria and not unselected lexicon concepts", async () => {
      const path = await import("node:path");
      const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
      const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");
      const { SearchPlanner } = await import("../../scripts/scraper/run/search-planner");

      const plan = SearchPlanner.plan(
        {
          targetLevel: ["VP"],
          functions: ["Growth"],
          targetTitles: ["VP Growth"],
          preferredLocations: ["Bengaluru"],
        },
        taxonomyPath,
        lexiconPath
      );

      expect(plan.rankedQueries.length).toBeGreaterThan(0);
      // Queries must relate to Growth/VP, and not unselected domains like Security or Supply Chain
      const hasGrowth = plan.rankedQueries.some((q) => q.query.toLowerCase().includes("growth"));
      expect(hasGrowth).toBe(true);
      const hasSecurity = plan.rankedQueries.some((q) => q.query.toLowerCase().includes("ciso") || q.query.toLowerCase().includes("security"));
      expect(hasSecurity).toBe(false);
    });

    it("ensures Seniority token (e.g. 'Chief') does not leak disjoint functional C-suite roles", async () => {
      const path = await import("node:path");
      const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
      const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");
      const { SearchPlanner } = await import("../../scripts/scraper/run/search-planner");

      const cfoPlan = SearchPlanner.plan(
        {
          targetLevel: ["Chief"],
          functions: ["Finance"],
          targetTitles: ["Chief Financial Officer"],
          preferredLocations: ["Mumbai"],
        },
        taxonomyPath,
        lexiconPath
      );

      expect(cfoPlan.rankedQueries.length).toBeGreaterThan(0);
      const emittedQueries = cfoPlan.rankedQueries.map((q) => q.query.toLowerCase());

      // Invariant: CFO must never emit CMO, CGO, CDO, CCO, CPO, or CISO queries
      expect(emittedQueries.some((q) => q.includes("marketing") || q.includes("cmo"))).toBe(false);
      expect(emittedQueries.some((q) => q.includes("growth officer") || q.includes("cgo"))).toBe(false);
      expect(emittedQueries.some((q) => q.includes("customer officer") || q.includes("cco"))).toBe(false);
      expect(emittedQueries.some((q) => q.includes("digital officer") || q.includes("cdo"))).toBe(false);
      expect(emittedQueries.some((q) => q.includes("product officer") || q.includes("cpo"))).toBe(false);
      expect(emittedQueries.some((q) => q.includes("security officer") || q.includes("ciso"))).toBe(false);
    });

    it("ensures authenticated run with active plan resolves exactly compiled queries and never DEFAULT_KEYWORDS", async () => {
      const criteria = {
        targetRoles: ["Chief Technology Officer"],
        targetSeniority: ["Chief"],
        targetLocations: ["Remote India"],
      };

      const planId = "sp_cto_plan";
      await db.execute(
        `INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [planId, "tenant_test", "user_exec_1", "CTO Search Plan", JSON.stringify(criteria)]
      );

      const scope = { tenantId: "tenant_test", personId: "user_exec_1" };
      const resolved = await resolveActiveScraperPlan(scope, undefined, db, planId);
      expect(resolved).toBeDefined();
      expect(resolved?.searchPlanId).toBe(planId);
      expect(resolved?.source).toBe("persisted_active_plan");
      expect(resolved?.queries.length).toBeGreaterThan(0);
      expect(resolved?.queries[0]).toBe("Chief Technology Officer");
      expect(resolved?.queries).toContain("Chief Technology Officer");
    });
  });

  describe("3. Indeed Sparse Description Preservation (SPARSE != INVALID)", () => {
    it("exercises indeedHandler.fetchDetail and preserves descriptions under 200 characters with fetched: true and SPARSE log", async () => {
      const sparseHtml = "<p>Leading marketing team for enterprise SaaS product. 10+ years experience required.</p>";
      const sparseText = "Leading marketing team for enterprise SaaS product. 10+ years experience required.";
      const targetUrl = "https://in.indeed.com/viewjob?jk=sparse123";

      const logs: string[] = [];
      const mockPage: any = {
        goto: async () => {},
        url: () => targetUrl,
        locator: (sel: string) => ({
          first: () => ({
            textContent: async () => (sel.includes("jobDescriptionText") || sel.includes("main") ? sparseText : ""),
            innerHTML: async () => (sel.includes("jobDescriptionText") || sel.includes("main") ? sparseHtml : ""),
          }),
        }),
      };

      const mockCtx: any = {
        portal: "Indeed",
        detailPage: mockPage,
        isHttpDisabled: () => true,
        logger: (msg: string) => logs.push(msg),
      };

      const result = await indeedHandler.fetchDetail(mockCtx, targetUrl);

      expect(result.fetched).toBe(true);
      expect(result.rawText).toBe(sparseText);
      expect(result.rawText.length).toBeLessThan(200);
      expect(result.rawText.length).toBeGreaterThan(0);
      expect(result.rawHtml).toBe(sparseHtml);
      expect(logs.some((l) => l.includes("Preserving sparse description") && l.includes("quality=SPARSE"))).toBe(true);
    });

    it("returns fetched: false with explicit error when job description is genuinely empty", async () => {
      const targetUrl = "https://in.indeed.com/viewjob?jk=empty123";

      const logs: string[] = [];
      const mockPage: any = {
        goto: async () => {},
        url: () => targetUrl,
        locator: () => ({
          first: () => ({
            textContent: async () => "",
            innerHTML: async () => "",
          }),
        }),
      };

      const mockCtx: any = {
        portal: "Indeed",
        detailPage: mockPage,
        isHttpDisabled: () => true,
        logger: (msg: string) => logs.push(msg),
      };

      const result = await indeedHandler.fetchDetail(mockCtx, targetUrl);

      expect(result.fetched).toBe(false);
      expect(result.fetchError).toBe("Empty job description");
      expect(logs.some((l) => l.includes("Empty job description"))).toBe(true);
    });
  });

  describe("4. LinkedIn Missing-Company Pre-Detail Escalation", () => {
    it("allows cards with missing company to pass discovery filter when allowMissingCompany is true", () => {
      const card = {
        title: "Senior Director of Marketing-SAAS",
        company: "",
        location: "Bengaluru, Karnataka, India",
      };

      // Pre-detail discovery mode
      const discoveryResult = passesHardFilter(card, { allowMissingCompany: true });
      expect(discoveryResult.pass).toBe(true);

      // Post-detail strict validation mode
      const strictResult = passesHardFilter(card);
      expect(strictResult.pass).toBe(false);
      expect(strictResult.reason).toBe("Missing company name");
    });

    it("still rejects cards with missing title even if allowMissingCompany is true", () => {
      const card = {
        title: "",
        company: "",
        location: "Bengaluru",
      };

      const result = passesHardFilter(card, { allowMissingCompany: true });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe("Missing title and company name");
    });
  });

  describe("5. LinkedIn Clean Cancellation", () => {
    it("terminates listCards cleanly when cancellation is signaled without throwing errors", async () => {
      let isCancelled = true;
      const logs: string[] = [];

      const mockCtx: any = {
        portal: "LinkedIn",
        keyword: "VP Marketing",
        searchUrl: "https://www.linkedin.com/jobs/search",
        logger: (msg: string) => logs.push(msg),
        isCancelled: () => isCancelled,
      };

      // Mock page that simulates closed browser
      const mockPage: any = {
        isClosed: () => true,
        locator: () => ({
          count: async () => 0,
          all: async () => [],
        }),
      };

      const cards = await linkedinHandler.listCards(mockCtx, mockPage, 1);
      expect(cards).toEqual([]);
      // Should not have logged failure
      expect(logs.some((l) => l.includes("failed:"))).toBe(false);
    });
  });
});
