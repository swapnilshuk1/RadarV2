/**
 * src/routes/api/auth/logout.ts
 *
 * GET /api/auth/logout
 * Invalidates the current session and clears the session cookie.
 * Redirects to /login.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import {
  invalidateSession,
  SESSION_COOKIE_NAME
} from "../../../lib/auth/session";

const logoutFn = createServerFn({ method: "GET" }).handler(async () => {
  const token = getCookie(SESSION_COOKIE_NAME);

  if (token) {
    await invalidateSession(token);
  }

  setCookie(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });

  return true;
});

export const Route = createFileRoute("/api/auth/logout")({
  loader: async () => {
    await logoutFn();
    throw redirect({ to: "/login" });
  },
});
