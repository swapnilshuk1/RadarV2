import { createHash, randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import {
  baselineConfig,
  engineConfigSchema,
  configMutationSchema,
  type EngineConfig,
  type ConfigMutation,
} from "./config-contracts";
import { requirePlatformRole, appendAdminAudit } from "./service";
export const BASELINE_REVISION = "engine-baseline-v1";
export const configFingerprint = (config: EngineConfig) =>
  createHash("sha256")
    .update(JSON.stringify(engineConfigSchema.parse(config)))
    .digest("hex");
export const configScope = (tenant?: string) => (tenant ? `tenant:${tenant}` : "platform");
export async function configInstalled(db: DatabaseAdapter) {
  return Boolean(
    await db.one("SELECT name FROM sqlite_master WHERE type='table' AND name='config_revisions'"),
  );
}
export type ConfigRevision = {
  id: string;
  scope: string;
  parent_id: string | null;
  config_json: string;
  fingerprint: string;
  created_at: number;
  created_by: string;
};
export async function revision(db: DatabaseAdapter, id: string) {
  const row = await db.one<ConfigRevision>("SELECT * FROM config_revisions WHERE id=?", [id]);
  if (!row) throw new Error("CONFIG_REVISION_NOT_FOUND");
  return { ...row, config: engineConfigSchema.parse(JSON.parse(row.config_json)) };
}
export async function activeRevision(db: DatabaseAdapter, tenant?: string) {
  const row = await db.one<{ revision_id: string }>(
    "SELECT revision_id FROM config_active_pointers WHERE scope IN (?, 'platform') ORDER BY CASE WHEN scope=? THEN 0 ELSE 1 END LIMIT 1",
    [configScope(tenant), configScope(tenant)],
  );
  return revision(db, row?.revision_id ?? BASELINE_REVISION);
}
export async function readConfigSnapshot(db: DatabaseAdapter, user: string, tenant?: string) {
  const role = await requirePlatformRole(db, user);
  if (tenant && !(await db.one("SELECT id FROM tenants WHERE id=?", [tenant])))
    throw new Error("UNKNOWN_TENANT");
  if (!(await configInstalled(db))) return null;
  const active = await activeRevision(db, tenant),
    scope = configScope(tenant);
  const draft = await db.one<{ revision_id: string }>(
    "SELECT revision_id FROM config_drafts WHERE scope=?",
    [scope],
  );
  const history = await db.many<ConfigRevision>(
    "SELECT * FROM config_revisions WHERE scope=? ORDER BY created_at DESC LIMIT 30",
    [scope],
  );
  const benches = await db.many<Record<string, string | number | null>>(
    "SELECT id,revision_id,active_revision_id,status,token_cap,tokens_reserved,result_json,error,created_at,completed_at FROM admin_bench_runs WHERE scope=? ORDER BY created_at DESC LIMIT 20",
    [scope],
  );
  return {
    role,
    active,
    draft: draft ? await revision(db, draft.revision_id) : null,
    history,
    benches,
  };
}
async function makeRevision(
  db: DatabaseAdapter,
  scope: string,
  parent: string,
  config: EngineConfig,
  user: string,
) {
  const id = randomUUID();
  const parsed = engineConfigSchema.parse(config);
  await db.execute("INSERT INTO config_revisions VALUES(?,?,?,?,?,?,?)", [
    id,
    scope,
    parent,
    JSON.stringify(parsed),
    configFingerprint(parsed),
    Date.now(),
    user,
  ]);
  await db.execute(
    "INSERT INTO config_drafts VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET revision_id=excluded.revision_id",
    [scope, id],
  );
  await db.execute(
    "UPDATE admin_bench_runs SET status='failed',error='BENCH_DRAFT_SUPERSEDED',completed_at=? WHERE scope=? AND status='queued'",
    [Date.now(), scope],
  );
  return id;
}
export async function mutateConfig(db: DatabaseAdapter, user: string, input: ConfigMutation) {
  const data = configMutationSchema.parse(input);
  return db.transaction(async (tx) => {
    await requirePlatformRole(tx, user, true);
    if (data.tenantId && !(await tx.one("SELECT id FROM tenants WHERE id=?", [data.tenantId])))
      throw new Error("UNKNOWN_TENANT");
    const scope = configScope(data.tenantId),
      active = await activeRevision(tx, data.tenantId);
    let id: string;
    if (data.kind === "draft") id = await makeRevision(tx, scope, active.id, data.config, user);
    else if (data.kind === "revert") {
      const target = await revision(tx, data.revisionId);
      if (target.scope !== scope) throw new Error("CONFIG_SCOPE_MISMATCH");
      id = await makeRevision(tx, scope, active.id, target.config, user);
    } else {
      const target = await revision(tx, data.revisionId),
        draft = await tx.one<{ revision_id: string }>(
          "SELECT revision_id FROM config_drafts WHERE scope=?",
          [scope],
        );
      if (target.scope !== scope || draft?.revision_id !== target.id)
        throw new Error("CONFIG_DRAFT_CHANGED");
      id = target.id;
      if (data.kind === "discard") {
        await tx.execute("DELETE FROM config_drafts WHERE scope=?", [scope]);
        await tx.execute(
          "UPDATE admin_bench_runs SET status='failed',error='BENCH_DRAFT_DISCARDED',completed_at=? WHERE scope=? AND status='queued'",
          [Date.now(), scope],
        );
      } else if (data.kind === "bench") {
        if (target.parent_id !== active.id) throw new Error("CONFIG_ACTIVE_CHANGED");
        if (
          await tx.one(
            "SELECT id FROM admin_bench_runs WHERE scope=? AND status IN ('queued','running')",
            [scope],
          )
        )
          throw new Error("BENCH_ALREADY_QUEUED_OR_RUNNING");
        id = randomUUID();
        await tx.execute(
          "INSERT INTO admin_bench_runs(id,scope,revision_id,active_revision_id,status,token_cap,created_at,created_by) VALUES(?,?,?,?,'queued',?,?,?)",
          [id, scope, target.id, active.id, data.tokenCap, Date.now(), user],
        );
      } else {
        const bench = await tx.one<{ status: string; result_json: string | null }>(
          "SELECT status,result_json FROM admin_bench_runs WHERE id=? AND scope=? AND revision_id=? AND active_revision_id=?",
          [data.benchId, scope, target.id, active.id],
        );
        if (
          target.parent_id !== active.id ||
          bench?.status !== "passed" ||
          !bench.result_json ||
          JSON.parse(bench.result_json).safeToPublish !== true
        )
          throw new Error("CONFIG_BENCH_REQUIRED");
        await tx.execute(
          "INSERT INTO config_active_pointers VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET revision_id=excluded.revision_id",
          [scope, target.id],
        );
        await tx.execute("DELETE FROM config_drafts WHERE scope=?", [scope]);
      }
    }
    await appendAdminAudit(tx, {
      actor: user,
      tenant: data.tenantId,
      action: `config.${data.kind}`,
      target: id,
      reason: data.reason,
      detail: {
        before: { revisionId: active.id, config: active.config },
        after:
          data.kind === "bench"
            ? { benchRunId: id, revisionId: data.revisionId }
            : data.kind === "discard"
              ? { discardedRevision: id }
              : { revisionId: id, config: (await revision(tx, id)).config },
      },
    });
    return { id };
  });
}
export const configJobTables = {
  evaluation: "evaluation_jobs",
  dossier: "dossier_composition_jobs",
  factual_review: "dossier_review_jobs",
  pursuit: "pursuit_preparation_jobs",
} as const;
export async function pinJobConfig(
  db: DatabaseAdapter,
  pipeline: keyof typeof configJobTables,
  id: string,
  tenant: string,
) {
  if (!(await configInstalled(db))) return;
  const active = await activeRevision(db, tenant);
  await db.execute(
    `UPDATE ${configJobTables[pipeline]} SET config_revision_id=? WHERE id=? AND tenant_id=? AND config_revision_id IS NULL`,
    [active.id, id, tenant],
  );
}
export async function jobConfig(
  db: DatabaseAdapter,
  pipeline: keyof typeof configJobTables,
  id: string,
) {
  if (!(await configInstalled(db))) return { id: BASELINE_REVISION, config: baselineConfig };
  const row = await db.one<{ config_revision_id: string | null }>(
    `SELECT config_revision_id FROM ${configJobTables[pipeline]} WHERE id=?`,
    [id],
  );
  if (!row?.config_revision_id) throw new Error("CONFIG_JOB_NOT_PINNED");
  return revision(db, row.config_revision_id);
}
