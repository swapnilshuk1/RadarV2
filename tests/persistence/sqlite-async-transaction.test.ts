import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";

const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("SqliteAdapter async transaction ownership", () => {
  const databases: Database.Database[] = [];

  function adapter() {
    const database = new Database(":memory:");
    databases.push(database);
    database.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    return new SqliteAdapter(database);
  }

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("keeps unrelated operations out of an awaited transaction", async () => {
    const db = adapter();
    let continueTransaction!: () => void;
    const gate = new Promise<void>((resolve) => { continueTransaction = resolve; });

    const tx = db.transaction(async (inner) => {
      await inner.execute("INSERT INTO entries VALUES (?, ?)", ["inside-first", "one"]);
      await gate;
      await inner.execute("INSERT INTO entries VALUES (?, ?)", ["inside-last", "two"]);
    });
    await wait();
    const unrelated = db.execute("INSERT INTO entries VALUES (?, ?)", ["outside", "three"]);
    let unrelatedFinished = false;
    void unrelated.then(() => { unrelatedFinished = true; });
    await wait();

    // The unrelated operation is queued behind the whole transaction, not
    // executed against its open connection between the two transaction writes.
    expect(unrelatedFinished).toBe(false);
    continueTransaction();
    await Promise.all([tx, unrelated]);
    expect(await db.many<{ id: string }>("SELECT id FROM entries ORDER BY id")).toEqual([
      { id: "inside-first" }, { id: "inside-last" }, { id: "outside" },
    ]);
  });

  it("serializes concurrent transactions and reuses a nested transaction", async () => {
    const db = adapter();
    await Promise.all([
      db.transaction(async (outer) => {
        await outer.execute("INSERT INTO entries VALUES (?, ?)", ["outer", "one"]);
        await outer.transaction(async (nested) => {
          await nested.execute("INSERT INTO entries VALUES (?, ?)", ["nested", "two"]);
        });
      }),
      db.transaction(async (second) => {
        await second.execute("INSERT INTO entries VALUES (?, ?)", ["second", "three"]);
      }),
    ]);
    expect(await db.many<{ id: string }>("SELECT id FROM entries ORDER BY id")).toEqual([
      { id: "nested" }, { id: "outer" }, { id: "second" },
    ]);
  });

  it("rolls back all writes after awaited work fails", async () => {
    const db = adapter();
    await expect(db.transaction(async (inner) => {
      await inner.execute("INSERT INTO entries VALUES (?, ?)", ["discard", "one"]);
      await wait();
      throw new Error("expected rollback");
    })).rejects.toThrow("expected rollback");
    expect(await db.many("SELECT * FROM entries")).toEqual([]);
  });

  it("runs rebuild migrations without a nested BEGIN and restores foreign keys", async () => {
    const raw = new Database(":memory:");
    databases.push(raw);
    raw.pragma("foreign_keys = ON");
    raw.exec("CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (parent_id TEXT REFERENCES parent(id));");
    const db = new SqliteAdapter(raw);
    const exec = raw.exec.bind(raw);
    const begins: string[] = [];
    (raw as any).exec = (sql: string) => { if (sql === "BEGIN IMMEDIATE") begins.push(sql); return exec(sql); };
    await db.executeMigration!(["DROP TABLE parent", "CREATE TABLE parent (id TEXT PRIMARY KEY)"], { disableForeignKeys: true });
    expect(begins).toHaveLength(1);
    expect(raw.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(raw.pragma("foreign_key_check")).toEqual([]);
  });

  it("rolls back a failed migration and releases ownership", async () => {
    const db = adapter();
    await expect(db.executeMigration!(["CREATE TABLE rollback_probe (id TEXT)", "NOT VALID SQL"])).rejects.toThrow();
    expect(await db.one("SELECT name FROM sqlite_master WHERE name='rollback_probe'")).toBeNull();
    await expect(db.execute("INSERT INTO entries VALUES (?, ?)", ["after-failure", "ok"])).resolves.toMatchObject({ rowsAffected: 1 });
  });
});
