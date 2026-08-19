import { describe, it, expect } from "vitest";

describe("Stage 3F — Comparison Construction Optimization", () => {
  function computeComparisonsUnoptimized(records: { jobHash: string; priority: number | null }[]) {
    return records.map((r) => {
      const rPriority = r.priority ?? 0;
      const higherThan = records.filter((other) => (other.priority ?? 0) < rPriority).map((other) => other.jobHash);
      const lowerThan = records.filter((other) => (other.priority ?? 0) > rPriority).map((other) => other.jobHash);
      return { jobHash: r.jobHash, higherThan, lowerThan };
    });
  }

  function computeComparisonsOptimized(records: { jobHash: string; priority: number | null }[]) {
    const comparisonCache = new Map<number, { higherThan: string[]; lowerThan: string[] }>();

    return records.map((r) => {
      const rPriority = r.priority ?? 0;
      let comp = comparisonCache.get(rPriority);
      if (!comp) {
        const higherThan = records.filter((other) => (other.priority ?? 0) < rPriority).map((other) => other.jobHash);
        const lowerThan = records.filter((other) => (other.priority ?? 0) > rPriority).map((other) => other.jobHash);
        comp = { higherThan, lowerThan };
        comparisonCache.set(rPriority, comp);
      }
      return { jobHash: r.jobHash, higherThan: comp.higherThan, lowerThan: comp.lowerThan };
    });
  }

  it("produces 100% identical outputs for unique priorities", () => {
    const mockRecords = [
      { jobHash: "job-1", priority: 90 },
      { jobHash: "job-2", priority: 70 },
      { jobHash: "job-3", priority: 50 },
      { jobHash: "job-4", priority: 30 }
    ];

    const unoptimized = computeComparisonsUnoptimized(mockRecords);
    const optimized = computeComparisonsOptimized(mockRecords);

    expect(optimized).toEqual(unoptimized);
  });

  it("produces 100% identical outputs for equal/duplicate priorities", () => {
    const mockRecords = [
      { jobHash: "job-1", priority: 80 },
      { jobHash: "job-2", priority: 80 },
      { jobHash: "job-3", priority: 50 },
      { jobHash: "job-4", priority: 50 }
    ];

    const unoptimized = computeComparisonsUnoptimized(mockRecords);
    const optimized = computeComparisonsOptimized(mockRecords);

    expect(optimized).toEqual(unoptimized);
  });

  it("handles minimum, maximum, and null priorities identically", () => {
    const mockRecords = [
      { jobHash: "job-max", priority: 100 },
      { jobHash: "job-mid1", priority: 50 },
      { jobHash: "job-mid2", priority: 50 },
      { jobHash: "job-min", priority: 0 },
      { jobHash: "job-null", priority: null }
    ];

    const unoptimized = computeComparisonsUnoptimized(mockRecords);
    const optimized = computeComparisonsOptimized(mockRecords);

    expect(optimized).toEqual(unoptimized);
  });

  it("preserves exact array ordering and length for sparse/non-sparse mixtures", () => {
    const mockRecords = Array.from({ length: 500 }, (_, i) => ({
      jobHash: `job-${i}`,
      priority: i % 10 === 0 ? null : (i % 5) * 20
    }));

    const unoptimized = computeComparisonsUnoptimized(mockRecords);
    const optimized = computeComparisonsOptimized(mockRecords);

    expect(optimized).toEqual(unoptimized);
  });
});
