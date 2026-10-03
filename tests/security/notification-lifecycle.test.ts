import { migratedFixtureDatabase } from "../persistence/migrated-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const db = await migratedFixtureDatabase();
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

  it.each(["https://alerts.example.com/radar", "https://alerts-new.example.com/radar"])(
    "requeues pending alerts on rotation to %s",
    async (url) => {
      const db = await fixture();
      const incidentId = "incident-rotation";
      await seedIncident(db, incidentId);
      await enqueueIncidentNotification(db, incidentId, "opened");

      vi.spyOn(notificationWorker, "validateWebhookDestination").mockResolvedValue({
        url: new URL(url),
        address: "192.0.2.1",
      });
      const result = await mutateOperations(db, "op", {
        kind: "webhook",
        url,
        secret: "fixture-webhook-signing-secret-rotated",
        severity: "High",
        recovery: true,
        reason: "rotate compromised receiver secret",
      });

      expect(result).toEqual({ ok: true });
      expect(
        await db.one<{ status: string; error_code: string; destination_revision: number }>(
          "SELECT status,error_code,destination_revision FROM notification_deliveries WHERE incident_id=? AND destination_revision=0",
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
      ).toMatchObject({ url, revision: 1 });
      await enqueueIncidentNotification(db, incidentId, "opened");
      const rows = await db.many<{ destination_revision: number; secret_envelope: string }>(
        "SELECT destination_revision,secret_envelope FROM notification_deliveries WHERE incident_id=? ORDER BY destination_revision",
        [incidentId],
      );
      expect(rows).toHaveLength(2);
      expect(new CredentialVault().decrypt(JSON.parse(rows[1].secret_envelope))).toBe(
        "fixture-webhook-signing-secret-rotated",
      );
      const send = vi.fn(async () => 204);
      expect(await pollNotificationDeliveries(db, 10, send)).toMatchObject({
        attempted: 1,
        sent: 1,
      });
      expect(JSON.parse(send.mock.calls[0]![1])).toMatchObject({
        event: "opened",
        destinationRevision: 1,
      });
      const audit = await db.one<{ detail_json: string }>(
        "SELECT detail_json FROM admin_audit_log WHERE action='operations.webhook'",
      );
      expect(JSON.parse(audit!.detail_json)).toMatchObject({
        revision: 1,
        pendingCancelled: 1,
        pendingRequeued: 1,
      });
      expect(audit!.detail_json).not.toContain("fixture-webhook-signing-secret-rotated");
    },
  );

  it("requeues only relevant pending events and rolls the rotation back on audit failure", async () => {
    const db = await fixture();
    for (const id of ["obsolete", "recovery", "delivered"]) {
      await seedIncident(db, id);
      await enqueueIncidentNotification(db, id, "opened");
    }
    await db.execute(
      "UPDATE provider_incidents SET state='resolved' WHERE id IN ('obsolete','recovery')",
    );
    await enqueueIncidentNotification(db, "recovery", "resolved");
    await db.execute(
      "UPDATE notification_deliveries SET status='delivered' WHERE incident_id='delivered'",
    );
    vi.spyOn(notificationWorker, "validateWebhookDestination").mockResolvedValue({
      url: new URL("https://alerts.example.com/radar"),
      address: "192.0.2.1",
    });
    const rotation = {
      kind: "webhook" as const,
      url: "https://alerts.example.com/radar",
      secret: "fixture-webhook-signing-secret-rotated",
      severity: "High" as const,
      recovery: true,
      reason: "rotate secret atomically",
    };
    const before = await db.many("SELECT * FROM notification_deliveries ORDER BY id");
    await db.execute(
      "CREATE TRIGGER reject_rotation_audit BEFORE INSERT ON admin_audit_log WHEN NEW.action='operations.webhook' BEGIN SELECT RAISE(ABORT,'ROTATION_AUDIT_FAILED'); END",
    );
    await expect(mutateOperations(db, "op", rotation)).rejects.toThrow("ROTATION_AUDIT_FAILED");
    expect(await db.many("SELECT * FROM notification_deliveries ORDER BY id")).toEqual(before);
    expect(await db.one("SELECT revision FROM operational_webhooks")).toEqual({ revision: 0 });
    await db.execute("DROP TRIGGER reject_rotation_audit");
    await mutateOperations(db, "op", rotation);
    expect(
      await db.many(
        "SELECT incident_id,event,status FROM notification_deliveries WHERE destination_revision=1",
      ),
    ).toEqual([{ incident_id: "recovery", event: "resolved", status: "queued" }]);
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
