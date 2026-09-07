import { generateCodeVerifier, generateState, Google } from "arctic";
import type { DatabaseAdapter } from "../../data/database";
import { getDatabaseAdapter } from "../../data/database";
import { fetchGoogleUserInfo, type GoogleUserInfo } from "./google";
import { createSignedOAuthState, verifySignedOAuthState } from "./oauth-state";
import { provisionOAuthScope, type OAuthIdentity, type ProvisionedOAuthScope } from "./oauth-scope-provisioning";
import { resolveGoogleCallbackUrl, shouldUseSecureOAuthCookie } from "./oauth-callback-url";
import { createSession, generateSessionToken, SESSION_COOKIE_NAME } from "./session";

type GoogleClient = Pick<Google, "createAuthorizationURL" | "validateAuthorizationCode">;

export interface OAuthHttpRouteDependencies {
  readonly getDatabase: () => Promise<DatabaseAdapter> | DatabaseAdapter;
  readonly createGoogleClient: (clientId: string, clientSecret: string, redirectUri: string) => GoogleClient;
  readonly fetchUserInfo: (accessToken: string) => Promise<GoogleUserInfo>;
  readonly provisionScope: (db: DatabaseAdapter, identity: OAuthIdentity, createId: () => string) => Promise<ProvisionedOAuthScope>;
  readonly createSession: typeof createSession;
  readonly generateSessionToken: typeof generateSessionToken;
  readonly generateState: typeof generateState;
  readonly generateCodeVerifier: typeof generateCodeVerifier;
}

const defaultDependencies: OAuthHttpRouteDependencies = {
  getDatabase: getDatabaseAdapter,
  createGoogleClient: (clientId, clientSecret, redirectUri) => new Google(clientId, clientSecret, redirectUri),
  fetchUserInfo: fetchGoogleUserInfo,
  provisionScope: provisionOAuthScope,
  createSession,
  generateSessionToken,
  generateState,
  generateCodeVerifier,
};

function getHost(request: Request): string {
  return request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
}

function getCookie(request: Request, name: string): string | null {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function makeCookie(name: string, value: string, host: string, maxAge: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
    shouldUseSecureOAuthCookie(host) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function clearedCookie(name: string, host: string): string {
  return makeCookie(name, "", host, 0);
}

function redirectResponse(location: string, headers = new Headers()): Response {
  headers.set("Location", location);
  return new Response(null, { status: 302, headers });
}

function oauthFailure(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: "OAuth authentication failed", message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function ulid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

function googleCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Raw GET handler: browser navigation receives a genuine OAuth redirect. */
export async function handleGoogleOAuthInitiation(
  request: Request,
  dependencies: OAuthHttpRouteDependencies = defaultDependencies,
): Promise<Response> {
  const credentials = googleCredentials();
  if (!credentials) return redirectResponse("/login?error=missing_google_credentials");

  try {
    const host = getHost(request);
    const redirectUri = resolveGoogleCallbackUrl(host, process.env.GOOGLE_REDIRECT_URI);
    const google = dependencies.createGoogleClient(credentials.clientId, credentials.clientSecret, redirectUri);
    const rawState = dependencies.generateState();
    const verifier = dependencies.generateCodeVerifier();
    const signedState = createSignedOAuthState(rawState, verifier);
    const authorizationUrl = await google.createAuthorizationURL(signedState, verifier, {
      scopes: ["openid", "email", "profile"],
    });
    const headers = new Headers();
    headers.append("Set-Cookie", makeCookie("google_oauth_state", signedState, host, 900));
    headers.append("Set-Cookie", makeCookie("google_code_verifier", verifier, host, 900));
    return redirectResponse(authorizationUrl.toString(), headers);
  } catch (error) {
    return oauthFailure(error instanceof Error ? error.message : "OAuth initiation failed.", 500);
  }
}

/** Raw GET handler: validates OAuth state, provisions scope, then issues a session. */
export async function handleGoogleOAuthCallback(
  request: Request,
  dependencies: OAuthHttpRouteDependencies = defaultDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const signedState = verifySignedOAuthState(stateParam);
  const storedState = getCookie(request, "google_oauth_state");
  const storedVerifier = getCookie(request, "google_code_verifier");
  const verifier = signedState?.verifier || storedVerifier;
  const legacyStateValid = !signedState && Boolean(storedState && storedState === stateParam && storedVerifier);
  if (!code || (!signedState && !legacyStateValid) || !verifier) {
    return oauthFailure("Invalid OAuth state. Possible CSRF attempt.");
  }

  const credentials = googleCredentials();
  if (!credentials) return oauthFailure("Google OAuth credentials are not configured.", 503);

  const host = getHost(request);
  try {
    const redirectUri = resolveGoogleCallbackUrl(host, process.env.GOOGLE_REDIRECT_URI);
    const google = dependencies.createGoogleClient(credentials.clientId, credentials.clientSecret, redirectUri);
    const tokens = await google.validateAuthorizationCode(code, verifier);
    const user = await dependencies.fetchUserInfo(tokens.accessToken);
    // Provisioning independently rejects unverified email before any identity row changes.
    const scope = await dependencies.provisionScope(await dependencies.getDatabase(), {
      provider: "google", providerUserId: user.sub, email: user.email,
      name: user.name, avatarUrl: user.picture, emailVerified: user.email_verified,
    }, ulid);
    const token = dependencies.generateSessionToken();
    const session = await dependencies.createSession(token, scope.personId);
    const headers = new Headers();
    headers.append("Set-Cookie", clearedCookie("google_oauth_state", host));
    headers.append("Set-Cookie", clearedCookie("google_code_verifier", host));
    headers.append("Set-Cookie", [
      `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`, "HttpOnly", "SameSite=Lax", "Path=/",
      `Expires=${session.expiresAt.toUTCString()}`,
      shouldUseSecureOAuthCookie(host) ? "Secure" : "",
    ].filter(Boolean).join("; "));
    return redirectResponse(scope.needsOnboarding ? "/profile" : "/", headers);
  } catch (error) {
    return oauthFailure(error instanceof Error ? error.message : "OAuth callback failed.", 500);
  }
}
