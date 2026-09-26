import { afterEach, describe, expect, it } from "vitest";
import { getReadiness } from "../../src/lib/health/readiness";
import { resetDatabaseAdapter } from "../../src/data/database";

describe("release readiness", () => {
  const original = { ...process.env };

  afterEach(() => {
    resetDatabaseAdapter();
    process.env = { ...original };
  });

  it("fails closed without a reachable, verified database and exposes no target details", async () => {
    process.env.RADAR_RELEASE_SHA = "a".repeat(40);
    process.env.RADAR_ENV = "production";
    delete process.env.TURSO_CONNECTION_URL;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    const readiness = await getReadiness();
    expect(readiness).toEqual({
      status: 503,
      body: { status: "unavailable", releaseSha: "a".repeat(40) },
    });
    expect(JSON.stringify(readiness.body)).not.toMatch(/turso|token|candidate|person/i);
  });
});
