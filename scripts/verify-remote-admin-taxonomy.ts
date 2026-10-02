import { hostname } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";
import { TursoAdapter } from "../src/data/database/turso";
import { runMigrations } from "../src/data/sqlite/migrations/runner";
import { mutateTaxonomy, readTaxonomySnapshot } from "../src/admin/taxonomy-store";
import { IntelligenceShadowWorker } from "../src/admin/intelligence-shadow-worker";
import { INTELLIGENCE_SHADOW_VERSION } from "../src/admin/intelligence-shadow";
const url = process.env.RADAR_REMOTE_VALIDATION_URL,
  token = process.env.RADAR_REMOTE_VALIDATION_TOKEN;
if (
  process.env.RADAR_ADMIN_REMOTE_VALIDATION_CONFIRM !== "DISPOSABLE" ||
  !url?.startsWith("libsql://radar-admin-disposable-") ||
  !token
)
  throw new Error("NAMED_DISPOSABLE_DATABASE_REQUIRED");
Object.assign(process.env, {
  RADAR_ADMIN_BENCH_TARGET: "disposable-remote-taxonomy",
  RADAR_RELEASE_SHA: process.env.RADAR_RELEASE_SHA ?? "b".repeat(40),
  RADAR_ADMIN_BENCH_HOSTS: hostname(),
});
const db = new TursoAdapter(url, token),
  second = new TursoAdapter(url, token);
try {
  await runMigrations(db);
  await db.execute(
    "INSERT OR IGNORE INTO users(id,email) VALUES('remote-validation-op','synthetic@remote-validation.invalid')",
  );
  await db.execute(
    "INSERT OR IGNORE INTO platform_roles(user_id,role,granted_at,granted_by,reason) VALUES('remote-validation-op','operator',0,'validation','disposable remote proof')",
  );
  const initial = await readTaxonomySnapshot(db, "remote-validation-op");
  if (initial.draft)
    await mutateTaxonomy(db, "remote-validation-op", {
      kind: "discard",
      revisionId: initial.draft.id,
      reason: "reset disposable validation draft",
      expectedState: initial.state,
    });
  const current = await readTaxonomySnapshot(db, "remote-validation-op");
  const state = current.state;
  const classification =
    current.active.definition.intelligence?.nodes.find((n) => n.id === "perf_mkt")
      ?.classification === "ADJACENT"
      ? "CORE"
      : "ADJACENT";
  const writes = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      mutateTaxonomy(i % 2 ? second : db, "remote-validation-op", {
        kind: "intelligence_classify",
        nodeId: "perf_mkt",
        classification,
        reason: "concurrent state proof",
        expectedState: state,
      }),
    ),
  );
  const wins = writes.filter((r) => r.status === "fulfilled"),
    losses = writes.filter((r) => r.status === "rejected");
  if (wins.length !== 1)
    console.log(
      writes.map((r) => (r.status === "rejected" ? String(r.reason).slice(0, 100) : "won")),
    );
  if (
    wins.length !== 1 ||
    losses.some((r) => r.status === "rejected" && !String(r.reason).includes("ADMIN_STATE_CHANGED"))
  )
    throw new Error(`REMOTE_MUTATION_CONTENTION_FAILED:${wins.length} winners`);
  const draft = (await readTaxonomySnapshot(db, "remote-validation-op")).draft!;
  const queued = await mutateTaxonomy(db, "remote-validation-op", {
    kind: "intelligence_shadow",
    revisionId: draft.id,
    tokenCap: 1000000,
    limit: 3,
    reason: "disposable golden worker proof",
    expectedState: (await readTaxonomySnapshot(db, "remote-validation-op")).state,
  });
  const runner = async (_row: unknown, specimens: { id: string }[]) => ({
    version: INTELLIGENCE_SHADOW_VERSION,
    safeToPublish: true,
    cases: specimens.map(({ id }) => ({
      id,
      beforeAdmission: "CANDIDATE:REVIEW",
      afterAdmission: "CANDIDATE:REVIEW",
      beforeVerdict: id === "mandatory-license" ? "PASS" : "CONSIDER",
      afterVerdict: id === "mandatory-license" ? "PASS" : "CONSIDER",
      beforeViability: id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
      afterViability: id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
    })),
    admissionsChanged: 0,
    verdictsChanged: 0,
    passToPursue: 0,
    invalidOutputs: 0,
    repairs: 0,
  });
  const claims = await Promise.all([
    new IntelligenceShadowWorker(db, runner).pollOnce(),
    new IntelligenceShadowWorker(second, runner).pollOnce(),
  ]);
  if (claims.filter(Boolean).length !== 1 || claims.find(Boolean)?.status !== "passed")
    throw new Error("REMOTE_SHADOW_DOUBLE_CLAIM_OR_FAILURE");
  await mutateTaxonomy(db, "remote-validation-op", {
    kind: "publish",
    revisionId: draft.id,
    confirmation: "PUBLISH",
    reason: "disposable atomic publication",
    expectedState: (await readTaxonomySnapshot(db, "remote-validation-op")).state,
  });
  let immutable = false;
  try {
    await db.execute("UPDATE intelligence_taxonomy_shadows SET status='failed' WHERE id=?", [
      queued.id,
    ]);
  } catch {
    immutable = true;
  }
  if (!immutable) throw new Error("REMOTE_SHADOW_MUTABLE");
  const result = {
    status: "passed",
    mutationWinners: wins.length,
    staleLosers: losses.length,
    workerClaims: claims.filter(Boolean).length,
    immutable,
    liveProvider: false,
    database: "radar-admin-disposable-20261002",
  };
  mkdirSync(".radar/remote-validation", { recursive: true });
  writeFileSync(".radar/remote-validation/contention-result.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await db.close();
  await second.close();
}
