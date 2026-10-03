import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations, migrationChecksum } from "../../src/data/sqlite/migrations/runner";

const snapshotsKey = Symbol.for("radar.test.migrated-snapshots");
const worker = process as typeof process & { [snapshotsKey]?: Map<string, Promise<Buffer>> };
const snapshots = (worker[snapshotsKey] ??= new Map<string, Promise<Buffer>>());
const cloned = new WeakSet<SqliteAdapter>();

/** One empty migrated snapshot per worker and exact migration catalog. No test data is shared. */
export async function migratedFixtureDatabase(): Promise<SqliteAdapter> {
  const directory = path.resolve("src/data/sqlite/migrations");
  const hash = crypto.createHash("sha256");
  for (const file of fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    hash.update(
      file + "\0" + migrationChecksum(fs.readFileSync(path.join(directory, file), "utf8")),
    );
  }
  const key = hash.digest("hex");
  let pending = snapshots.get(key);
  if (!pending) {
    pending = (async () => {
      const raw = new Database(":memory:");
      const adapter = new SqliteAdapter(raw);
      try {
        await runMigrations(adapter);
        return raw.serialize();
      } finally {
        await adapter.close();
      }
    })();
    snapshots.set(key, pending);
    pending.catch(() => snapshots.delete(key));
  }
  const raw = new Database(Buffer.from(await pending));
  raw.pragma("foreign_keys = ON");
  const adapter = new SqliteAdapter(raw);
  cloned.add(adapter);
  return adapter;
}

export function isMigratedFixture(db: unknown): boolean {
  return cloned.has(db as SqliteAdapter);
}
