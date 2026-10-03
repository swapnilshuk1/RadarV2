import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { enqueueIncidentNotification } from "../../src/admin/operations-runtime";
import * as notificationWorker from "../../src/admin/notification-worker";
import { pollNotificationDeliveries } from "../../src/admin/notification-worker";
import { mutateOperations } from "../../src/admin/operations-service";
import { CredentialVault } from "../../src/lib/security/CredentialVault";

const adapters: SqliteAdapter[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of adapters.splice(0)) await db.close();
});

async function fixture() {
  const db = new SqliteAdapter(new Database(":memory:"));
  adapters.push(db);
  await setupLineageTestFixture(db);
  await db.execute("INSERT INTO users(id,email) VALUES('op','op@fixture')");
  await db.execute("INSERT INTO platform_roles VALUES('op','operator',0,'fixture','fixture',NULL)");
  const secret = "fixture-webhook-signing-secret-000000000";
  await db.execute(
    `INSERT INTO operational_webhooks(id,url,secret_envelope,minimum_severity,send_recovery,updated_at,updated_by)
      VALUES(1,?,?,?,?,?,?)`,
    [
      "https://alerts.example.com/radar",
      JSON.stringify(new CredentialVault().encrypt(secret)),
      "High",
      1,
      Date.now(),
      "op",
    ],
  );
  return db;
}

async function seedIncident(db: SqliteAdapter, id: string, snoozedUntil = 0) {
  await db.execute(
    `INSERT INTO provider_incidents(
      id,correlation_key,provider,connection_id,generation,failure_class,severity,state,
      first_seen,last_seen,occurrences,error_code,snoozed_until
    ) VALUES(?,?,'tavily','tavily:platform',1,'credential','High','open',?,?,1,'CREDENTIAL',?)`,
    [id, `correlation-${id}`, Date.now(), Date.now(), snoozedUntil],
  );
}

describe("notification lifecycle", () => {
  it("supersedes a snoozed opening alert when its incident resolves and sends only recovery", async () => {
    const db = await fixture();
    const incidentId = "incident-snoozed";
    await seedIncident(db, incidentId, Date.now() + 60 * 60_000);
    await enqueueIncidentNotification(db, incidentId, "opened");

    await db.execute("UPDATE provider_incidents SET state='resolved',resolved_at=? WHERE id=?", [
      Date.now(),
      incidentId,
    ]);
    await enqueueIncidentNotification(db, incidentId, "resolved");

    const rows = await db.many<{
      event: string;
      status: string;
      error_code: string | null;
      payload_json: string;
    }>(
      "SELECT event,status,error_code,payload_json FROM notification_deliveries WHERE incident_id=? ORDER BY event",
      [incidentId],
    );
    expect(rows.find((row) => row.event === "opened")).toMatchObject({
      status: "cancelled",
      error_code: "INCIDENT_RESOLVED_BEFORE_DELIVERY",
    });
    expect(JSON.parse(rows.find((row) => row.event === "resolved")!.payload_json)).toMatchObject({
      summary:
        "Incident resolved while its opening alert was pending; an in-flight request may still arrive.",
      supersededOpenedDeliveries: 1,
    });

    const send = vi.fn(async () => 204);
    expect(await pollNotificationDeliveries(db, 10, send)).toEqual({
      attempted: 1,
      sent: 1,
      failed: 0,
      cancelled: 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0]![1]).event).toBe("resolved");
  });

  it("increments destination revisions and cancels pending deliveries on secret rotation", async () => {
    const db = await fixture();
    const incidentId = "incident-rotation";
    await seedIncident(db, incidentId);
    await enqueueIncidentNotification(db, incidentId, "opened");

    vi.spyOn(notificationWorker, "validateWebhookDestination").mockResolvedValue({
      url: new URL("https://alerts-new.example.com/radar"),
      address: "192.0.2.1",
    });
    const result = await mutateOperations(db, "op", {
      kind: "webhook",
      url: "https://alerts-new.example.com/radar",
      secret: "fixture-webhook-signing-secret-rotated",
      severity: "High",
      recovery: true,
      reason: "rotate compromised receiver secret",
    });

    expect(result).toEqual({ ok: true });
    expect(
      await db.one<{ status: string; error_code: string; destination_revision: number }>(
        "SELECT status,error_code,destination_revision FROM notification_deliveries WHERE incident_id=?",
        [incidentId],
      ),
    ).toMatchObject({
      status: "cancelled",
      error_code: "DESTINATION_ROTATED",
      destination_revision: 0,
    });
    expect(
      await db.one<{ url: string; revision: number }>(
        "SELECT url,revision FROM operational_webhooks WHERE id=1",
      ),
    ).toMatchObject({ url: "https://alerts-new.example.com/radar", revision: 1 });
    const audit = await db.one<{ detail_json: string }>(
      "SELECT detail_json FROM admin_audit_log WHERE action='operations.webhook'",
    );
    expect(JSON.parse(audit!.detail_json)).toMatchObject({ revision: 1, pendingCancelled: 1 });
    expect(audit!.detail_json).not.toContain("fixture-webhook-signing-secret-rotated");
  });

  it("drains no more than the configured bounded batch per maintenance invocation", async () => {
    const db = await fixture();
    for (let index = 0; index < 12; index++) {
      const incidentId = `incident-batch-${index}`;
      await seedIncident(db, incidentId);
      await enqueueIncidentNotification(db, incidentId, "opened");
    }
    const send = vi.fn(async () => 204);
    expect(await pollNotificationDeliveries(db, 10, send)).toEqual({
      attempted: 10,
      sent: 10,
      failed: 0,
      cancelled: 0,
    });
    expect(send).toHaveBeenCalledTimes(10);
    expect(await pollNotificationDeliveries(db, 10, send)).toEqual({
      attempted: 2,
      sent: 2,
      failed: 0,
      cancelled: 0,
    });
  });
});
