import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, it, expect } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { acquireExecutionLease } from "../../src/acquisition/execution-lease";
import { runAcquisitionRetention } from "../../src/acquisition/retention";
import { MemoryBlobStore } from "../../src/lib/storage/blob-store";
import { handoffPrefix } from "../../src/acquisition/handoff";
import { compactSourceSnapshot } from "../../src/acquisition/source-snapshot";
import { resolveScraperRuntimeOptions } from "../../scripts/scraper/options";
import {
  readSnapshotIfFresh,
  writeSnapshot,
  snapshotPath,
} from "../../scripts/scraper/persist/writer";
import { SCRAPER_VERSION, SNAPSHOT_SCHEMA_VERSION } from "../../scripts/scraper/versions";

async function fixture() {
  const sqlite = new Database(":memory:");
  const db = new SqliteAdapter(sqlite);
  await setupLineageTestFixture(db);
  return { sqlite, db };
}
describe("Acquisition execution, refresh and retention", () => {
  it("serializes different acquisition hosts and token-fences stale renewal/release", async () => {
    const { sqlite, db } = await fixture();
    try {
      const first = await acquireExecutionLease(db);
      await expect(acquireExecutionLease(db)).rejects.toThrow("ACQUISITION_EXECUTION_BUSY");
      await first.renew();
      await db.execute("UPDATE acquisition_execution_lease SET lease_until=0");
      const second = await acquireExecutionLease(db);
      await expect(first.renew()).rejects.toThrow("LEASE_LOST");
      await first.release();
      await expect(acquireExecutionLease(db)).rejects.toThrow("BUSY");
      await second.release();
      const third = await acquireExecutionLease(db);
      await third.release();
    } finally {
      sqlite.close();
    }
  });
  it("distinguishes a new orchestration run from actual source refresh", () => {
    expect(resolveScraperRuntimeOptions(["--new-run"], {})).toMatchObject({
      newRun: true,
      freshSource: false,
    });
    expect(resolveScraperRuntimeOptions(["--fresh-source", "--resume"], {})).toMatchObject({
      newRun: true,
      freshSource: true,
    });
    expect(resolveScraperRuntimeOptions(["--fresh"], {}).freshSource).toBe(true);
    expect(resolveScraperRuntimeOptions([], { FRESH_RUN: "true" }).freshSource).toBe(true);
  });
  it("bypasses a valid current cached snapshot when source refresh is requested", () => {
    const hash = "refresh-test-" + randomUUID();
    const snapshot = {
      cardHash: hash,
      detail: { fetched: true, rawText: "source" },
      scraperVersion: SCRAPER_VERSION,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
    } as any;
    try {
      expect(writeSnapshot(snapshot)).toBeTruthy();
      expect(readSnapshotIfFresh(hash, 12)).toMatchObject({ detail: { rawText: "source" } });
      expect(readSnapshotIfFresh(hash, 12, true)).toBeNull();
    } finally {
      fs.rmSync(snapshotPath(hash), { force: true });
    }
  });
  it("compacts repeated text and HTML while preserving distinct evidence and input objects", () => {
    const original = {
      rawHtml: "large browser html",
      rawText: "JD",
      card: { rawHtml: "html", rawText: "JD" },
      detail: { rawText: "JD" },
      metadata: { quote: "different source snippet" },
    };
    const compact = compactSourceSnapshot(original);
    expect(compact).toEqual({
      card: {},
      detail: { rawText: "JD" },
      metadata: { quote: "different source snippet" },
    });
    expect(original.rawHtml).toBe("large browser html");
    expect(() => compactSourceSnapshot({ metadata: { cookies: "secret" } })).toThrow(
      "SESSION_MATERIAL",
    );
  });
  it("cleans only acknowledged expired staging and terminal debug artifacts, preserving pending and canonical evidence", async () => {
    const { sqlite, db } = await fixture();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "radar-retention-"));
    const store = new MemoryBlobStore();
    const now = Date.now(),
      old = new Date(now - 40 * 86400_000);
    const prefix = handoffPrefix("tenant_A", "person_A");
    try {
      const ids = ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64)];
      for (const id of ids) {
        await db.execute(
          `INSERT INTO acquisition_ingress_submissions(submission_id,tenant_id,person_id,run_id,content_hash,canonical_job_id,opportunity_version,response_json,accepted_at) VALUES(?,'tenant_A','person_A','old',?,'job','version',?,?)`,
          [id, id, id === ids[3] ? '{"state":"DISPATCH_PENDING"}' : "{}", old.toISOString()],
        );
        await store.put(prefix + id + ".json", "payload");
      }
      await db.execute(
        "INSERT INTO canonical_opportunities(id,source_job_id,source,canonical_url) VALUES('job','id','LinkedIn','https://example.com')",
      );
      await db.execute(
        "INSERT INTO opportunity_versions(id,canonical_job_id,job_title,content_hash,raw_content,source_payload_key) VALUES('version','job','Role','hash','source',?)",
        [prefix + ids[2] + ".json"],
      );
      fs.mkdirSync(path.join(directory, "outbox"));
      for (const [i, id] of ids.entries()) {
        const file = path.join(directory, "outbox", id + ".json");
        fs.writeFileSync(
          file,
          JSON.stringify({
            reference: { submissionId: id, payloadKey: prefix + id + ".json" },
            ...(i === 1 ? {} : { result: { canonicalJobId: "job" } }),
          }),
        );
        fs.utimesSync(file, old, old);
      }
      for (const folder of ["snapshots", "profiles"]) {
        fs.mkdirSync(path.join(directory, folder));
        const file = path.join(directory, folder, "old.json");
        fs.writeFileSync(file, "{}");
        fs.utimesSync(file, old, old);
      }
      const opts = { artifactsDir: directory, outboxDir: path.join(directory, "outbox"), now };
      expect(await runAcquisitionRetention(db, store, opts)).toMatchObject({
        apply: false,
        handoffObjects: 1,
        acknowledgedOutbox: 1,
        protectedObjects: 2,
        debugFiles: 1,
      });
      expect(await store.exists(prefix + ids[0] + ".json")).toBe(true);
      expect(await runAcquisitionRetention(db, store, { ...opts, apply: true })).toMatchObject({
        handoffObjects: 1,
        acknowledgedOutbox: 1,
        debugFiles: 1,
      });
      expect(await store.exists(prefix + ids[0] + ".json")).toBe(false);
      for (const id of ids.slice(1)) expect(await store.exists(prefix + id + ".json")).toBe(true);
      expect(fs.existsSync(path.join(directory, "profiles", "old.json"))).toBe(true);
      expect(fs.existsSync(path.join(directory, "outbox", ids[1] + ".json"))).toBe(true);
      expect(await runAcquisitionRetention(db, store, { ...opts, apply: true })).toMatchObject({
        handoffObjects: 0,
        acknowledgedOutbox: 0,
        debugFiles: 0,
      });
    } finally {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("preserves active processing payloads and debug caches", async () => {
    const { sqlite, db } = await fixture();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "radar-active-retention-"));
    const id = "e".repeat(64),
      key = handoffPrefix("tenant_A", "person_A") + id + ".json";
    const store = new MemoryBlobStore();
    try {
      await db.execute(
        "INSERT INTO acquisition_ingress_submissions(submission_id,tenant_id,person_id,run_id,content_hash,canonical_job_id,opportunity_version,response_json,accepted_at) VALUES(?,'tenant_A','person_A','old',?,'job','version','{}','2000-01-01')",
        [id, id],
      );
      await db.execute(
        "INSERT INTO enrichment_jobs(id,job_hash,pipeline_version,payload_key,status) VALUES('active','hash','test',?,'PENDING')",
        [key],
      );
      await store.put(key, "pending bytes");
      fs.mkdirSync(path.join(directory, "snapshots"));
      const file = path.join(directory, "snapshots", "old.json");
      fs.writeFileSync(file, "{}");
      fs.utimesSync(file, new Date(0), new Date(0));
      expect(
        await runAcquisitionRetention(db, store, {
          artifactsDir: directory,
          outboxDir: directory,
          apply: true,
        }),
      ).toMatchObject({ protectedObjects: 1, handoffObjects: 0, debugFiles: 0 });
      expect(await store.get(key)).toEqual(Buffer.from("pending bytes"));
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      sqlite.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("leaves retirement retryable and releases ownership when remote deletion fails", async () => {
    const { sqlite, db } = await fixture();
    const id = "f".repeat(64);
    const store = new MemoryBlobStore();
    store.delete = async () => {
      throw new Error("synthetic storage failure");
    };
    try {
      await db.execute(
        "INSERT INTO acquisition_ingress_submissions(submission_id,tenant_id,person_id,run_id,content_hash,canonical_job_id,opportunity_version,response_json,accepted_at) VALUES(?,'tenant_A','person_A','old',?,'job','version','{}','2000-01-01')",
        [id, id],
      );
      await expect(
        runAcquisitionRetention(db, store, {
          artifactsDir: "unused",
          outboxDir: "unused",
          apply: true,
        }),
      ).rejects.toThrow("synthetic storage failure");
      expect(
        await db.one("SELECT staging_retired_at FROM acquisition_ingress_submissions"),
      ).toEqual({ staging_retired_at: null });
      expect(await db.one("SELECT id FROM acquisition_execution_lease")).toBeNull();
    } finally {
      sqlite.close();
    }
  });
  it("does no cleanup while another host owns acquisition", async () => {
    const { sqlite, db } = await fixture();
    try {
      const lease = await acquireExecutionLease(db);
      expect(
        await runAcquisitionRetention(db, new MemoryBlobStore(), {
          artifactsDir: "unused",
          outboxDir: "unused",
          apply: true,
        }),
      ).toMatchObject({ skipped: "acquisition_busy" });
      await lease.release();
    } finally {
      sqlite.close();
    }
  });
});
