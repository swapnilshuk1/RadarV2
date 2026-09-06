/**
 * src/lib/intelligence/cursor.ts
 *
 * RADAR v2 — Opaque Keyset Cursor Engine (ADR-SERVING-001).
 *
 * Encapsulates keyset pagination state behind an opaque, versioned token.
 * It is validated for shape and membership, not cryptographically signed.
 * Clients never inspect or construct keyset internals directly.
 *
 * Wire Format: `v1:<base64url-encoded-json>`
 * Keyset Ordering: `(population_tier ASC, quality_score DESC NULLS LAST, job_hash ASC)`
 */

export interface KeysetPosition {
  readonly tier: number;
  readonly score: number | null;
  readonly jobHash: string;
  /** Membership-defining feed filters bound to this cursor by the server. */
  readonly filterSignature?: string;
}

export type OpaqueCursor = string | null;

export class CursorValidationError extends Error {
  constructor(message: string) {
    super(`[CursorValidationError] ${message}`);
    this.name = "CursorValidationError";
  }
}

const CURSOR_VERSION_PREFIX = "v1:";
const JOB_HASH_REGEX = /^[a-zA-Z0-9_\-]+$/;

/**
 * Encodes a keyset position into an opaque, versioned token.
 */
export function encodeCursor(position: KeysetPosition): string {
  if (typeof position.tier !== "number" || !Number.isInteger(position.tier) || position.tier < 0 || position.tier > 5) {
    throw new CursorValidationError(`Invalid population tier: ${position.tier}. Must be an integer between 0 and 5.`);
  }

  if (position.score !== null && (typeof position.score !== "number" || Number.isNaN(position.score) || position.score < 0 || position.score > 100)) {
    throw new CursorValidationError(`Invalid quality score: ${position.score}. Must be null or a number between 0 and 100.`);
  }

  if (typeof position.jobHash !== "string" || !position.jobHash.trim() || !JOB_HASH_REGEX.test(position.jobHash)) {
    throw new CursorValidationError(`Invalid job hash: '${position.jobHash}'. Must be a non-empty alphanumeric string.`);
  }

  if (position.filterSignature !== undefined && (
    typeof position.filterSignature !== "string" ||
    position.filterSignature.length === 0 ||
    position.filterSignature.length > 512
  )) {
    throw new CursorValidationError("Invalid filter signature.");
  }

  const payload = {
    t: position.tier,
    s: position.score === null ? null : Math.round(position.score * 100) / 100,
    h: position.jobHash,
    ...(position.filterSignature === undefined ? {} : { f: position.filterSignature }),
  };

  const jsonStr = JSON.stringify(payload);
  const base64Url = Buffer.from(jsonStr, "utf-8").toString("base64url");
  return `${CURSOR_VERSION_PREFIX}${base64Url}`;
}

/**
 * Decodes and validates an opaque cursor into a strongly-typed KeysetPosition.
 * Returns null if the cursor is null, undefined, or an empty string (requesting page 1).
 * Throws CursorValidationError if the cursor is malformed, has an unknown version, or fails range checks.
 */
export function decodeCursor(cursor: string | null | undefined): KeysetPosition | null {
  if (!cursor || typeof cursor !== "string") {
    return null;
  }

  const trimmed = cursor.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!trimmed.startsWith(CURSOR_VERSION_PREFIX)) {
    throw new CursorValidationError(`Unsupported cursor version or invalid prefix. Expected '${CURSOR_VERSION_PREFIX}'.`);
  }

  const encodedPayload = trimmed.slice(CURSOR_VERSION_PREFIX.length);
  if (encodedPayload.length === 0) {
    throw new CursorValidationError("Empty cursor payload.");
  }

  let jsonStr: string;
  try {
    jsonStr = Buffer.from(encodedPayload, "base64url").toString("utf-8");
  } catch (err: any) {
    throw new CursorValidationError(`Failed to decode base64url cursor payload: ${err?.message || "Unknown error"}`);
  }

  let payload: any;
  try {
    payload = JSON.parse(jsonStr);
  } catch (err: any) {
    throw new CursorValidationError(`Malformed JSON in cursor payload: ${err?.message || "Invalid JSON"}`);
  }

  if (!payload || typeof payload !== "object") {
    throw new CursorValidationError("Cursor payload must be a JSON object.");
  }

  const tier = payload.t;
  const score = payload.s;
  const jobHash = payload.h;
  const filterSignature = payload.f;

  if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 0 || tier > 5) {
    throw new CursorValidationError(`Invalid cursor tier: ${tier}. Expected integer between 0 and 5.`);
  }

  if (score !== null && (typeof score !== "number" || Number.isNaN(score) || score < 0 || score > 100)) {
    throw new CursorValidationError(`Invalid cursor score: ${score}. Expected null or number between 0 and 100.`);
  }

  if (typeof jobHash !== "string" || !jobHash.trim() || !JOB_HASH_REGEX.test(jobHash)) {
    throw new CursorValidationError(`Invalid cursor job hash: '${jobHash}'.`);
  }

  if (filterSignature !== undefined && (
    typeof filterSignature !== "string" || filterSignature.length === 0 || filterSignature.length > 512
  )) {
    throw new CursorValidationError("Invalid cursor filter signature.");
  }

  return {
    tier,
    score,
    jobHash,
    ...(filterSignature === undefined ? {} : { filterSignature }),
  };
}
