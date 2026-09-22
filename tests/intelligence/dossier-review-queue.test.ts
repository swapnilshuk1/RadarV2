import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { SqliteDossierReviewQueue } from "../../src/data/sqlite/repositories/SqliteDossierReviewQueue";
import { dossier, evaluationFingerprint } from "../fixtures/staged-rich-dossier";

describe("durable factual review lane", () => {
  let raw: Database.Database, db: SqliteAdapter, queue: SqliteDossierReviewQueue, now: number;
  const identity = {
    tenantId: "t",
    personId: "p",
    canonicalJobId: "job",
    opportunityVersion: "v",
    evaluationContextFingerprint: "ctx",
    profileVersion: "profile",
  };
  const draft = () => {
    const value = dossier();
    delete value.generation.factualReviews;
    delete value.generation.factualReviewer;
    return value;
  };
  beforeEach(() => {
    raw = new Database(":memory:");
    db = new SqliteAdapter(raw);
    now = 1_000_000;
    raw.exec(readFileSync("src/data/sqlite/migrations/052_dossier_review_queue.sql", "utf8"));
    queue = new SqliteDossierReviewQueue(db, () => now);
  });
  afterEach(() => raw.close());
  it("enqueues once, binds scope and does not claim a review", async () => {
    await queue.enqueue(identity, evaluationFingerprint, draft());
    await queue.enqueue(identity, evaluationFingerprint, draft());
    expect(await db.one("SELECT count(*) n FROM dossier_review_jobs")).toEqual({ n: 1 });
    expect(await queue.getDraft(identity, evaluationFingerprint)).toBeTruthy();
    expect(
      await queue.getDraft({ ...identity, personId: "other" }, evaluationFingerprint),
    ).toBeNull();
    expect(await queue.getDraft(identity, "other")).toBeNull();
    await expect(queue.enqueue(identity, evaluationFingerprint, dossier())).rejects.toThrow(
      "DRAFT_MUST_NOT_CLAIM_REVIEW",
    );
    await db.execute(`UPDATE dossier_review_jobs SET draft_json='{}'`);
    expect(await queue.getDraft(identity, evaluationFingerprint)).toBeNull();
  });
  it("shares provider cooldown across jobs and restarts without hiding a throttled draft", async () => {
    await queue.enqueue(identity, evaluationFingerprint, draft());
    await queue.enqueue({ ...identity, personId: "p2" }, evaluationFingerprint, draft());
    const first = (await queue.claim())!;
    expect(await new SqliteDossierReviewQueue(db, () => now).claim()).toBeNull();
    await queue.fail(first, { provider: true, delay: 45_000, code: "429" }, () => 1);
    expect(await queue.getDraft(identity, evaluationFingerprint)).toBeTruthy();
    now += 44_999;
    expect(await queue.claim()).toBeNull();
    now += 1;
    expect(await new SqliteDossierReviewQueue(db, () => now).claim()).toBeTruthy();
  });
  it("withholds a known defect even if its correction is throttled", async () => {
    await queue.enqueue(identity, evaluationFingerprint, draft());
    const job = (await queue.claim())!;
    await queue.withhold(job);
    await queue.fail(job, { provider: true, code: "429" });
    expect(await queue.getDraft(identity, evaluationFingerprint)).toBeNull();
    expect(await queue.find(identity, evaluationFingerprint)).toMatchObject({
      status: "retry",
      withheld: 1,
    });
  });
  it("rejects late publication after lease takeover and rolls back failed promotions", async () => {
    await queue.enqueue(identity, evaluationFingerprint, draft());
    const old = (await queue.claim())!;
    now += 180_001;
    const current = (await queue.claim())!;
    expect(current.lease_token).not.toBe(old.lease_token);
    await expect(
      queue.finish(old, async () => {
        throw new Error("must never enter");
      }),
    ).rejects.toThrow("REVIEW_LEASE_LOST");
    await expect(
      queue.finish(current, async () => {
        throw new Error("publication failure");
      }),
    ).rejects.toThrow("publication failure");
    expect(await queue.find(identity, evaluationFingerprint)).toMatchObject({
      status: "processing",
    });
    await queue.finish(current, async () => {});
    expect(await queue.find(identity, evaluationFingerprint)).toMatchObject({
      status: "completed",
    });
  });
  it("stops silent retrying after the operational deadline", async () => {
    await queue.enqueue(identity, evaluationFingerprint, draft());
    const job = (await queue.claim())!;
    now += 25 * 3600_000;
    await queue.fail(job, { provider: true, code: "429" });
    expect(await queue.find(identity, evaluationFingerprint)).toMatchObject({
      status: "needs_attention",
      withheld: 0,
    });
    expect(await queue.getDraft(identity, evaluationFingerprint)).toBeTruthy();
  });
});