/**
 * src/lib/auth/google.ts
 *
 * Arctic v1 Google OAuth2 client.
 * Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from environment.
 * ADR-008: Auth config lives here, never in business logic.
 */

import { Google } from "arctic";

function getGoogleClient(): Google {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ??
    (process.env.NODE_ENV === "production"
      ? "https://radarv2.onrender.com/api/auth/callback"
      : "http://localhost:3000/api/auth/callback");

  if (!clientId || !clientSecret) {
    throw new Error(
      "[Auth] GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment. " +
      "Create credentials at console.cloud.google.com."
    );
  }

  return new Google(clientId, clientSecret, redirectUri);
}

// Lazy singleton — only instantiated when first called
let _client: Google | null = null;
export function getGoogleOAuthClient(): Google {
  if (!_client) _client = getGoogleClient();
  return _client;
}

// Google's OpenID Connect userinfo response shape
export interface GoogleUserInfo {
  sub: string;       // Unique Google user ID
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
}

/**
 * Fetches the authenticated user's profile from Google's userinfo endpoint.
 * Called after the OAuth callback with the access token.
 */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`[Auth] Failed to fetch Google user info: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<GoogleUserInfo>;
}
