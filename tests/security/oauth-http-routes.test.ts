import { afterEach, describe, expect, it } from "vitest";
import { createSignedOAuthState } from "../../src/lib/auth/oauth-state";
import { handleGoogleOAuthCallback, handleGoogleOAuthInitiation, type OAuthHttpRouteDependencies } from "../../src/lib/auth/oauth-http-routes";
import { Route as GoogleRoute } from "../../src/routes/api/auth/google";
import { Route as CallbackRoute } from "../../src/routes/api/auth/callback";

const originalClientId = process.env.GOOGLE_CLIENT_ID;
const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;

function deps(overrides: Partial<OAuthHttpRouteDependencies> = {}): OAuthHttpRouteDependencies {
  return {
    getDatabase: () => ({}) as any,
    createGoogleClient: () => ({
      createAuthorizationURL: async () => new URL("https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fcallback"),
      validateAuthorizationCode: async () => ({ accessToken: "google-token" }) as any,
    }),
    fetchUserInfo: async () => ({ sub: "google-1", email: "verified@example.test", email_verified: true, name: "Verified", picture: "" }),
    provisionScope: async () => ({ personId: "person-1", tenantId: "tenant-1", isNewUser: false, needsOnboarding: false }),
    createSession: async () => ({ id: "session-1", userId: "person-1", expiresAt: new Date("2030-01-01T00:00:00Z") }),
    generateSessionToken: () => "session-token",
    generateState: () => "raw-state",
    generateCodeVerifier: () => "pkce-verifier",
    ...overrides,
  };
}

describe("OAuth raw HTTP routes", () => {
  afterEach(() => {
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
  });

  it("GET /api/auth/google returns a real Google redirect with callback and PKCE cookies", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const response = await handleGoogleOAuthInitiation(new Request("http://localhost:3000/api/auth/google", { headers: { host: "localhost:3000" } }), deps());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("accounts.google.com");
    expect(response.headers.get("location")).toContain("api%2Fauth%2Fcallback");
    expect(response.headers.get("set-cookie")).toContain("google_oauth_state=");
    expect(response.headers.get("set-cookie")).toContain("google_code_verifier=");
  });

  it("GET /api/auth/callback is a controlled OAuth failure, never a route 404", async () => {
    const handler = (CallbackRoute.options.server!.handlers as any).GET;
    const response = await handler({
      request: new Request("http://localhost:3000/api/auth/callback", { headers: { host: "localhost:3000" } }),
      context: {}, params: {}, pathname: "/api/auth/callback", next: () => ({ isNext: true, context: {} }),
    });
    expect(response.status).toBe(400);
    expect(response.status).not.toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "OAuth authentication failed" });
  });

  it("the production Google route itself exposes a GET redirect handler", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const handler = (GoogleRoute.options.server!.handlers as any).GET;
    const response = await handler({
      request: new Request("http://localhost:3000/api/auth/google", { headers: { host: "localhost:3000" } }),
      context: {}, params: {}, pathname: "/api/auth/google", next: () => ({ isNext: true, context: {} }),
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("accounts.google.com");
  });

  it("successful mocked callback provisions scope, creates a session, and redirects an existing user", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const state = createSignedOAuthState("raw", "verifier");
    const provisionScope = async () => ({ personId: "person-1", tenantId: "tenant-1", isNewUser: false, needsOnboarding: false });
    const response = await handleGoogleOAuthCallback(
      new Request(`http://localhost:3000/api/auth/callback?code=valid&state=${encodeURIComponent(state)}`, { headers: { host: "localhost:3000" } }),
      deps({ provisionScope }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("radar_session=session-token");
  });

  it("onboarding status, not identity age, controls the profile redirect; tampered state issues no session", async () => {
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const goodState = createSignedOAuthState("raw", "verifier");
    const newUser = await handleGoogleOAuthCallback(
      new Request(`http://localhost:3000/api/auth/callback?code=valid&state=${encodeURIComponent(goodState)}`, { headers: { host: "localhost:3000" } }),
      deps({ provisionScope: async () => ({ personId: "person-1", tenantId: "tenant-1", isNewUser: false, needsOnboarding: true }) }),
    );
    expect(newUser.headers.get("location")).toBe("/profile");

    const invalid = await handleGoogleOAuthCallback(new Request("http://localhost:3000/api/auth/callback?code=valid&state=tampered", { headers: { host: "localhost:3000" } }), deps());
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("set-cookie")).toBeNull();
  });

  it("production route files use raw GET handlers rather than loaders/server functions", async () => {
    const fs = await import("node:fs");
    const googleRoute = fs.readFileSync("src/routes/api/auth/google.ts", "utf8");
    const callbackRoute = fs.readFileSync("src/routes/api/auth/callback.ts", "utf8");
    for (const source of [googleRoute, callbackRoute]) {
      expect(source).toContain("server:");
      expect(source).toContain("handlers:");
      expect(source).toContain("GET:");
      expect(source).not.toContain("createServerFn");
      expect(source).not.toContain("loader:");
    }
  });
});
