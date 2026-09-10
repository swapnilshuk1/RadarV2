import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface ExclusiveLockOwner {
  ownerId?: string;
  runId?: string;
  profileKey?: string;
}

export interface ExclusiveLockMetadata {
  pid: number;
  nonce: string;
  ownerId: string;
  runId?: string;
  profileKey?: string;
  createdAt: string;
}

export interface ExclusiveLockToken extends ExclusiveLockMetadata {
  lockPath: string;
}

export type LockOwner = string | ExclusiveLockOwner;

export interface LockDeps {
  isProcessAlive?: (pid: number) => boolean;
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means a process exists but we cannot signal it.
    return err?.code === "EPERM";
  }
}

export function normalizeOwner(owner: LockOwner): {
  ownerId: string;
  runId?: string;
  profileKey?: string;
} {
  if (typeof owner === "string") {
    return { ownerId: owner };
  }

  const ownerId =
    owner.ownerId ??
    (owner.runId ? `run:${owner.runId}` : undefined) ??
    (owner.profileKey ? `profile:${owner.profileKey}` : undefined);

  if (!ownerId) {
    throw new Error("EXCLUSIVE_LOCK_OWNER_REQUIRED");
  }

  return {
    ownerId,
    runId: owner.runId,
    profileKey: owner.profileKey,
  };
}

export function readExclusiveLock(
  lockPath: string,
): ExclusiveLockMetadata | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(lockPath, "utf8"),
    );

    if (!Number.isInteger(parsed?.pid)) {
      return null;
    }

    const runId =
      typeof parsed.runId === "string" && parsed.runId
        ? parsed.runId
        : undefined;

    const profileKey =
      typeof parsed.profileKey === "string" &&
      parsed.profileKey
        ? parsed.profileKey
        : undefined;

    const ownerId =
      typeof parsed.ownerId === "string" &&
      parsed.ownerId
        ? parsed.ownerId
        : runId
          ? `run:${runId}`
          : profileKey
            ? `profile:${profileKey}`
            : null;

    if (!ownerId) {
      return null;
    }

    const createdAt =
      typeof parsed.createdAt === "string" &&
      parsed.createdAt
        ? parsed.createdAt
        : typeof parsed.startedAt === "string" &&
            parsed.startedAt
          ? parsed.startedAt
          : new Date(0).toISOString();

    /*
     * New-format locks carry a true random nonce.
     * Historical RADAR .owner locks did not.
     *
     * Give a legacy lock a deterministic synthetic identity rather than
     * assigning every legacy lock the same fake nonce. This preserves the
     * stale-reclaim compare-before-unlink invariant.
     */
    const nonce =
      typeof parsed.nonce === "string" && parsed.nonce
        ? parsed.nonce
        : `legacy:${crypto
            .createHash("sha256")
            .update(
              JSON.stringify({
                pid: parsed.pid,
                ownerId,
                runId: runId ?? null,
                profileKey: profileKey ?? null,
                createdAt,
              }),
            )
            .digest("hex")}`;

    return {
      pid: parsed.pid,
      nonce,
      ownerId,
      runId,
      profileKey,
      createdAt,
    };
  } catch {
    return null;
  }
}

function sameOwner(
  left: ExclusiveLockMetadata,
  right: ExclusiveLockMetadata,
): boolean {
  return (
    left.pid === right.pid &&
    left.nonce === right.nonce &&
    left.ownerId === right.ownerId
  );
}

function writeExclusive(
  lockPath: string,
  owner: LockOwner,
): ExclusiveLockToken {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const normalized = normalizeOwner(owner);

  const token: ExclusiveLockToken = {
    lockPath,
    pid: process.pid,
    nonce: crypto.randomUUID(),
    ownerId: normalized.ownerId,
    runId: normalized.runId,
    profileKey: normalized.profileKey,
    createdAt: new Date().toISOString(),
  };

  const fd = fs.openSync(lockPath, "wx");
  try {
    const payload: Record<string, unknown> = {
      pid: token.pid,
      nonce: token.nonce,
      ownerId: token.ownerId,
      createdAt: token.createdAt,
    };
    if (token.runId) payload.runId = token.runId;
    if (token.profileKey) payload.profileKey = token.profileKey;

    fs.writeFileSync(
      fd,
      JSON.stringify(payload, null, 2),
      "utf8",
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  return token;
}

export function acquireExclusiveLock(
  lockPath: string,
  owner: LockOwner,
  deps: LockDeps = {},
): ExclusiveLockToken {
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive;
  const normalized = normalizeOwner(owner);

  try {
    return writeExclusive(lockPath, normalized);
  } catch (err: any) {
    if (err?.code !== "EEXIST") throw err;
  }

  const observedOwner = readExclusiveLock(lockPath);

  // Never infer stale ownership from unreadable metadata.
  if (!observedOwner) {
    throw new Error(
      `LOCK_METADATA_UNREADABLE: ${lockPath}. Operator recovery required.`,
    );
  }

  if (isProcessAlive(observedOwner.pid)) {
    throw new Error(
      `LOCK_ALREADY_OWNED: ${lockPath} is owned by live PID ${observedOwner.pid}. ` +
      `Refusing concurrent ownership (EXCLUSIVE_LOCK_ACTIVE).`
    );
  }

  /*
   * Serialized stale reclamation.
   *
   * Important: a dead-PID check by itself does NOT authorize a naked unlink.
   * Two contenders can both observe the same dead owner. The reclaim mutex
   * serializes revalidation + replacement of the primary lock.
   */
  const reclaimPath = `${lockPath}.reclaim`;
  let reclaimToken: ExclusiveLockToken;

  try {
    reclaimToken = writeExclusive(
      reclaimPath,
      `reclaim:${process.pid}:${normalized.ownerId}`,
    );
  } catch (err: any) {
    if (err?.code === "EEXIST") {
      throw new Error(
        `LOCK_RECLAIM_IN_PROGRESS: ${lockPath}. Refusing concurrent stale-lock reclamation.`,
      );
    }
    throw err;
  }

  try {
    const currentOwner = readExclusiveLock(lockPath);

    if (!currentOwner) {
      throw new Error(
        `LOCK_METADATA_UNREADABLE_DURING_RECLAIM: ${lockPath}. Operator recovery required.`,
      );
    }

    // The primary lock changed after our first read. Do not touch it.
    if (!sameOwner(currentOwner, observedOwner)) {
      throw new Error(
        `LOCK_OWNER_CHANGED: ${lockPath} changed ownership during stale-lock reclamation.`,
      );
    }

    if (isProcessAlive(currentOwner.pid)) {
      throw new Error(
        `LOCK_OWNER_REVIVED: ${lockPath} owner PID ${currentOwner.pid} is alive.`,
      );
    }

    fs.unlinkSync(lockPath);

    // We still hold the reclaim mutex here.
    return writeExclusive(lockPath, normalized);
  } finally {
    releaseExclusiveLock(reclaimToken);
  }
}

export function releaseExclusiveLock(
  token: ExclusiveLockToken | null | undefined,
): void {
  if (!token) return;

  const existing = readExclusiveLock(token.lockPath);
  if (!existing) return;

  if (
    existing.pid !== token.pid ||
    existing.nonce !== token.nonce ||
    existing.ownerId !== token.ownerId
  ) {
    // Never delete somebody else's lock.
    return;
  }

  try {
    fs.unlinkSync(token.lockPath);
  } catch {
    // Best-effort shutdown cleanup.
  }
}
