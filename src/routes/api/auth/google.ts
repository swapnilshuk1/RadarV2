/**
 * src/routes/api/auth/google.ts
 *
 * GET /api/auth/google
 * Initiates the Google OAuth2 flow. Redirects to Google consent screen.
 * Stores PKCE state + verifier in a short-lived cookie.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import { generateState, generateCodeVerifier, Google } from "arctic";
import { createSignedOAuthState } from "../../../lib/auth/oauth-state";

const initiateGoogleAuthFn = createServerFn({ method: "GET" }).handler(async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const request = getRequest();
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "http");

  const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
  const redirectUri = isLocal
    ? `${proto}://${host}/api/auth/callback`
    : (process.env.GOOGLE_REDIRECT_URI || `${proto}://${host}/api/auth/callback`);

  if (!clientId || !clientSecret) {
    console.warn("[Auth] GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not configured.");
    return "/login?error=missing_google_credentials";
  }

  const google = new Google(clientId, clientSecret, redirectUri);
  const rawState = generateState();
  const codeVerifier = generateCodeVerifier();
  const compositeState = createSignedOAuthState(rawState, codeVerifier);

  const url = await google.createAuthorizationURL(compositeState, codeVerifier, {
    scopes: ["openid", "email", "profile"],
  });

  return url.toString();
});

export const Route = createFileRoute("/api/auth/google")({
  loader: async () => {
    const url = await initiateGoogleAuthFn();
    throw redirect({ href: url });
  },
});
