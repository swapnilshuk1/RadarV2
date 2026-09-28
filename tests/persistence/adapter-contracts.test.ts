import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getDatabaseAdapter } from "../../src/data/database";

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

  it("configures file-backed libSQL for concurrent worker access", () => {
    const dir = mkdtempSync(join(tmpdir(), "radar-libsql-"));
    const filePath = join(dir, "worker.sqlite").replace(/\\/g, "/");
    const script = `
      import { TursoAdapter } from './src/data/database/turso.ts';
      const adapter = new TursoAdapter(${JSON.stringify("file:")} + ${JSON.stringify(filePath)}, '');
      const journal = await adapter.one('PRAGMA journal_mode');
      const timeout = await adapter.one('PRAGMA busy_timeout');
      console.log(JSON.stringify({ journal: Object.values(journal ?? {})[0], timeout: Object.values(timeout ?? {})[0] }));
      await adapter.close();
    `;
    try {
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      expect(child.status, child.stderr).toBe(0);
      const result = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1) || "{}");
      expect(String(result.journal).toLowerCase()).toBe("wal");
      expect(Number(result.timeout)).toBe(15000);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
