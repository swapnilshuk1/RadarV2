import { createHmac, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { request as httpsRequest } from "node:https";
import type { DatabaseAdapter } from "../data/database/adapter";
import { CredentialVault } from "../lib/security/CredentialVault";

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
/** IPv4-only outbound adapter initially; reject all literal hosts and unsafe DNS answers. */
export async function validateWebhookDestination(
  value: string,
  resolve: typeof lookup = lookup,
  timeoutMs = 15000,
) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname) ||
    !url.hostname.includes(".") ||
    url.hash
  )
    throw new Error("WEBHOOK_PUBLIC_HTTPS_REQUIRED");
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const answers = await Promise.race([
    resolve(url.hostname, { all: true, family: 4 }),
    new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error("WEBHOOK_TIMEOUT")), timeoutMs);
    }),
  ]).finally(() => clearTimeout(deadline));
  if (!answers.length || answers.some((a) => a.family !== 4 || denied.check(a.address, "ipv4")))
    throw new Error("WEBHOOK_DESTINATION_BLOCKED");
  return { url, address: answers[0]!.address };
}
export function notificationSignature(
  secret: string,
  timestamp: string,
  eventId: string,
  deliveryId: string,
  body: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${deliveryId}.${body}`)
    .digest("hex");
}
export function notificationHeaders(
  secret: string,
  timestamp: string,
  eventId: string,
  deliveryId: string,
  body: string,
) {
  return {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Radar-Timestamp": timestamp,
    "X-Radar-Signature": `sha256=${notificationSignature(secret, timestamp, eventId, deliveryId, body)}`,
    "X-Radar-Signature-Version": "2",
    "X-Radar-Event-Id": eventId,
    "Idempotency-Key": deliveryId,
    "X-Radar-Replay-Window": "300",
  };
}
export async function sendSignedWebhook(
  url: string,
  body: string,
  secret: string,
  deliveryId: string,
  eventId: string,
  resolveDns: typeof lookup = lookup,
  timeoutMs = 15000,
) {
  const startedAt = Date.now();
  const target = await validateWebhookDestination(url, resolveDns, timeoutMs);
  const remaining = timeoutMs - (Date.now() - startedAt);
  if (remaining <= 0) throw new Error("WEBHOOK_TIMEOUT");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Pin the checked address to prevent DNS rebinding between validation and connect.
  return new Promise<number>((resolve, reject) => {
    const req = httpsRequest(
      target.url,
      {
        method: "POST",
        lookup: (_hostname, _options, cb) => cb(null, target.address, 4),
        headers: notificationHeaders(secret, timestamp, eventId, deliveryId, body),
      },
      (response) => {
        // Never retain destination bodies; redirects are failures.
        const status = response.statusCode ?? 0;
        response.destroy();
        resolve(status);
      },
    );
    const deadline = setTimeout(() => req.destroy(new Error("WEBHOOK_TIMEOUT")), remaining);
    req.once("close", () => clearTimeout(deadline));
    req.once("error", () => reject(new Error("WEBHOOK_DELIVERY_UNAVAILABLE")));
    req.end(body);
  });
}
export async function pollNotificationDelivery(
  db: DatabaseAdapter,
  send = sendSignedWebhook,
  deadline = Date.now() + 15000,
) {
  const now = Date.now(),
    token = randomUUID();
  const delivery = await db.transaction(async (tx) => {
    const row = await tx.one<{
      id: string;
      destination_url: string;
      secret_envelope: string;
      payload_json: string;
      attempts: number;
      incident_id: string;
      event: string;
      destination_revision: number;
    }>(
      "SELECT d.* FROM notification_deliveries d JOIN provider_incidents i ON i.id=d.incident_id WHERE d.status IN ('queued','retry','sending') AND d.next_attempt_at<=? AND (d.lease_until IS NULL OR d.lease_until<=?) AND (i.snoozed_until<=? OR d.event='resolved') AND (d.event='resolved' OR i.state!='resolved') ORDER BY d.next_attempt_at,d.id LIMIT 1",
      [now, now, now],
    );
    if (!row) return null;
    const claim = await tx.execute(
      "UPDATE notification_deliveries SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND (lease_until IS NULL OR lease_until<=?)",
      [token, now + 30_000, row.id, now],
    );
    return claim.rowsAffected ? row : null;
  });
  if (!delivery) return null;
  // Resolution and destination rotation can happen after a row was queued. Recheck
  // immediately before making the external call, and fence the lease if it was revoked.
  const current = await db.one<{
    incident_state: string;
    status: string;
    lease_token: string | null;
    error_code: string | null;
    current_revision: number | null;
  }>(
    `SELECT i.state incident_state,d.status,d.lease_token,d.error_code,w.revision current_revision
    FROM notification_deliveries d
    JOIN provider_incidents i ON i.id=d.incident_id
    LEFT JOIN operational_webhooks w ON w.id=1
    WHERE d.id=?`,
    [delivery.id],
  );
  const revokedReason =
    !current || current.status !== "sending" || current.lease_token !== token
      ? (current?.error_code ?? "DESTINATION_ROTATED")
      : delivery.event === "opened" && current.incident_state === "resolved"
        ? "INCIDENT_RESOLVED_BEFORE_DELIVERY"
        : current.current_revision !== delivery.destination_revision
          ? "DESTINATION_ROTATED"
          : null;
  if (revokedReason) {
    await db.execute(
      "UPDATE notification_deliveries SET status='cancelled',error_code=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
      [revokedReason, delivery.id, token],
    );
    return { id: delivery.id, success: true, cancelled: true };
  }
  const sendTimeoutMs = Math.min(15000, deadline - Date.now());
  if (sendTimeoutMs <= 0) {
    await db.execute(
      "UPDATE notification_deliveries SET status='retry',attempts=MAX(0,attempts-1),next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
      [Date.now(), delivery.id, token],
    );
    return null;
  }
  let success = false;
  try {
    const secret = new CredentialVault().decrypt(JSON.parse(delivery.secret_envelope));
    const eventId = `${delivery.incident_id}:${delivery.event}`;
    if (JSON.parse(delivery.payload_json).eventId !== eventId)
      throw new Error("WEBHOOK_EVENT_IDENTITY_INVALID");
    const status = await send(
      delivery.destination_url,
      delivery.payload_json,
      secret,
      delivery.id,
      eventId,
      undefined,
      sendTimeoutMs,
    );
    success = status >= 200 && status < 300;
  } catch {
    /* Persist only a sanitized application code. */
  }
  const attempts = delivery.attempts + 1;
  const completed = await db.execute(
    "UPDATE notification_deliveries SET status=?,error_code=?,delivered_at=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND lease_until>?",
    [
      success ? "delivered" : attempts >= 5 ? "failed" : "retry",
      success ? null : "WEBHOOK_DELIVERY_FAILED",
      success ? Date.now() : null,
      Date.now() + Math.min(900_000, 30_000 * 2 ** attempts),
      delivery.id,
      token,
      Date.now(),
    ],
  );
  if (!completed.rowsAffected) return { id: delivery.id, success: true, cancelled: true };
  return { id: delivery.id, success };
}

/** Drain a bounded batch with limited concurrency and a shared wall-clock deadline. */
export async function pollNotificationDeliveries(
  db: DatabaseAdapter,
  maxBatch = 10,
  send = sendSignedWebhook,
) {
  const limit = Number.isFinite(maxBatch) ? Math.max(1, Math.min(50, Math.floor(maxBatch))) : 10;
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let cancelled = 0;
  const deadline = Date.now() + 45000;
  let processed = 0;
  while (processed < limit && Date.now() < deadline) {
    // Three concurrent sends cap a full batch near the per-delivery timeout while
    // keeping outbound pressure bounded and each delivery independently leased.
    const width = Math.min(3, limit - processed);
    const results = await Promise.all(
      Array.from({ length: width }, () => pollNotificationDelivery(db, send, deadline)),
    );
    const claimed = results.filter((result) => result !== null);
    if (!claimed.length) break;
    processed += claimed.length;
    for (const result of claimed) {
      if (result.cancelled) {
        cancelled++;
        continue;
      }
      attempted++;
      if (result.success) sent++;
      else failed++;
    }
  }
  return { attempted, sent, failed, cancelled };
}
