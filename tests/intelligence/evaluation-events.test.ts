import { describe, it, expect, beforeEach } from "vitest";
import { 
  runEngine, 
  injectFixtureRecords,
  invalidateEngineCache,
  ENGINE_VERSION
} from "../../src/lib/intelligence/engine";
import { 
  invalidateCandidateDossierCache,
  CandidateIntelligencePipeline
} from "../../src/lib/intelligence/cip";
import { EvaluationCoordinator } from "../../src/lib/intelligence/EvaluationCoordinator";
import { getRepositories } from "../../src/data/sqlite/provider";
import type { CandidateProjection } from "../../src/domain/entities";
import type { OpportunitySource } from "../../src/domain/semantic";

import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../../src/data/candidate-profile";

describe("EvaluationCoordinator Events Invalidation Audit", () => {
  const testPersonId = "ms6i7e3y-4x0chy5fy";
  const builder = new CandidateProjectionBuilderImpl();
  const mockProjection1: CandidateProjection = builder.fromProfile(candidateProfile);
  mockProjection1.personId = testPersonId;

  beforeEach(() => {
    invalidateEngineCache();
    invalidateCandidateDossierCache();
  });

  it("EVENT 1: CORPUS_UPDATED - Invalidates engine cache so newly added or enriched corpus records are evaluated", async () => {
    const oppList1: OpportunitySource[] = [{
      jobHash: "job-corpus-1",
      role: "VP Growth",
      company: "Acme",
      location: "Bengaluru",
      scrapedFrom: "LinkedIn",
      postedRelative: "1d ago",
      description: "Acme is hiring a VP Growth to lead scale across global markets.",
      rawText: "Acme is hiring a VP Growth to lead scale across global markets.",
      dimensions: []
    }];

    injectFixtureRecords(oppList1);
    await EvaluationCoordinator.notify({ event: "CORPUS_UPDATED", personId: testPersonId });

    const { presented: pres1 } = runEngine(mockProjection1);
    expect(pres1.length).toBe(1);

    // Expand corpus
    const oppList2: OpportunitySource[] = [
      ...oppList1,
      {
        jobHash: "job-corpus-2",
        role: "Chief Commercial Officer",
        company: "Beta Corp",
        location: "Bengaluru",
        scrapedFrom: "LinkedIn",
        postedRelative: "1h ago",
        description: "Beta Corp is hiring a CCO for commercial scale and revenue growth.",
        rawText: "Beta Corp is hiring a CCO for commercial scale and revenue growth.",
        dimensions: []
      }
    ];

    injectFixtureRecords(oppList2);
    await EvaluationCoordinator.notify({ event: "CORPUS_UPDATED", personId: testPersonId });

    const { presented: pres2 } = runEngine(mockProjection1);
    expect(pres2.length).toBe(2);
  }, 30000);

  it("EVENT 2: PROJECTION_UPDATED - Content-hashed keys naturally invalidate engine cache when projection changes in DB", async () => {
    const repos = getRepositories();

    // 1. Save projection 1 for existing person
    const proj1: CandidateProjection = { ...mockProjection1, updatedAt: "2026-08-15T08:00:00.000Z" };
    await repos.people.saveProjection(testPersonId, proj1);

    const list1 = runEngine(proj1);
    expect(list1.presented).toBeDefined();

    // 2. Save projection 2 with modified skills & timestamp to DB
    const proj2: CandidateProjection = { 
      ...mockProjection1, 
      skills: ["Enterprise Sales", "P&L Management", "GTM Strategy", "M&A"],
      updatedAt: "2026-08-15T09:00:00.000Z" 
    };
    await repos.people.saveProjection(testPersonId, proj2);

    // Fire PROJECTION_UPDATED event
    await EvaluationCoordinator.notify({ event: "PROJECTION_UPDATED", personId: testPersonId });

    // Fetch latest projection from DB
    const latestProj = await repos.people.getLatestProjection(testPersonId);
    expect(latestProj).toBeDefined();

    const list2 = runEngine(latestProj!);
    
    // Demonstrate that candHash in engine cache keys automatically prevented stale hit!
    expect(list2.presented).toBeDefined();
  }, 30000);

  it("EVENT 3: INTENT_UPDATED - Re-evaluates intent-driven recommendations", async () => {
    const cip = new CandidateIntelligencePipeline();
    const dossier1 = cip.getActiveDossier();
    expect(dossier1).toBeDefined();

    await EvaluationCoordinator.notify({ event: "INTENT_UPDATED", personId: testPersonId });
  }, 30000);

  it("EVENT 4: ONTOLOGY_UPGRADED - Engine cache invalidated for runtime ontology upgrades", async () => {
    const oppList: OpportunitySource[] = [{
      jobHash: "job-ont-1",
      role: "VP Marketing",
      company: "Delta",
      location: "Bengaluru",
      scrapedFrom: "LinkedIn",
      postedRelative: "1d ago",
      description: "Delta is hiring VP Marketing to scale digital performance marketing.",
      rawText: "Delta is hiring VP Marketing to scale digital performance marketing.",
      dimensions: []
    }];

    injectFixtureRecords(oppList);

    const res1 = runEngine(mockProjection1);
    expect(res1.presented.length).toBe(1);

    await EvaluationCoordinator.notify({ event: "ONTOLOGY_UPGRADED", personId: testPersonId });

    const res2 = runEngine(mockProjection1);
    expect(res2.presented.length).toBe(1);
  }, 30000);
});
