import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { SqliteAcquisitionStore } from "../../src/data/sqlite/repositories/SqliteAcquisitionStore";
import { versionCandidateProjection } from "../../src/data/sqlite/repositories/profile-projection-version";
import { RunController } from "../../scripts/scraper/run/manager";

describe("Gate 4 canonical write and runtime correctness", () => {
  it("claims each durable acquisition job for exactly one competing worker", async () => {
    const db = new SqliteAdapter(new Database(":memory:"));
    await runMigrations(db);
    const store = new SqliteAcquisitionStore(db);
    await store.upsertDiscoveredJob({
      canonicalJobId: "job-1", sourcePortal: "test", sourceJobId: "source-1",
      canonicalUrl: "https://example.test/job-1", title: "Role", companyName: "Company",
      state: "QUEUED", firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
    });
    const [left, right] = await Promise.all([
      store.claimQueuedJobs("worker-left", 1),
      store.claimQueuedJobs("worker-right", 1),
    ]);
    expect(left.length + right.length).toBe(1);
    const claimed = [...left, ...right][0];
    expect(claimed.claimedBy).toMatch(/^worker-(left|right)$/);
  });

  it("uses a content-addressed immutable projection version", () => {
    const base: any = { profileVersion: "", attainedTitle: "VP", values: { a: 1 } };
    const v1 = versionCandidateProjection(base);
    const v1Replay = versionCandidateProjection({ ...base });
    const v2 = versionCandidateProjection({ ...base, values: { a: 2 } });
    expect(v1.profileVersion).toBe(v1Replay.profileVersion);
    expect(v2.profileVersion).not.toBe(v1.profileVersion);
  });

  it("keeps request handlers and serving reads free of fire-and-forget processing", () => {
    const documentServer = fs.readFileSync("src/lib/intelligence/document-server.ts", "utf8");
    const serving = fs.readFileSync("src/lib/intelligence/opportunity-service.ts", "utf8");
    expect(documentServer).not.toContain("void pipeline.run");
    expect(serving).not.toContain("startGlobalDaemon");
  });

  it("does not permit a terminal scraper run to become enriching or completed", () => {
    const controller = new RunController();
    (controller as any).manifest = { status: "failed", updatedAt: "before" };
    (controller as any).persistManifest = () => undefined;
    (controller as any).journal = { append: () => undefined };

    controller.transitionTo("enriching");
    expect((controller as any).manifest.status).toBe("failed");
    controller.transitionTo("completed");
    expect((controller as any).manifest.status).toBe("failed");
  });
});
