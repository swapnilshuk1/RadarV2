/**
 * src/routes/api/auth/callback.ts
 *
 * GET /api/auth/callback?code=...&state=...
 * Google OAuth2 callback handler.
 *
 * Flow:
 *  1. Validate state cookie (CSRF protection)
 *  2. Exchange code for access token via Arctic
 *  3. Fetch user info from Google userinfo endpoint
 *  4. Upsert person row (email match → existing user, no match → new user)
 *  5. Link oauth_accounts row (idempotent)
 *  6. Create session → set HttpOnly session cookie
 *  7. Redirect to / (or /onboard for new users)
 *
 * ADR-008: Auth resolves at this boundary. Only userId flows downstream.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getCookie, setCookie } from "@tanstack/react-start/server";
import { Google } from "arctic";
import { getDatabaseAdapter } from "../../../data/database/index";
import {
  generateSessionToken,
  createSession,
  SESSION_COOKIE_NAME
} from "../../../lib/auth/session";
import { fetchGoogleUserInfo } from "../../../lib/auth/google";

function ulid(): string {
  // Simple ULID-style ID: timestamp prefix + random suffix
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

const handleCallbackFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const storedState = getCookie("google_oauth_state");
  const codeVerifier = getCookie("google_code_verifier");

  // ── 1. CSRF validation ──────────────────────────────────────────────────
  if (!code || !state || !storedState || !codeVerifier || state !== storedState) {
    throw new Error("[Auth] Invalid OAuth state. Possible CSRF attempt.");
  }

  // ── 2. Exchange code for tokens ─────────────────────────────────────────
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    (process.env.NODE_ENV === "production"
      ? "https://radarv2.onrender.com/api/auth/callback"
      : "http://localhost:3000/api/auth/callback");

  const google = new Google(clientId, clientSecret, redirectUri);
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  const accessToken = tokens.accessToken;

  // ── 3. Fetch Google user profile ────────────────────────────────────────
  const googleUser = await fetchGoogleUserInfo(accessToken);

  // ── 4 & 5. Upsert person + link oauth_account ──────────────────────────
  const db = await getDatabaseAdapter();

  let personId: string;
  let isNewUser = false;

  // Check if oauth_accounts already has this Google user
  const existing = await db.one<{ user_id: string }>(
    `SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_user_id = ?`,
    [googleUser.sub]
  );

  if (existing) {
    personId = existing.user_id;
  } else {
    // Try to match by email (links existing Swapnil account)
    const byEmail = await db.one<{ id: string; onboarded: number }>(
      `SELECT id, onboarded FROM people WHERE email = ?`,
      [googleUser.email]
    );

    if (byEmail) {
      personId = byEmail.id;
      isNewUser = byEmail.onboarded === 0;
    } else {
      // Brand-new user — create person row
      personId = ulid();
      isNewUser = true;
      await db.execute(
        `INSERT INTO people (id, email, name, avatar_url, onboarded, role, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 'user', ?, datetime('now'), datetime('now'))`,
        [personId, googleUser.email, googleUser.name, googleUser.picture, googleUser.email_verified ? 1 : 0]
      );
    }

    // Link this Google account to the person
    await db.execute(
      `INSERT OR IGNORE INTO oauth_accounts (provider, provider_user_id, user_id) VALUES ('google', ?, ?)`,
      [googleUser.sub, personId]
    );

    // Update profile info (name, avatar) if signing in for first time
    await db.execute(
      `UPDATE people SET name = ?, avatar_url = ?, email_verified = ?, updated_at = datetime('now') WHERE id = ?`,
      [googleUser.name, googleUser.picture, googleUser.email_verified ? 1 : 0, personId]
    );
  }

  // ── 6. Create session ───────────────────────────────────────────────────
  const token = generateSessionToken();
  const session = await createSession(token, personId);

  // Clear PKCE cookies + set session cookie
  setCookie("google_oauth_state", "", { maxAge: 0, path: "/" });
  setCookie("google_code_verifier", "", { maxAge: 0, path: "/" });
  
  const isProd = process.env.NODE_ENV === "production";
  setCookie(SESSION_COOKIE_NAME, token, { 
    httpOnly: true, 
    sameSite: "lax", 
    path: "/", 
    expires: session.expiresAt, 
    secure: isProd 
  });

  return { isNewUser };
});

export const Route = createFileRoute("/api/auth/callback")({
  loader: async () => {
    const { isNewUser } = await handleCallbackFn();
    throw redirect({ to: isNewUser ? "/profile" : "/" });
  },
});
