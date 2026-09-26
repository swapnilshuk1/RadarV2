import { getDatabaseAdapter } from "../../data/database";
import {
  verifyMigrationChecksums,
  verifyRequiredSchema,
} from "../../data/sqlite/migrations/runner";

export type ReadinessPayload = {
  readonly status: "ready" | "unavailable";
  readonly releaseSha: string;
};

function releaseSha(): string {
  // This is injected by the verified release manifest at activation time. It is
  // deliberately the only deployment detail exposed by the public probe.
  return process.env.RADAR_RELEASE_SHA ?? "development";
}

export async function getReadiness(): Promise<{ status: number; body: ReadinessPayload }> {
  try {
    const db = getDatabaseAdapter();
    await verifyMigrationChecksums(db);
    await verifyRequiredSchema(db);
    return { status: 200, body: { status: "ready", releaseSha: releaseSha() } };
  } catch {
    return { status: 503, body: { status: "unavailable", releaseSha: releaseSha() } };
  }
}

export async function readyResponse(): Promise<Response> {
  const readiness = await getReadiness();
  return new Response(JSON.stringify(readiness.body), {
    status: readiness.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
