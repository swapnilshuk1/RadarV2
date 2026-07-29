/**
 * src/routes/api/auth/logout.ts
 *
 * GET /api/auth/logout
 * Invalidates the current session and clears the session cookie.
 * Redirects to /login.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getWebRequest, setResponseHeaders } from "@tanstack/react-start/server";
import {
  getSessionCookieValue,
  invalidateSession,
  makeBlankSessionCookie,
} from "../../../lib/auth/session";

const logoutFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getWebRequest();
  const cookieHeader = request?.headers.get("cookie") ?? null;
  const token = getSessionCookieValue(cookieHeader);

  if (token) {
    await invalidateSession(token);
  }

  setResponseHeaders({
    "Set-Cookie": makeBlankSessionCookie(),
    Location: "/login",
  });

  return new Response(null, { status: 302 });
});

export const Route = createFileRoute("/api/auth/logout")({
  loader: () => logoutFn(),
});
