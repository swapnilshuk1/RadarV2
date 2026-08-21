import { describe, it, expect, beforeEach } from "vitest";
import { JobProjectionBuilder } from "../../src/lib/intelligence/builders/JobProjectionBuilder";

describe("JobProjectionBuilder Optimization & Cache Correctness", () => {
  beforeEach(() => {
    JobProjectionBuilder.clearCache();
  });

  const mockOpp1 = {
    jobHash: "hash-001",
    id: "hash-001",
    role: "VP of Growth",
    company: "Acme Corp",
    description: "Lead D2C growth, P&L management, performance marketing, and commercial scaling.",
    location: "Bengaluru",
    dimensions: []
  };

  const mockOpp2 = {
    jobHash: "hash-002",
    id: "hash-002",
    role: "Director of Engineering",
    company: "Tech Corp",
    description: "Lead cloud infrastructure, Java microservices, DevOps, and platform engineering.",
    location: "Remote",
    dimensions: []
  };

  it("Test A: Same opportunity evaluated twice results in buildCount === 1", () => {
    JobProjectionBuilder.resetMetrics();
    expect(JobProjectionBuilder.getBuildCount()).toBe(0);

    const proj1 = JobProjectionBuilder.build(mockOpp1);
    expect(JobProjectionBuilder.getBuildCount()).toBe(1);
    expect(JobProjectionBuilder.getCacheSize()).toBe(1);

    const proj2 = JobProjectionBuilder.build(mockOpp1);
    expect(JobProjectionBuilder.getBuildCount()).toBe(1); // Cached hit!
    expect(proj2.jobHash).toBe(proj1.jobHash);
    expect(proj2.role).toBe(proj1.role);
    expect(proj2.executiveIdentity).toEqual(proj1.executiveIdentity);
  });

  it("Test B: Two different jobHashes result in buildCount === 2", () => {
    JobProjectionBuilder.resetMetrics();

    JobProjectionBuilder.build(mockOpp1);
    JobProjectionBuilder.build(mockOpp2);

    expect(JobProjectionBuilder.getBuildCount()).toBe(2);
    expect(JobProjectionBuilder.getCacheSize()).toBe(2);
  });

  it("Test C: Same jobHash with equivalent reconstructed opportunity object hits cache", () => {
    JobProjectionBuilder.resetMetrics();

    const reconstructedOpp1 = { ...mockOpp1, description: "Lead D2C growth, P&L management..." };

    const proj1 = JobProjectionBuilder.build(mockOpp1);
    expect(JobProjectionBuilder.getBuildCount()).toBe(1);

    const projReconstructed = JobProjectionBuilder.build(reconstructedOpp1);
    expect(JobProjectionBuilder.getBuildCount()).toBe(1); // Cache hit despite new object reference
    expect(projReconstructed.originalOpportunity).toBe(reconstructedOpp1);
  });

  it("Test D: Cache isolation prevents cross-opportunity leaks", () => {
    const proj1 = JobProjectionBuilder.build(mockOpp1);
    const proj2 = JobProjectionBuilder.build(mockOpp2);

    expect(proj1.jobHash).toBe("hash-001");
    expect(proj2.jobHash).toBe("hash-002");
    expect(proj1.role).toBe("VP of Growth");
    expect(proj2.role).toBe("Director of Engineering");
    expect(proj1.executiveIdentity.value).toContain("Commercial");
    expect(proj2.executiveIdentity.value).toContain("Technology");
  });

  it("Test E: Cached output is behaviourally identical to uncached output", () => {
    const projUncached = JobProjectionBuilder.build(mockOpp1);

    JobProjectionBuilder.clearCache();

    const projFresh = JobProjectionBuilder.build(mockOpp1);

    expect(projFresh.jobHash).toBe(projUncached.jobHash);
    expect(projFresh.role).toBe(projUncached.role);
    expect(projFresh.company).toBe(projUncached.company);
    expect(projFresh.executiveIdentity).toEqual(projUncached.executiveIdentity);
    expect(projFresh.trueExecutiveMandate).toBe(projUncached.trueExecutiveMandate);
    expect(projFresh.operatingContext).toEqual(projUncached.operatingContext);
  });

  it("Test F: Process restart / clearCache resets cache cleanly", () => {
    JobProjectionBuilder.build(mockOpp1);
    expect(JobProjectionBuilder.getCacheSize()).toBe(1);

    JobProjectionBuilder.clearCache();
    expect(JobProjectionBuilder.getCacheSize()).toBe(0);
    expect(JobProjectionBuilder.getBuildCount()).toBe(0);

    JobProjectionBuilder.build(mockOpp1);
    expect(JobProjectionBuilder.getCacheSize()).toBe(1);
    expect(JobProjectionBuilder.getBuildCount()).toBe(1);
  });
});
