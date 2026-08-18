import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpportunityService } from "@/lib/intelligence/opportunity-service";
import { runEngine, runEngineSingle, invalidateEngineCache } from "@/lib/intelligence/engine";
import { getRepositories } from "@/data/sqlite/provider";
import { getDatabaseAdapter, resetDatabaseAdapter } from "@/data/database";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { CandidateProjection } from "@/lib/domain/candidate_projection";
import fs from "node:fs";
import path from "node:path";

// Valid test projection aligned with evaluation engine requirements
const mockProjection: CandidateProjection = {
  id: "cand-runtime-1",
  personId: "test-runtime-user",
  timeline: [],
  skills: ["Commercial Leadership", "GTM Strategy"],
  claims: [],
  coreCapabilities: ["Commercial Leadership", "GTM Strategy"],
  preferredLocations: ["Bengaluru", "Remote"],
  preferredWorkModel: "HYBRID",
  workModelPreference: "HYBRID",
  executiveThemes: ["Enterprise Scaling", "GTM Execution"],
  yearsOfExperience: 18,
  updatedAt: "2026-08-16T00:00:00.000Z",
  executiveIdentity: {
    value: "Commercial & Marketing Leadership",
    confidence: 0.95,
    evidence: ["VP Commercial"],
  },
  operatingLevel: {
    value: "EXECUTIVE",
    confidence: 0.95,
    evidence: ["VP Level"],
  },
  workNature: {
    value: "STRATEGIC",
    confidence: 0.95,
    evidence: ["P&L Ownership"],
  },
  decisionAuthority: {
    value: "AUTHORITATIVE",
    confidence: 0.95,
    evidence: ["Final Decision Maker"],
  },
  commercialScope: {
    value: "ENTERPRISE",
    confidence: 0.95,
    evidence: ["Multi-Million Revenue"],
  },
} as any;

describe("RADAR Stage 2A: Runtime Persistence Unification & Source-of-Truth", () => {
  beforeEach(() => {
    invalidateEngineCache();
  });

  afterEach(() => {
    invalidateEngineCache();
    resetDatabaseAdapter();
    vi.restoreAllMocks();
  });

  it("1. OpportunityService loads opportunities through repository/DatabaseAdapter path", async () => {
    const repos = getRepositories();
    expect(repos.opportunities).toBeDefined();
    expect(typeof repos.opportunities.listOpportunitySources).toBe("function");

    const mockUser = "test-runtime-user-1";
    vi.spyOn(repos.people, "getLatestProjection").mockResolvedValue(mockProjection);
    vi.spyOn(repos.decisions, "getUserDecisions").mockResolvedValue({});

    const mockOppSources: OpportunitySource[] = [
      {
        jobHash: "j-mock-runtime-001",
        role: "VP of Commercial",
        company: "Acme Cloud",
        location: "Bengaluru (Hybrid)",
        scrapedFrom: "LinkedIn",
        postedRelative: "1 day ago",
        rawText: "VP of Commercial to lead enterprise SaaS revenue scaling.",
        dimensions: [],
        primaryConcern: null,
        positioning: ["Enterprise SaaS"],
      },
      {
        jobHash: "j-mock-runtime-002",
        role: "Chief Commercial Officer",
        company: "Beta Systems",
        location: "Remote",
        scrapedFrom: "LinkedIn",
        postedRelative: "3 days ago",
        rawText: "CCO for global enterprise software distribution.",
        dimensions: [],
        primaryConcern: null,
        positioning: ["Global Software"],
      },
    ];

    const listOppSourcesSpy = vi.spyOn(repos.opportunities, "listOpportunitySources").mockResolvedValue(mockOppSources);

    const results = await OpportunityService.listForUser(mockUser);

    expect(listOppSourcesSpy).toHaveBeenCalledTimes(1);
    expect(results.length).toBe(2);
    expect(results.map((r) => r.jobHash)).toContain("j-mock-runtime-001");
    expect(results.map((r) => r.jobHash)).toContain("j-mock-runtime-002");
  });

  it("2. Engine does not directly read live-scraped.json or radar.sqlite from filesystem", () => {
    const engineFilePath = path.resolve(__dirname, "../src/lib/intelligence/engine.ts");
    const engineFileContent = fs.readFileSync(engineFilePath, "utf-8");

    // Verify engine source code does not read live-scraped.json or instantiate better-sqlite3
    expect(engineFileContent).not.toContain("live-scraped.json");
    expect(engineFileContent).not.toContain("radar.sqlite");
    expect(engineFileContent).not.toContain("better-sqlite3");
    expect(engineFileContent).not.toContain("fs.readFileSync");
  });

  it("3. Repository-provided records reach the engine without filesystem dependency", () => {
    const syntheticRecords: OpportunitySource[] = [
      {
        jobHash: "j-synthetic-101",
        role: "Chief Commercial Officer",
        company: "In-Memory Tech",
        location: "Remote",
        scrapedFrom: "LinkedIn",
        postedRelative: "Just now",
        rawText: "CCO needed for enterprise revenue acceleration.",
        dimensions: [],
        primaryConcern: null,
        positioning: ["Commercial"],
      },
    ];

    const { presented, records } = runEngine(mockProjection, 0, syntheticRecords);

    expect(presented.length).toBe(1);
    expect(presented[0].opportunity.jobHash).toBe("j-synthetic-101");
    expect(records.length).toBe(1);
    expect(records[0].jobHash).toBe("j-synthetic-101");
  });

  it("4. Missing JD/document data does not crash evaluation and is routed safely without errors", () => {
    const sparseRecord: OpportunitySource = {
      jobHash: "j-sparse-no-doc",
      role: "VP Operations",
      company: "Ghost Corp",
      location: "Mumbai",
      scrapedFrom: "Naukri",
      postedRelative: "5 days ago",
      rawText: "", // Empty rawText simulates missing document payload
      dimensions: [],
      primaryConcern: null,
      positioning: [],
    };

    expect(() => {
      const { presented, records } = runEngine(mockProjection, 0, [sparseRecord]);
      expect(presented.length).toBe(1);
      expect(presented[0].opportunity.jobHash).toBe("j-sparse-no-doc");
      expect(presented[0].opportunity.decision).toBeDefined();
      expect(records.length).toBe(1);
    }).not.toThrow();
  });

  it("5. Production database misconfiguration throws an explicit error instead of silent SQLite fallback", () => {
    const origEnv = { ...process.env };

    try {
      // Simulate production environment with missing Turso credentials
      process.env.NODE_ENV = "production";
      process.env.TURSO_CONNECTION_URL = "";
      process.env.TURSO_DATABASE_URL = "";
      process.env.TURSO_AUTH_TOKEN = "";

      resetDatabaseAdapter();

      expect(() => {
        getDatabaseAdapter();
      }).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment/);
    } finally {
      process.env = origEnv;
      resetDatabaseAdapter();
    }
  });

  it("6. Single opportunity lookup (getForUser) queries repository and evaluates correctly", async () => {
    const repos = getRepositories();
    const mockUser = "test-runtime-user-single";
    vi.spyOn(repos.people, "getLatestProjection").mockResolvedValue(mockProjection);
    vi.spyOn(repos.decisions, "getUserDecisions").mockResolvedValue({});

    const mockSingleOpp: OpportunitySource = {
      jobHash: "j-single-target",
      role: "VP of Growth",
      company: "Scale Systems",
      location: "Bengaluru",
      scrapedFrom: "LinkedIn",
      postedRelative: "Today",
      rawText: "VP Growth to scale enterprise revenue channels.",
      dimensions: [],
      primaryConcern: null,
      positioning: ["Growth"],
    };

    vi.spyOn(repos.opportunities, "listOpportunitySources").mockResolvedValue([]);
    const getOppSpy = vi.spyOn(repos.opportunities, "getOpportunitySource").mockResolvedValue(mockSingleOpp);

    const opp = await OpportunityService.getForUser(mockUser, "j-single-target");

    expect(getOppSpy).toHaveBeenCalledWith("j-single-target");
    expect(opp).toBeDefined();
    expect(opp?.jobHash).toBe("j-single-target");
    expect(opp?.role).toBe("VP of Growth");
  });
});
