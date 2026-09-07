/**
 * src/routes/api/auth/google.ts
 *
 * GET /api/auth/google
 * Initiates the Google OAuth2 flow. Redirects to Google consent screen.
 * Stores PKCE state + verifier in a short-lived cookie.
 */

import { createFileRoute } from "@tanstack/react-router";
import { handleGoogleOAuthInitiation } from "../../../lib/auth/oauth-http-routes";

export const Route = createFileRoute("/api/auth/google")({
  server: {
    handlers: {
      GET: ({ request }) => handleGoogleOAuthInitiation(request),
    },
  },
});
