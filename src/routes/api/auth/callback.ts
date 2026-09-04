/** Google OAuth callback: provision complete scope before issuing a session. */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getCookie, setCookie } from "@tanstack/react-start/server";
import { Google } from "arctic";
import { getDatabaseAdapter } from "../../../data/database/index";
import { generateSessionToken, createSession, SESSION_COOKIE_NAME } from "../../../lib/auth/session";
import { fetchGoogleUserInfo } from "../../../lib/auth/google";
import { verifySignedOAuthState } from "../../../lib/auth/oauth-state";
import { provisionOAuthScope } from "../../../lib/auth/oauth-scope-provisioning";

function ulid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

const handleCallbackFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthState = verifySignedOAuthState(stateParam);
  const storedState = getCookie("google_oauth_state");
  const storedVerifier = getCookie("google_code_verifier");
  const codeVerifier = oauthState?.verifier || storedVerifier;
  if (!code || (!oauthState && (!storedState || storedState !== stateParam || !storedVerifier)) || !codeVerifier) {
    throw new Error("[Auth] Invalid OAuth state. Possible CSRF attempt.");
  }

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const redirectUri = host.includes("localhost") || host.includes("127.0.0.1")
    ? `${proto}://${host}/api/auth/callback`
    : (process.env.GOOGLE_REDIRECT_URI || `${proto}://${host}/api/auth/callback`);
  const google = new Google(process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!, redirectUri);
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  const googleUser = await fetchGoogleUserInfo(tokens.accessToken);

  const provisioned = await provisionOAuthScope(await getDatabaseAdapter(), {
    provider: "google", providerUserId: googleUser.sub, email: googleUser.email,
    name: googleUser.name, avatarUrl: googleUser.picture, emailVerified: googleUser.email_verified,
  }, ulid);
  const token = generateSessionToken();
  const session = await createSession(token, provisioned.personId);
  setCookie("google_oauth_state", "", { maxAge: 0, path: "/" });
  setCookie("google_code_verifier", "", { maxAge: 0, path: "/" });
  setCookie(SESSION_COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", path: "/", expires: session.expiresAt, secure: proto === "https" });
  return { isNewUser: provisioned.isNewUser };
});

export const Route = createFileRoute("/api/auth/callback")({
  loader: async () => {
    const { isNewUser } = await handleCallbackFn();
    throw redirect({ to: isNewUser ? "/profile" : "/" });
  },
});
