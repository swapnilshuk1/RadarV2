import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import { requirePlatformRole } from "./service";
import { loadMantleCredentials } from "../lib/model/bedrock-credentials";
import { adcTokenProvider } from "../lib/model/google-adc";

export async function pollHostProviderCheck(
  db: DatabaseAdapter,
  worker: { name: string; instance: string; database: string },
  request: typeof fetch = fetch,
  token = adcTokenProvider(),
) {
  const provider =
    worker.name === "dossier-review" ? "google" : worker.name === "evaluation" ? "bedrock" : null;
  if (!provider) return null;
  const now = Date.now(),
    lease = randomUUID();
  const check = await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE provider_host_checks SET status='failed',error_code='CHECK_LEASE_EXPIRED',completed_at=? WHERE status='running' AND lease_until<=?",
      [now, now],
    );
    const row = await tx.one<{ id: string; created_by: string }>(
      "SELECT id,created_by FROM provider_host_checks WHERE provider=? AND status='queued' ORDER BY created_at LIMIT 1",
      [provider],
    );
    if (!row) return null;
    const claimed = await tx.execute(
      "UPDATE provider_host_checks SET status='running',lease_token=?,lease_until=?,worker_name=?,worker_instance=?,release_sha=?,database_fingerprint=? WHERE id=? AND status='queued'",
      [
        lease,
        now + 60000,
        worker.name,
        worker.instance,
        process.env.RADAR_RELEASE_SHA ?? "development",
        worker.database,
        row.id,
      ],
    );
    return claimed.rowsAffected ? row : null;
  });
  if (!check) return null;
  let error: string | null = null;
  const details: Record<string, string> = { mode: "host-managed", permission: "unverified" };
  try {
    await requirePlatformRole(db, check.created_by, true);
    if (provider === "google") {
      await token();
      details.authentication = "passed";
      details.project = process.env.GCP_PROJECT_ID ?? "unconfigured";
      if (!process.env.GCP_PROJECT_ID) error = "ADC_PROJECT_UNCONFIGURED";
      // Token issuance proves authentication, not access to a particular model.
    } else {
      loadMantleCredentials();
      const key = process.env.BEDROCK_MANTLE_API_KEY?.trim();
      if (!key) throw new Error();
      const response = await request("https://bedrock-mantle.us-east-1.api.aws/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) error = `BEDROCK_AUTH_HTTP_${response.status}`;
      else {
        details.authentication = "passed";
        details.permission = "model catalog accessible";
      }
    }
  } catch {
    error = provider === "google" ? "ADC_AUTH_UNAVAILABLE" : "BEDROCK_AUTH_UNAVAILABLE";
  }
  await db.execute(
    "UPDATE provider_host_checks SET status=?,error_code=?,details_json=?,completed_at=?,lease_until=NULL WHERE id=? AND status='running' AND lease_token=? AND lease_until>?",
    [
      error ? "failed" : "passed",
      error,
      JSON.stringify(details),
      Date.now(),
      check.id,
      lease,
      Date.now(),
    ],
  );
  return { id: check.id, status: error ? "failed" : "passed" };
}
