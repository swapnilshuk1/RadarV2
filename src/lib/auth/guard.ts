/**
 * src/lib/auth/guard.ts
 *
 * Centralized server-side authentication & authorization guard.
 * Strictly enforces session validation and role requirements with zero fallbacks.
 */

import { getCookie } from "@tanstack/react-start/server";
import {
  validateSessionToken,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from "./session";

export class AuthError extends Error {
  statusCode: number;
  status: number;

  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.status = statusCode;
  }
}

/**
 * Enforces strict authentication for server functions.
 * Throws a 401 AuthError if unauthenticated or expired.
 * Throws a 403 AuthError if requireAdmin is true and role !== "admin".
 */
export async function requireAuthUser(options?: { requireAdmin?: boolean }): Promise<SessionUser> {
  let token: string | undefined;
  try {
    token = getCookie(SESSION_COOKIE_NAME);
  } catch {
    token = undefined;
  }

  if (!token) {
    throw new AuthError("UNAUTHORIZED: Authentication session required", 401);
  }

  const { user } = await validateSessionToken(token);
  if (!user || !user.id) {
    throw new AuthError("UNAUTHORIZED: Invalid or expired session", 401);
  }

  if (options?.requireAdmin && user.role !== "admin") {
    throw new AuthError("FORBIDDEN: Admin privileges required", 403);
  }

  return user;
}

export type { SessionUser };
