/**
 * src/lib/auth/server.ts
 *
 * TanStack Start server function that resolves the session user from
 * the HTTP-only cookie on every request.
 * ADR-008: This is the AUTH BOUNDARY. Business logic receives userId only.
 */

import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import {
  validateSessionToken,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from "./session";

/**
 * Resolves the authenticated user from the session cookie.
 * Returns null if unauthenticated or session expired.
 * Use this in server functions that need the current user.
 */
export const getSessionUserFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<SessionUser | null> => {
    const token = getCookie(SESSION_COOKIE_NAME);
    if (!token) return null;

    const { user } = await validateSessionToken(token);
    return user;
  });
