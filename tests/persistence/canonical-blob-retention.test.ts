import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { MemoryBlobStore } from "@/lib/storage/blob-store";
import { cleanupExpiredTerminalPayloads, deletePayloadIfEphemeral } from "../../scripts/enrich";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";

class TestAdapter implements DatabaseAdapter {
  constructor(readonly sqlite: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> { return (this.sqlite.prepare(sql).get(...(params || [])) as T) || null; }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> { return this.sqlite.prepare(sql).all(...(params || [])) as T[]; }
  async execute(sql: string, params?: QueryParams) { const result = this.sqlite.prepare(sql).run(...(params || [])); return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid }; }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> { this.sqlite.exec("BEGIN"); try { const result = await fn(this); this.sqlite.exec("COMMIT"); return result; } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; } }
}

function setup(): { db: TestAdapter; queue: EnrichmentQueue } {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE opportunity_versions (id TEXT PRIMARY KEY, source_payload_key TEXT);
    CREATE TABLE enrichment_jobs (id TEXT PRIMARY KEY, payload_key TEXT, status TEXT, completed_at TEXT, created_at TEXT);
  `);
  const db = new TestAdapter(sqlite);
  return { db, queue: new EnrichmentQueue(db) };
}

const old = "2020-01-01T00:00:00.000Z";

describe("canonical source blob retention", () => {
  it("retains a canonical payload after immediate completion cleanup and terminal retention cleanup", async () => {
    const { db, queue } = setup();
    const blobs = new MemoryBlobStore();
    const key = "acquisition/canonical/version/snapshot.json";
    await blobs.put(key, "canonical evidence");
    await db.execute("INSERT INTO opportunity_versions (id, source_payload_key) VALUES (?, ?)", ["version-1", key]);
    await db.execute("INSERT INTO enrichment_jobs VALUES (?, ?, 'COMPLETE', ?, ?)", ["job-1", key, old, old]);

    expect(await deletePayloadIfEphemeral(queue, key, blobs)).toBe(false);
    expect(await blobs.exists(key)).toBe(true);
    await cleanupExpiredTerminalPayloads(queue, { blobStore: blobs, retentionHours: 1 });
    expect(await blobs.exists(key)).toBe(true);
  });

  it("continues to delete unreferenced terminal payloads", async () => {
    const { db, queue } = setup();
    const blobs = new MemoryBlobStore();
    const key = "snapshots/ephemeral.json";
    await blobs.put(key, "temporary payload");
    await db.execute("INSERT INTO enrichment_jobs VALUES (?, ?, 'COMPLETE', ?, ?)", ["job-ephemeral", key, old, old]);

    expect(await deletePayloadIfEphemeral(queue, key, blobs)).toBe(true);
    expect(await blobs.exists(key)).toBe(false);
    await blobs.put(key, "temporary payload");
    await cleanupExpiredTerminalPayloads(queue, { blobStore: blobs, retentionHours: 1 });
    expect(await blobs.exists(key)).toBe(false);
  });
});
