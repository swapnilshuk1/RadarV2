import { describe, it, expect, vi } from "vitest";
import { SqliteOpportunityStore } from "../../src/data/sqlite/repositories/SqliteOpportunityStore";
import type { DatabaseAdapter } from "../../src/data/database/adapter";

describe("Gate 2: Singleflight Request Coalescing", () => {
  it("coalesces 5 concurrent cold requests into exactly 1 database query", async () => {
    let queryCount = 0;

    // Mock DatabaseAdapter with a 50ms delayed query
    const mockDb: DatabaseAdapter = {
      one: vi.fn(),
      many: vi.fn(async () => {
        queryCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [
          {
            id: "j-03b75f450eb3",
            canonical_title: "VP Marketing",
            company_name: "GrowthCorp",
            location: "Bengaluru",
            doc_content: JSON.stringify({ jobHash: "j-03b75f450eb3" }),
          },
        ];
      }),
      execute: vi.fn(),
      transaction: vi.fn(),
    };

    const store = new SqliteOpportunityStore(mockDb);

    // Fire 5 concurrent requests simultaneously
    const results = await Promise.all([
      store.listOpportunitySources(),
      store.listOpportunitySources(),
      store.listOpportunitySources(),
      store.listOpportunitySources(),
      store.listOpportunitySources(),
    ]);

    // All 5 callers receive identical result arrays
    expect(results).toHaveLength(5);
    expect(results[0]).toHaveLength(1);
    expect(results[0][0].jobHash).toEqual("j-03b75f450eb3");
    expect(results[4][0].jobHash).toEqual("j-03b75f450eb3");

    // CRITICAL PROOF: Exactly 1 database query was fired
    expect(queryCount).toBe(1);
  });
});
