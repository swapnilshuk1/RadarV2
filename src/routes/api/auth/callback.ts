/** Google OAuth callback: provision complete scope before issuing a session. */
import { createFileRoute } from "@tanstack/react-router";
import { handleGoogleOAuthCallback } from "../../../lib/auth/oauth-http-routes";

export const Route = createFileRoute("/api/auth/callback")({
  server: {
    handlers: {
      GET: ({ request }) => handleGoogleOAuthCallback(request),
    },
  },
});
