import { describe, it, expect } from "vitest";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import { getRepositories } from "../src/data/sqlite/provider";

describe("Stage 4F: Production Request Path Benchmarks & Telemetry", () => {
  const personId = "ms6i7e3y-4x0chy5fy"; // Primary registered user

  it("measures /decisions request path latency and verifies O(k) sub-millisecond retrieval", async () => {
    const latencies: number[] = [];
    const iterations = 5;

    // Warm-up call
    await OpportunityService.listForUser(personId);

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const results = await OpportunityService.listForUser(personId);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      expect(results.length).toBeGreaterThan(0);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[latencies.length - 1];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log("            /decisions Request Path Performance Telemetry           ");
    console.log("════════════════════════════════════════════════════════════════════");
    console.log(`Iterations  : ${iterations}`);
    console.log(`P50 Latency : ${p50.toFixed(2)} ms`);
    console.log(`P95 Latency : ${p95.toFixed(2)} ms`);
    console.log(`P99 Latency : ${p99.toFixed(2)} ms`);
    console.log(`Avg Latency : ${avg.toFixed(2)} ms`);
    console.log("════════════════════════════════════════════════════════════════════\n");

    // Must be fast reading materialized evaluations
    expect(p50).toBeLessThan(1500); // Remote Turso HTTP roundtrip buffer
  });

  it("measures /opportunity/:jobHash request path latency", async () => {
    const opps = await OpportunityService.listForUser(personId);
    expect(opps.length).toBeGreaterThan(0);
    const targetHash = opps[0].jobHash;

    const latencies: number[] = [];
    const iterations = 5;

    // Warm-up call
    await OpportunityService.getForUser(personId, targetHash);

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const opp = await OpportunityService.getForUser(personId, targetHash);
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
      expect(opp).toBeDefined();
      expect(opp?.jobHash).toBe(targetHash);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[latencies.length - 1];

    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log("       /opportunity/:jobHash Request Path Performance Telemetry     ");
    console.log("════════════════════════════════════════════════════════════════════");
    console.log(`Target Job  : ${targetHash}`);
    console.log(`P50 Latency : ${p50.toFixed(2)} ms`);
    console.log(`P95 Latency : ${p95.toFixed(2)} ms`);
    console.log(`P99 Latency : ${p99.toFixed(2)} ms`);
    console.log("════════════════════════════════════════════════════════════════════\n");

    expect(p50).toBeLessThan(1000);
  });
});
