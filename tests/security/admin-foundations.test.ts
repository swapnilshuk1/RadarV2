import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import {
  requirePlatformRole,
  appendAdminAudit,
  rollupUsage,
  readAdminSnapshot,
} from "../../src/admin/service";

function fixture() {
  const raw = new Database(":memory:");
  raw.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE tenants(id TEXT,status TEXT);
    CREATE TABLE memberships(user_id TEXT,tenant_id TEXT,status TEXT,role TEXT);
    CREATE TABLE model_invocations(tenant_id TEXT,pipeline TEXT,provider TEXT,model_id TEXT,started_at INTEGER,status TEXT,input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,total_tokens INTEGER);
    INSERT INTO users VALUES('owner'),('operator'),('viewer');
    INSERT INTO tenants VALUES('a','active'),('b','active');
    INSERT INTO memberships VALUES('owner','a','active','admin');`);
  raw.exec(readFileSync("src/data/sqlite/migrations/072_admin_foundations.sql", "utf8"));
  raw.exec(
    `INSERT INTO platform_roles VALUES('operator','operator',0,'fixture','test',NULL),('viewer','viewer',0,'fixture','test',NULL)`,
  );
  return { raw, db: new SqliteAdapter(raw) };
}
describe("Administration foundations", () => {
  it("denies tenant owners, revoked roles and viewer writes", async () => {
    const { raw, db } = fixture();
    await expect(requirePlatformRole(db, "owner")).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    await expect(requirePlatformRole(db, "missing")).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    await expect(requirePlatformRole(db, "viewer", true)).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    expect(await requirePlatformRole(db, "viewer")).toBe("viewer");
    raw.exec("UPDATE platform_roles SET revoked_at=1 WHERE user_id='operator'");
    await expect(readAdminSnapshot(db, "operator")).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    expect(raw.prepare("SELECT COUNT(*) n FROM admin_audit_log").get()).toEqual({ n: 0 });
    raw.close();
  });
  it("rollups reconcile late completion without double counting or hiding unknown usage", async () => {
    const { raw, db } = fixture();
    const day = new Date().toISOString().slice(0, 10);
    const ts = Date.parse(day);
    raw
      .prepare(
        "INSERT INTO model_invocations(tenant_id,pipeline,provider,model_id,started_at,status,input_tokens,output_tokens) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run("a", "evaluation", "bedrock", "model", ts, "running", null, null);
    await rollupUsage(db, day, day);
    await rollupUsage(db, day, day);
    expect(raw.prepare("SELECT calls,measured FROM usage_daily").get()).toEqual({
      calls: 1,
      measured: 0,
    });
    const unknown = await readAdminSnapshot(db, "operator", "a", 1);
    expect(unknown.sections.find((s) => s.title === "Usage")?.rows?.[0].input_tokens).toBeNull();
    raw.exec("UPDATE model_invocations SET status='completed',input_tokens=100,output_tokens=20");
    await rollupUsage(db, day, day);
    expect(raw.prepare("SELECT calls,completed,input_tokens FROM usage_daily").get()).toEqual({
      calls: 1,
      completed: 1,
      input_tokens: 100,
    });
    await expect(rollupUsage(db, "2026-02-31", day)).rejects.toThrow("INVALID_ROLLUP_WINDOW");
    raw.close();
  });
  it("scopes usage, tenants and audit; missing queue telemetry stays unavailable", async () => {
    const { raw, db } = fixture();
    const day = new Date().toISOString().slice(0, 10);
    raw
      .prepare(
        "INSERT INTO model_invocations(tenant_id,pipeline,provider,model_id,started_at,status,input_tokens,output_tokens) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run("b", "evaluation", "provider", "foreign-model", Date.parse(day), "completed", 99, 9);
    await rollupUsage(db, day, day);
    await appendAdminAudit(db, {
      actor: "operator",
      action: "fixture",
      tenant: "b",
      target: "foreign",
      reason: "test",
    });
    await appendAdminAudit(db, {
      actor: "operator",
      action: "fixture",
      target: "global",
      reason: "test",
    });
    const snap = await readAdminSnapshot(db, "operator", "a", 1);
    expect(snap.sections.find((s) => s.title === "Usage")?.rows).toEqual([]);
    expect(snap.sections.find((s) => s.title === "Audit")?.rows).toEqual([]);
    expect(snap.sections.find((s) => s.title === "Tenants")?.rows?.map((r) => r.id)).toEqual(["a"]);
    expect(snap.sections.find((s) => s.title === "Evaluation")?.rows).toBeNull();
    expect(snap.sections.some((s) => s.title === "Workers")).toBe(false);
    await expect(readAdminSnapshot(db, "operator", "unknown")).rejects.toThrow("UNKNOWN_TENANT");
    expect(raw.prepare("SELECT COUNT(*) n FROM model_invocations").get()).toEqual({ n: 1 });
    raw.close();
  });
  it("audit is append-only and rejects blank reasons", async () => {
    const { raw, db } = fixture();
    await expect(
      appendAdminAudit(db, { actor: "operator", action: "grant", target: "viewer", reason: " " }),
    ).rejects.toThrow("AUDIT_REASON_REQUIRED");
    await appendAdminAudit(db, {
      actor: "operator",
      action: "grant",
      target: "viewer",
      reason: "review access",
      detail: { after: "viewer" },
    });
    expect(() => raw.exec("DELETE FROM admin_audit_log")).toThrow("ADMIN_AUDIT_IMMUTABLE");
    expect(() => raw.exec("UPDATE admin_audit_log SET reason='changed'")).toThrow(
      "ADMIN_AUDIT_IMMUTABLE",
    );
    raw.close();
  });
});
