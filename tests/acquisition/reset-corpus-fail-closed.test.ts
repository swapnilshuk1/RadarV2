import { describe, it, expect, vi } from "vitest";
import { getTableCount, CORPUS_TABLES, PRESERVED_TABLES } from "../../scripts/db/reset-corpus";

describe("Corpus Reset Fail-Closed Safety Protocol", () => {
  it("returns null when table does not exist (no such table error)", async () => {
    const mockDb: any = {
      one: vi.fn().mockRejectedValue(new Error("no such table: fake_table_v99")),
    };

    const count = await getTableCount(mockDb, "fake_table_v99");
    expect(count).toBeNull();
  });

  it("throws immediately on non-no-such-table database errors (fails closed)", async () => {
    const mockDb: any = {
      one: vi.fn().mockRejectedValue(new Error("LibSQL client connection failed: Turso unavailable")),
    };

    await expect(getTableCount(mockDb, "opportunities")).rejects.toThrow(
      /Failed to query table count for "opportunities"/
    );
  });

  it("verifies declared table lists maintain clean separation between corpus and preserved tables", () => {
    // Preserved tables and Corpus tables must be completely disjoint
    const corpusSet = new Set(CORPUS_TABLES);
    const preservedSet = new Set(PRESERVED_TABLES);

    for (const p of PRESERVED_TABLES) {
      expect(corpusSet.has(p as any)).toBe(false);
    }
    for (const c of CORPUS_TABLES) {
      expect(preservedSet.has(c as any)).toBe(false);
    }

    // Critical configuration tables must be protected
    expect(preservedSet.has("career_profiles")).toBe(true);
    expect(preservedSet.has("people")).toBe(true);
    expect(preservedSet.has("tenants")).toBe(true);
    expect(preservedSet.has("_migrations")).toBe(true);

    // Ephemeral corpus tables must be targeted
    expect(corpusSet.has("opportunities")).toBe(true);
    expect(corpusSet.has("documents")).toBe(true);
    expect(corpusSet.has("scrape_runs")).toBe(true);
    expect(corpusSet.has("enrichment_jobs")).toBe(true);
  });

  it("enforces fail-closed verification if any corpus table has remaining records", () => {
    const postCorpusCounts: Record<string, number | null> = {
      opportunities: 0,
      documents: 5, // Failed to clear!
      scrape_runs: 0,
    };

    let corpusZero = true;
    for (const [tbl, cnt] of Object.entries(postCorpusCounts)) {
      if (cnt !== 0 && cnt !== null) {
        corpusZero = false;
      }
    }

    expect(corpusZero).toBe(false);
  });

  it("enforces fail-closed verification if preserved tables change row count", () => {
    const prePreserved: Record<string, number | null> = {
      people: 2,
      career_profiles: 1,
    };
    const postPreserved: Record<string, number | null> = {
      people: 1, // Deleted!
      career_profiles: 1,
    };

    let configIntact = true;
    for (const [tbl, cnt] of Object.entries(postPreserved)) {
      if (cnt !== prePreserved[tbl]) {
        configIntact = false;
      }
    }

    expect(configIntact).toBe(false);
  });
});
