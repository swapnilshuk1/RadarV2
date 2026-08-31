import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import {
  invalidateEngineCache,
  runEngineSingleIntrinsic,
} from "../../src/lib/intelligence/engine";
import { JobProjectionBuilder } from "../../src/lib/intelligence/builders/JobProjectionBuilder";
import { DEFAULT_CANDIDATE_PROJECTION } from "../../src/lib/domain/candidate_projection";
import type { OpportunitySource } from "../../src/data/opportunity-fixtures";

describe("EvaluationArtifact Intrinsic Boundary", () => {
  beforeEach(() => {
    invalidateEngineCache();
    JobProjectionBuilder.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("runEngineSingleIntrinsic returns the exact JobProjection identity used during scoring", () => {
    const mockOpp: OpportunitySource = {
      jobHash: "test_job_1",
      id: "source_id_123",
      role: "VP Engineering",
      company: "Acme Corp",
      location: "Remote",
      rawDescription: "We are looking for an experienced VP of Engineering to lead our distributed software architecture and product delivery teams across multiple regions with full technical and hiring accountability.",
      rawText: "We are looking for an experienced VP of Engineering to lead our distributed software architecture and product delivery teams across multiple regions with full technical and hiring accountability.",
      dimensions: []
    } as any;

    const buildSpy = vi.spyOn(JobProjectionBuilder, "build");

    const artifact = runEngineSingleIntrinsic("test_job_1", DEFAULT_CANDIDATE_PROJECTION, 0, [mockOpp]);

    expect(artifact).toBeDefined();
    if (!artifact) return;

    expect(artifact.jobProjection).toBeDefined();
    expect(artifact.jobProjection.jobHash).toBe("test_job_1");
    expect(artifact.jobProjection.role).toBe("VP Engineering");
    expect(artifact.record.jobHash).toBe("test_job_1");
    
    expect((artifact as any).presented).toBeUndefined();
    expect((artifact as any).opportunity).toBeUndefined();
    expect((artifact as any).narrative).toBeUndefined();
    expect((artifact as any).semanticAdvisory).toBeUndefined();
    expect((artifact.record as any).semanticAdvisory).toBeUndefined();
  });
});
