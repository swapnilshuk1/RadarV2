/**
 * src/routes/api/auth/google.ts
 *
 * GET /api/auth/google
 * Initiates the Google OAuth2 flow. Redirects to Google consent screen.
 * Stores PKCE state + verifier in a short-lived cookie.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { generateState, generateCodeVerifier, Google } from "arctic";

const initiateGoogleAuthFn = createServerFn({ method: "GET" }).handler(async () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    (process.env.NODE_ENV === "production"
      ? "https://radarv2.onrender.com/api/auth/callback"
      : "http://localhost:3000/api/auth/callback");

  if (!clientId || !clientSecret) {
    console.warn("[Auth] GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not configured.");
    return "/login?error=missing_google_credentials";
  }

  const google = new Google(clientId, clientSecret, redirectUri);
  const state = generateState();
  const codeVerifier = generateCodeVerifier();

  const url = await google.createAuthorizationURL(state, codeVerifier, {
    scopes: ["openid", "email", "profile"],
  });

  const isProd = process.env.NODE_ENV === "production";
  setCookie("google_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: isProd });
  setCookie("google_code_verifier", codeVerifier, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure: isProd });

  return url.toString();
});

export const Route = createFileRoute("/api/auth/google")({
  loader: async () => {
    const url = await initiateGoogleAuthFn();
    throw redirect({ href: url });
  },
});
