import { describe, it, expect, beforeAll } from "vitest";
import { getDatabaseAdapter } from "../src/data/database";

describe("DatabaseAdapter Contract Tests", () => {
  const db = getDatabaseAdapter();

  beforeAll(async () => {
    // Ensure test table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS _test_contract (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        val INTEGER
      )
    `);
    await db.execute(`DELETE FROM _test_contract`);
  });

  it("should execute insert and read one record", async () => {
    await db.execute("INSERT INTO _test_contract (id, name, val) VALUES (?, ?, ?)", ["1", "Alpha", 100]);
    const row = await db.one<{ id: string; name: string; val: number }>(
      "SELECT * FROM _test_contract WHERE id = ?",
      ["1"]
    );

    expect(row).not.toBeNull();
    expect(row?.name).toBe("Alpha");
    expect(row?.val).toBe(100);
  });

  it("should read many records", async () => {
    await db.execute("INSERT INTO _test_contract (id, name, val) VALUES (?, ?, ?)", ["2", "Beta", 200]);
    const rows = await db.many<{ id: string; name: string; val: number }>(
      "SELECT * FROM _test_contract ORDER BY val ASC"
    );

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].name).toBe("Alpha");
    expect(rows[1].name).toBe("Beta");
  });

  it("should return null for non-existent row", async () => {
    const row = await db.one("SELECT * FROM _test_contract WHERE id = ?", ["non-existent-id"]);
    expect(row).toBeNull();
  });
});
