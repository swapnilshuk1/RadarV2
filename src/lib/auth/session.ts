/**
 * src/lib/auth/session.ts
 *
 * Server-side session management using oslo tokens + DatabaseAdapter.
 * HTTP-only cookie based — JS cannot read or forge sessions.
 * ADR-008: Auth resolves user at boundary; never bleeds into business logic.
 */

import { encodeBase32LowerCaseNoPadding, decodeBase32UpperCaseNoPadding } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { getDatabaseAdapter } from "../../data/database/index";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  onboarded: boolean;
  role: string;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}

export type SessionValidationResult =
  | { session: Session; user: SessionUser }
  | { session: null; user: null };

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_COOKIE_NAME = "radar_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000; // Refresh if < 15 days left

// ─── Token Generation ─────────────────────────────────────────────────────────

/**
 * Generates a cryptographically secure session token.
 * Token is 20 random bytes encoded as base32 (no padding).
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

/**
 * Hashes a session token for storage.
 * We never store the raw token — only its SHA-256 hash.
 */
function hashToken(token: string): string {
  const encoded = new TextEncoder().encode(token);
  const hash = sha256(encoded);
  return Buffer.from(hash).toString("hex");
}

// ─── Session CRUD ─────────────────────────────────────────────────────────────

export async function createSession(token: string, userId: string): Promise<Session> {
  const db = await getDatabaseAdapter();
  const sessionId = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.execute(
    `INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
    [sessionId, userId, Math.floor(expiresAt.getTime() / 1000)]
  );

  return { id: sessionId, userId, expiresAt };
}

export async function validateSessionToken(token: string): Promise<SessionValidationResult> {
  const db = await getDatabaseAdapter();
  const sessionId = hashToken(token);
  const now = Math.floor(Date.now() / 1000);

  const row = await db.one<{
    session_id: string;
    user_id: string;
    expires_at: number;
    email: string;
    name: string;
    avatar_url: string | null;
    onboarded: number;
    role: string;
  }>(
    `SELECT s.id as session_id, s.user_id, s.expires_at,
            p.email, p.name, p.avatar_url, p.onboarded, p.role
     FROM auth_sessions s
     JOIN people p ON s.user_id = p.id
     WHERE s.id = ? AND s.expires_at > ?`,
    [sessionId, now]
  );

  if (!row) return { session: null, user: null };

  const expiresAt = new Date(row.expires_at * 1000);

  // Refresh session if close to expiry
  if (Date.now() + SESSION_REFRESH_THRESHOLD_MS > expiresAt.getTime()) {
    const newExpiry = new Date(Date.now() + SESSION_DURATION_MS);
    await db.execute(
      `UPDATE auth_sessions SET expires_at = ? WHERE id = ?`,
      [Math.floor(newExpiry.getTime() / 1000), sessionId]
    );
    expiresAt.setTime(newExpiry.getTime());
  }

  return {
    session: { id: sessionId, userId: row.user_id, expiresAt },
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url,
      onboarded: row.onboarded === 1,
      role: row.role,
    },
  };
}

export async function invalidateSession(token: string): Promise<void> {
  const db = await getDatabaseAdapter();
  const sessionId = hashToken(token);
  await db.execute(`DELETE FROM auth_sessions WHERE id = ?`, [sessionId]);
}

// ─── Cookie Helpers ────────────────────────────────────────────────────────────

export function getSessionCookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`));
  return match?.[1] ?? null;
}

export function makeSessionCookie(token: string, expiresAt: Date): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Path=/`,
    `Expires=${expiresAt.toUTCString()}`,
  ].join("; ");
}

export function makeBlankSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Lax`,
    `Path=/`,
    `Max-Age=0`,
  ].join("; ");
}

export { SESSION_COOKIE_NAME };
