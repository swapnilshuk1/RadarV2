import { describe, expect, it } from "vitest";
import { collectDecidedFeedItems } from "../../src/lib/intelligence/opportunity-service";

describe("Decided opportunity population completeness", () => {
  it("follows the canonical cursor so the 51st decided opportunity remains reachable", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ jobHash: `job-${index + 1}` }));
    const finalItem = { jobHash: "job-51" };
    const calls: Array<unknown> = [];
    const queries = {
      getFeed: async (_scope: unknown, cursor: unknown, filters: unknown, pageSize: unknown) => {
        calls.push({ cursor, filters, pageSize });
        return cursor
          ? { items: [finalItem], nextCursor: undefined }
          : { items: firstPage, nextCursor: "cursor-after-50" };
      },
    };

    const items = await collectDecidedFeedItems(queries as any, {
      tenantId: "tenant_A",
      personId: "person_A",
      userId: "person_A",
      authContext: { tenantId: "tenant_A", userId: "person_A", role: "member", permissions: [] },
    } as any);

    expect(items).toHaveLength(51);
    expect(items.at(-1)?.jobHash).toBe("job-51");
    expect(calls).toEqual([
      { cursor: undefined, filters: { decisionFilter: "decided" }, pageSize: 50 },
      { cursor: "cursor-after-50", filters: { decisionFilter: "decided" }, pageSize: 50 },
    ]);
  });
});
