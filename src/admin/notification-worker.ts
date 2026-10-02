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
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
/** IPv4-only outbound adapter initially; reject all literal hosts and unsafe DNS answers. */
export async function validateWebhookDestination(value: string, resolve: typeof lookup = lookup) {
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
  const answers = await resolve(url.hostname, { all: true, family: 4 });
  if (!answers.length || answers.some((a) => a.family !== 4 || denied.check(a.address, "ipv4")))
    throw new Error("WEBHOOK_DESTINATION_BLOCKED");
  return { url, address: answers[0]!.address };
}
export function notificationSignature(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}
export async function sendSignedWebhook(url: string, body: string, secret: string, id: string) {
  const target = await validateWebhookDestination(url);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Pin the checked address to prevent DNS rebinding between validation and connect.
  return new Promise<number>((resolve, reject) => {
    const req = httpsRequest(
      target.url,
      {
        method: "POST",
        lookup: (_hostname, _options, cb) => cb(null, target.address, 4),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "X-Radar-Timestamp": timestamp,
          "X-Radar-Signature": `sha256=${notificationSignature(secret, timestamp, body)}`,
          "X-Radar-Event-Id": id,
          "Idempotency-Key": id,
          "X-Radar-Replay-Window": "300",
        },
      },
      (response) => {
        // Never retain destination bodies; redirects are failures.
        const status = response.statusCode ?? 0;
        response.destroy();
        resolve(status);
      },
    );
    const deadline = setTimeout(() => req.destroy(new Error("WEBHOOK_TIMEOUT")), 15_000);
    req.once("close", () => clearTimeout(deadline));
    req.once("error", () => reject(new Error("WEBHOOK_DELIVERY_UNAVAILABLE")));
    req.end(body);
  });
}
export async function pollNotificationDelivery(db: DatabaseAdapter, send = sendSignedWebhook) {
  const now = Date.now(),
    token = randomUUID();
  const delivery = await db.transaction(async (tx) => {
    const row = await tx.one<{
      id: string;
      destination_url: string;
      secret_envelope: string;
      payload_json: string;
      attempts: number;
    }>(
      "SELECT d.* FROM notification_deliveries d JOIN provider_incidents i ON i.id=d.incident_id WHERE d.status IN ('queued','retry','sending') AND d.next_attempt_at<=? AND (d.lease_until IS NULL OR d.lease_until<=?) AND (i.snoozed_until<=? OR d.event='resolved') ORDER BY d.next_attempt_at LIMIT 1",
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
  let success = false;
  try {
    const secret = new CredentialVault().decrypt(JSON.parse(delivery.secret_envelope));
    const status = await send(delivery.destination_url, delivery.payload_json, secret, delivery.id);
    success = status >= 200 && status < 300;
  } catch {
    /* Persist only a sanitized application code. */
  }
  const attempts = delivery.attempts + 1;
  await db.execute(
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
  return { id: delivery.id, success };
}
