/**
 * RADAR v4 — Sub-Phase M6.3: Credential Broker & JIT Leasing Engine
 *
 * Implements the tenant-isolated, RBAC-guarded Credential Broker responsible for:
 * 1. Credential registration and versioning
 * 2. Tenant-scoped credential resolution
 * 3. Pre-decryption authorization & lifecycle validation
 * 4. Just-In-Time (JIT) memory-only credential leasing
 * 5. Credential health reporting and error sanitization
 * 6. Revocation and rotation state transitions
 * 7. Comprehensive audit lineage
 *
 * HARD INVARIANTS:
 * - Authorization (tenant ownership + RBAC permission) MUST precede ciphertext decryption.
 * - Ciphertext decryption occurs strictly via CredentialVault.
 * - Leased credentials exist only in transient memory; never persisted to SQLite, audit logs, or telemetry.
 * - Zero plaintext secrets or cryptographic keys leaked in errors, logs, or audit records.
 */

import crypto from "crypto";
import type { AuthContext, Permission } from "./auth";
import { CredentialVault, CredentialVaultError } from "./CredentialVault";
import type { CredentialStore } from "../../domain/repositories";
import type { SourceCredential, CredentialStatus, CredentialAuditAction } from "../../domain/entities";

// ============================================================================
// 1. DOMAIN LEASE & BROKER ERROR TYPES
// ============================================================================

export interface CredentialLease {
  credentialId: string;
  tenantId: string;
  source: string;
  version: number;
  /**
   * Transient in-memory plaintext credential/session payload.
   * MUST NEVER be persisted to disk, database, audit logs, or telemetry.
   */
  secretPayload: string;
}

export type CredentialBrokerErrorCode =
  | "PERMISSION_DENIED"
  | "UNAUTHORIZED"
  | "CREDENTIAL_NOT_FOUND"
  | "INVALID_LIFECYCLE_TRANSITION"
  | "INELIGIBLE_STATUS"
  | "CREDENTIAL_EXPIRED"
  | "INVALID_INPUT";

export class CredentialBrokerError extends Error {
  public readonly code: CredentialBrokerErrorCode;

  constructor(message: string, code: CredentialBrokerErrorCode) {
    super(message);
    this.name = "CredentialBrokerError";
    this.code = code;
  }
}

export class CredentialAuthorizationError extends CredentialBrokerError {
  constructor(message = "Caller lacks required permission for this credential operation", code: CredentialBrokerErrorCode = "PERMISSION_DENIED") {
    super(message, code);
    this.name = "CredentialAuthorizationError";
  }
}

export class CredentialNotFoundError extends CredentialBrokerError {
  constructor(message = "Requested source credential was not found") {
    super(message, "CREDENTIAL_NOT_FOUND");
    this.name = "CredentialNotFoundError";
  }
}

export class CredentialLifecycleError extends CredentialBrokerError {
  constructor(message: string, code: CredentialBrokerErrorCode = "INVALID_LIFECYCLE_TRANSITION") {
    super(message, code);
    this.name = "CredentialLifecycleError";
  }
}

export class CredentialExpiredError extends CredentialBrokerError {
  constructor(message = "Source credential has expired and cannot be leased") {
    super(message, "CREDENTIAL_EXPIRED");
    this.name = "CredentialExpiredError";
  }
}

// ============================================================================
// 2. LIFECYCLE TRANSITION VALIDATOR
// ============================================================================

const VALID_TRANSITIONS: Record<CredentialStatus, ReadonlySet<CredentialStatus>> = {
  pending: new Set(["pending", "active", "invalid", "revoked"]),
  active: new Set(["active", "expiring", "invalid", "rotation_required", "revoked"]),
  expiring: new Set(["expiring", "active", "invalid", "rotation_required", "revoked"]),
  rotation_required: new Set(["rotation_required", "invalid", "revoked"]), // Superseded credential cannot be resurrected to active
  invalid: new Set(["invalid", "pending", "active", "revoked"]),
  revoked: new Set(["revoked"]), // Terminal state: cannot transition out
};

function isValidLifecycleTransition(currentStatus: CredentialStatus, nextStatus: CredentialStatus): boolean {
  if (currentStatus === nextStatus) return true;
  return VALID_TRANSITIONS[currentStatus]?.has(nextStatus) ?? false;
}

function sanitizeAuditString(str: string | undefined, maxLen = 500): string | undefined {
  if (!str) return undefined;
  // Strip control characters and sanitize
  const clean = str.replace(/[\x00-\x1F\x7F]/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + "..." : clean;
}

// ============================================================================
// 3. CANONICAL CREDENTIAL BROKER
// ============================================================================

export class CredentialBroker {
  constructor(
    private readonly credentialStore: CredentialStore,
    private readonly vault: CredentialVault = new CredentialVault()
  ) {}

  /**
   * Registers a new source credential under the authorized tenant.
   * Encrypts the secret payload into an AES-256-GCM envelope and assigns the next incremental version.
   *
   * RBAC: Requires 'manage:credentials'
   */
  public async registerCredential(
    auth: AuthContext,
    source: string,
    secretPayload: string,
    expiresAt?: string
  ): Promise<SourceCredential> {
    this.assertValidAuth(auth);
    this.assertPermission(auth, "manage:credentials");

    if (!source || typeof source !== "string" || !source.trim()) {
      throw new CredentialBrokerError("Source identifier must be a non-empty string", "INVALID_INPUT");
    }
    if (typeof secretPayload !== "string" || secretPayload.length === 0) {
      throw new CredentialBrokerError("Secret payload must be a non-empty string", "INVALID_INPUT");
    }

    // Determine next sequential version for (tenantId, source)
    const existing = await this.credentialStore.listCredentialsForTenant(auth.tenantId, { source: source.trim() });
    const maxVersion = existing.length > 0 ? Math.max(...existing.map((c) => c.version)) : 0;
    const nextVersion = maxVersion + 1;

    // Encrypt strictly via Vault boundary
    const envelope = this.vault.encrypt(secretPayload);

    const credentialId = `cred_${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();

    const record: SourceCredential = {
      id: credentialId,
      tenantId: auth.tenantId,
      source: source.trim(),
      version: nextVersion,
      status: "active",
      encryptedCiphertext: envelope.encryptedCiphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      keyVersion: envelope.keyVersion,
      expiresAt: expiresAt ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.credentialStore.saveCredential(record);

    // Audit creation (ZERO PLAINTEXT, CIPHERTEXT, OR KEY IN DETAILS)
    await this.credentialStore.recordAuditLog({
      id: `aud_${crypto.randomUUID()}`,
      tenantId: auth.tenantId,
      credentialId,
      action: "created",
      actorUserId: auth.userId,
      details: JSON.stringify({
        source: record.source,
        version: record.version,
        keyVersion: record.keyVersion,
      }),
      createdAt: nowIso,
    });

    return record;
  }

  /**
   * Leases an active source credential Just-In-Time (JIT) for scraper execution.
   *
   * EXECUTION ORDER (MANDATORY INVARIANT):
   * 1. AuthContext validation
   * 2. Tenant validation
   * 3. RBAC permission check ('read:credentials' or 'manage:credentials')
   * 4. Tenant-scoped credential lookup
   * 5. Lifecycle & expiry validation
   * 6. Decrypt strictly via CredentialVault
   * 7. Update usage timestamp
   * 8. Emit 'leased' audit log
   * 9. Return transient memory-only lease
   */
  public async leaseCredential(auth: AuthContext, source: string): Promise<CredentialLease> {
    // 1. AuthContext & Tenant validation
    this.assertValidAuth(auth);

    // 2. RBAC permission check
    const hasReadPermission = auth.permissions.includes("read:credentials");
    const hasManagePermission = auth.permissions.includes("manage:credentials");
    if (!hasReadPermission && !hasManagePermission) {
      throw new CredentialAuthorizationError(
        "Caller lacks 'read:credentials' or 'manage:credentials' permission to lease credentials",
        "PERMISSION_DENIED"
      );
    }

    if (!source || typeof source !== "string") {
      throw new CredentialBrokerError("Source parameter must be a non-empty string", "INVALID_INPUT");
    }

    // 3. Tenant-scoped credential lookup & lifecycle differentiation
    const allCreds = await this.credentialStore.listCredentialsForTenant(auth.tenantId, { source: source.trim() });
    if (allCreds.length === 0) {
      throw new CredentialNotFoundError(`Active credential not found for source '${source}' in tenant '${auth.tenantId}'`);
    }

    // Find active or expiring credential (latest version)
    const eligibleCred = allCreds
      .filter((c) => c.status === "active" || c.status === "expiring")
      .sort((a, b) => b.version - a.version)[0];

    if (!eligibleCred) {
      const latestCred = allCreds.sort((a, b) => b.version - a.version)[0];
      throw new CredentialLifecycleError(
        `Credential '${latestCred.id}' for source '${source}' has status '${latestCred.status}' and is not eligible for leasing`,
        "INELIGIBLE_STATUS"
      );
    }
    const credential = eligibleCred;

    // 5. Expiry validation (canonical timestamp comparison)
    const nowTime = Date.now();
    if (credential.expiresAt) {
      const expiryTime = new Date(credential.expiresAt).getTime();
      if (expiryTime <= nowTime) {
        // Deterministically transition expired credential to invalid and audit
        const nowIso = new Date(nowTime).toISOString();
        await this.credentialStore.updateCredentialStatus(
          auth.tenantId,
          credential.id,
          "invalid",
          `Expired at ${credential.expiresAt}`
        );
        await this.credentialStore.recordAuditLog({
          id: `aud_${crypto.randomUUID()}`,
          tenantId: auth.tenantId,
          credentialId: credential.id,
          action: "invalidated",
          actorUserId: auth.userId,
          details: JSON.stringify({
            reason: "Credential expired before lease",
            source: credential.source,
            version: credential.version,
            expiresAt: credential.expiresAt,
          }),
          createdAt: nowIso,
        });

        throw new CredentialExpiredError(
          `Credential '${credential.id}' for source '${source}' expired at ${credential.expiresAt}`
        );
      }
    }

    // 6. Decrypt strictly via CredentialVault
    const secretPayload = this.vault.decrypt(credential);

    // 7. Update usage timestamp
    const leaseTimeIso = new Date(nowTime).toISOString();
    await this.credentialStore.updateCredentialUsage(auth.tenantId, credential.id, leaseTimeIso);

    // 8. Record leased audit event
    await this.credentialStore.recordAuditLog({
      id: `aud_${crypto.randomUUID()}`,
      tenantId: auth.tenantId,
      credentialId: credential.id,
      action: "leased",
      actorUserId: auth.userId,
      details: JSON.stringify({
        source: credential.source,
        version: credential.version,
      }),
      createdAt: leaseTimeIso,
    });

    // 9. Return transient memory-only lease
    return {
      credentialId: credential.id,
      tenantId: credential.tenantId,
      source: credential.source,
      version: credential.version,
      secretPayload,
    };
  }

  /**
   * Reports runtime health / validation status of a credential.
   * Updates verification timestamp, records sanitized error reasons, and transitions status.
   *
   * RBAC: Requires 'read:credentials' or 'manage:credentials'
   * (Decouples operational runtime health observations from administrative credential management).
   */
  public async reportCredentialHealth(
    auth: AuthContext,
    credentialId: string,
    status: CredentialStatus,
    errorReason?: string
  ): Promise<void> {
    this.assertValidAuth(auth);
    const hasReadPermission = auth.permissions.includes("read:credentials");
    const hasManagePermission = auth.permissions.includes("manage:credentials");
    if (!hasReadPermission && !hasManagePermission) {
      throw new CredentialAuthorizationError(
        "Caller lacks 'read:credentials' or 'manage:credentials' permission to report credential health",
        "PERMISSION_DENIED"
      );
    }

    if (!credentialId || typeof credentialId !== "string") {
      throw new CredentialBrokerError("Credential ID must be a non-empty string", "INVALID_INPUT");
    }

    const credential = await this.credentialStore.getCredential(auth.tenantId, credentialId);
    if (!credential) {
      throw new CredentialNotFoundError(`Credential '${credentialId}' not found in tenant '${auth.tenantId}'`);
    }

    if (!isValidLifecycleTransition(credential.status, status)) {
      throw new CredentialLifecycleError(
        `Illegal lifecycle transition: cannot change credential status from '${credential.status}' to '${status}'`,
        "INVALID_LIFECYCLE_TRANSITION"
      );
    }

    const sanitizedReason = sanitizeAuditString(errorReason, 500);
    const nowIso = new Date().toISOString();

    await this.credentialStore.updateCredentialStatus(auth.tenantId, credentialId, status, sanitizedReason);
    await this.credentialStore.updateCredentialVerification(auth.tenantId, credentialId, nowIso);

    let action: CredentialAuditAction = "verified";
    if (status === "invalid") action = "invalidated";
    else if (status === "revoked") action = "revoked";
    else if (status === "rotation_required") action = "invalidated";
    else if (status === "active") action = "verified";

    await this.credentialStore.recordAuditLog({
      id: `aud_${crypto.randomUUID()}`,
      tenantId: auth.tenantId,
      credentialId,
      action,
      actorUserId: auth.userId,
      details: JSON.stringify({
        previousStatus: credential.status,
        newStatus: status,
        errorReason: sanitizedReason ?? null,
      }),
      createdAt: nowIso,
    });
  }

  /**
   * Revokes a credential immediately. Revocation is a terminal state.
   *
   * RBAC: Requires 'manage:credentials'
   */
  public async revokeCredential(
    auth: AuthContext,
    credentialId: string,
    reason = "Administrative revocation"
  ): Promise<void> {
    this.assertValidAuth(auth);
    this.assertPermission(auth, "manage:credentials");

    if (!credentialId || typeof credentialId !== "string") {
      throw new CredentialBrokerError("Credential ID must be a non-empty string", "INVALID_INPUT");
    }

    const credential = await this.credentialStore.getCredential(auth.tenantId, credentialId);
    if (!credential) {
      throw new CredentialNotFoundError(`Credential '${credentialId}' not found in tenant '${auth.tenantId}'`);
    }

    if (credential.status === "revoked") {
      // Idempotent no-op
      return;
    }

    if (!isValidLifecycleTransition(credential.status, "revoked")) {
      throw new CredentialLifecycleError(
        `Cannot revoke credential '${credentialId}' with status '${credential.status}'`,
        "INVALID_LIFECYCLE_TRANSITION"
      );
    }

    const sanitizedReason = sanitizeAuditString(reason, 500) || "Administrative revocation";
    const nowIso = new Date().toISOString();
    await this.credentialStore.updateCredentialStatus(
      auth.tenantId,
      credentialId,
      "revoked",
      sanitizedReason
    );

    await this.credentialStore.recordAuditLog({
      id: `aud_${crypto.randomUUID()}`,
      tenantId: auth.tenantId,
      credentialId,
      action: "revoked",
      actorUserId: auth.userId,
      details: JSON.stringify({
        source: credential.source,
        version: credential.version,
        reason: sanitizedReason,
      }),
      createdAt: nowIso,
    });
  }

  /**
   * Rotates a credential by creating a new version with the updated secret payload.
   * Marks previous active credentials as 'rotation_required' (superseded) and audits 'rotated'.
   *
   * RBAC: Requires 'manage:credentials'
   */
  public async rotateCredential(
    auth: AuthContext,
    source: string,
    newSecretPayload: string
  ): Promise<SourceCredential> {
    this.assertValidAuth(auth);
    this.assertPermission(auth, "manage:credentials");

    if (!source || typeof source !== "string" || !source.trim()) {
      throw new CredentialBrokerError("Source parameter must be a non-empty string", "INVALID_INPUT");
    }
    if (typeof newSecretPayload !== "string" || newSecretPayload.length === 0) {
      throw new CredentialBrokerError("New secret payload must be a non-empty string", "INVALID_INPUT");
    }

    const cleanSource = source.trim();
    const existing = await this.credentialStore.listCredentialsForTenant(auth.tenantId, { source: cleanSource });
    const maxVersion = existing.length > 0 ? Math.max(...existing.map((c) => c.version)) : 0;
    const nextVersion = maxVersion + 1;
    const previousActive = existing.find((c) => c.status === "active");

    // Encrypt new payload with CredentialVault
    const envelope = this.vault.encrypt(newSecretPayload);

    const credentialId = `cred_${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();

    const newRecord: SourceCredential = {
      id: credentialId,
      tenantId: auth.tenantId,
      source: cleanSource,
      version: nextVersion,
      status: "active",
      encryptedCiphertext: envelope.encryptedCiphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      keyVersion: envelope.keyVersion,
      expiresAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const auditLog = {
      id: `aud_${crypto.randomUUID()}`,
      tenantId: auth.tenantId,
      credentialId,
      action: "rotated" as const,
      actorUserId: auth.userId,
      details: JSON.stringify({
        source: cleanSource,
        version: nextVersion,
        supersededVersion: previousActive?.version ?? null,
      }),
      createdAt: nowIso,
    };

    // Execute atomically inside single database transaction
    await this.credentialStore.rotateCredentialTransaction({
      tenantId: auth.tenantId,
      previousActiveCredentialId: previousActive?.id,
      newCredential: newRecord,
      auditLog,
    });

    return newRecord;
  }

  // ==========================================================================
  // HELPER ASSERTIONS
  // ==========================================================================

  private assertValidAuth(auth: AuthContext): void {
    if (!auth || typeof auth !== "object" || !auth.tenantId || !auth.userId || !Array.isArray(auth.permissions)) {
      throw new CredentialAuthorizationError("Valid AuthContext with tenantId, userId, and permissions is required", "UNAUTHORIZED");
    }
  }

  private assertPermission(auth: AuthContext, requiredPermission: Permission): void {
    if (!auth.permissions.includes(requiredPermission)) {
      throw new CredentialAuthorizationError(
        `Caller lacks required '${requiredPermission}' permission`,
        "PERMISSION_DENIED"
      );
    }
  }
}
