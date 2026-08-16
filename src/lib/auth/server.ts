/**
 * src/lib/auth/server.ts
 *
 * TanStack Start server function for retrieving the current session user.
 * ADR-008: Auth resolves user at boundary; never bleeds into business logic.
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
 * Use this in route components and client contexts.
 */
export const getSessionUserFn = createServerFn({ method: "GET" })
  .handler(async (): Promise<SessionUser | null> => {
    let token: string | undefined;
    try {
      token = getCookie(SESSION_COOKIE_NAME);
    } catch {
      token = undefined;
    }
    if (!token) return null;

    const { user } = await validateSessionToken(token);
    return user;
  });

export type { SessionUser };
