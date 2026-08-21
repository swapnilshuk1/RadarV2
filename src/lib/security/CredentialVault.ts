/**
 * RADAR v4 — Sub-Phase M6.2: Cryptographic Vault & Envelope Encryption
 *
 * Implements authenticated AES-256-GCM envelope encryption with explicit key-version
 * handling, random 12-byte IV generation per encryption, 16-byte authentication tags,
 * and strict tamper detection.
 *
 * INVARIANTS:
 * 1. Zero plaintext exposure — envelope and repository layers operate strictly on ciphertexts.
 * 2. Authenticated encryption — AES-256-GCM auth tags MUST verify before plaintext is returned.
 * 3. Key isolation — key material exists exclusively inside the CredentialKeyProvider boundary.
 * 4. Error safety — error messages and logs NEVER emit plaintext secrets, keys, or IVs.
 */

import crypto from "crypto";
import type { EncryptedCredentialEnvelope } from "../../domain/entities";

export { type EncryptedCredentialEnvelope };

// ============================================================================
// 1. VAULT ERROR TYPES (Zero Plaintext / Zero Key Leakage)
// ============================================================================

export type CredentialVaultErrorCode =
  | "AUTH_FAILED"
  | "KEY_VERSION_NOT_FOUND"
  | "MALFORMED_ENVELOPE"
  | "INVALID_INPUT"
  | "INVALID_KEY_LENGTH"
  | "ENCRYPTION_FAILED";

export class CredentialVaultError extends Error {
  public readonly code: CredentialVaultErrorCode;

  constructor(message: string, code: CredentialVaultErrorCode) {
    super(message);
    this.name = "CredentialVaultError";
    this.code = code;
  }
}

export class CredentialAuthenticationError extends CredentialVaultError {
  constructor(message = "Authentication tag verification failed: ciphertext or envelope metadata has been tampered with") {
    super(message, "AUTH_FAILED");
    this.name = "CredentialAuthenticationError";
  }
}

export class CredentialKeyVersionError extends CredentialVaultError {
  constructor(keyVersion: string) {
    super(`Unsupported or unknown key version: '${keyVersion}'`, "KEY_VERSION_NOT_FOUND");
    this.name = "CredentialKeyVersionError";
  }
}

export class CredentialMalformedEnvelopeError extends CredentialVaultError {
  constructor(message: string) {
    super(message, "MALFORMED_ENVELOPE");
    this.name = "CredentialMalformedEnvelopeError";
  }
}

// ============================================================================
// 2. KEY PROVIDER ABSTRACTION
// ============================================================================

export interface CredentialKeyProvider {
  getKey(keyVersion: string): Buffer;
  getDefaultKeyVersion?(): string;
  hasKey?(keyVersion: string): boolean;
}

/**
 * In-memory key provider supporting arbitrary 32-byte keys for testing and multi-version rotation.
 */
export class InMemoryKeyProvider implements CredentialKeyProvider {
  private keys = new Map<string, Buffer>();
  private defaultKeyVersion: string;

  constructor(keys: Record<string, string | Buffer>, defaultKeyVersion = "kms_v1") {
    this.defaultKeyVersion = defaultKeyVersion;
    for (const [ver, key] of Object.entries(keys)) {
      const buf = typeof key === "string" ? Buffer.from(key, "hex") : key;
      if (!Buffer.isBuffer(buf) || buf.length !== 32) {
        throw new CredentialVaultError(
          `Key for version '${ver}' must be exactly 32 bytes (got ${buf?.length ?? 0} bytes)`,
          "INVALID_KEY_LENGTH"
        );
      }
      this.keys.set(ver, buf);
    }
  }

  getKey(keyVersion: string): Buffer {
    const key = this.keys.get(keyVersion);
    if (!key) {
      throw new CredentialKeyVersionError(keyVersion);
    }
    return key;
  }

  getDefaultKeyVersion(): string {
    return this.defaultKeyVersion;
  }

  hasKey(keyVersion: string): boolean {
    return this.keys.has(keyVersion);
  }
}

/**
 * Deterministic developer/test key provider supporting kms_v1 and kms_v2.
 * Uses SHA-256 derivations of fixed developer seeds to guarantee consistent 32-byte keys.
 */
export class DevDeterministicKeyProvider implements CredentialKeyProvider {
  private static readonly V1_KEY = crypto.createHash("sha256").update("radar_multitenant_kms_v1_secret_seed_2026").digest();
  private static readonly V2_KEY = crypto.createHash("sha256").update("radar_multitenant_kms_v2_secret_seed_2026").digest();

  getKey(keyVersion: string): Buffer {
    if (keyVersion === "kms_v1") {
      return DevDeterministicKeyProvider.V1_KEY;
    }
    if (keyVersion === "kms_v2") {
      return DevDeterministicKeyProvider.V2_KEY;
    }
    throw new CredentialKeyVersionError(keyVersion);
  }

  getDefaultKeyVersion(): string {
    return "kms_v1";
  }

  hasKey(keyVersion: string): boolean {
    return keyVersion === "kms_v1" || keyVersion === "kms_v2";
  }
}

// ============================================================================
// 3. CANONICAL CREDENTIAL VAULT (AES-256-GCM Envelope Encryption)
// ============================================================================

const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class CredentialVault {
  private readonly keyProvider: CredentialKeyProvider;

  constructor(keyProvider?: CredentialKeyProvider) {
    this.keyProvider = keyProvider ?? new DevDeterministicKeyProvider();
  }

  /**
   * Encrypts a plaintext credential string into an authenticated AES-256-GCM envelope.
   *
   * @param plaintext The raw credential or session payload to protect.
   * @param keyVersion Optional key version (defaults to key provider's default key version).
   * @returns EncryptedCredentialEnvelope containing base64 ciphertext, IV, auth tag, and key version.
   */
  public encrypt(plaintext: string, keyVersion?: string): EncryptedCredentialEnvelope {
    if (typeof plaintext !== "string") {
      throw new CredentialVaultError("Plaintext payload must be a string", "INVALID_INPUT");
    }

    const targetKeyVersion = keyVersion ?? this.keyProvider.getDefaultKeyVersion?.() ?? "kms_v1";
    const key = this.keyProvider.getKey(targetKeyVersion);

    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new CredentialVaultError(
        `Invalid key for version '${targetKeyVersion}'. Encryption key must be exactly 32 bytes.`,
        "INVALID_KEY_LENGTH"
      );
    }

    // Generate cryptographically random 12-byte (96-bit) IV for AES-GCM
    const iv = crypto.randomBytes(12);

    try {
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      return {
        encryptedCiphertext: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        keyVersion: targetKeyVersion,
      };
    } catch (err: any) {
      if (err instanceof CredentialVaultError) throw err;
      throw new CredentialVaultError(`Encryption operation failed: ${err.message}`, "ENCRYPTION_FAILED");
    }
  }

  /**
   * Decrypts an authenticated AES-256-GCM envelope back to plaintext string.
   *
   * @param envelope The EncryptedCredentialEnvelope containing base64 ciphertext, IV, auth tag, and key version.
   * @returns Decrypted plaintext string.
   * @throws CredentialAuthenticationError if the ciphertext, IV, auth tag, or key does not match.
   * @throws CredentialMalformedEnvelopeError if envelope structure or field lengths are invalid.
   * @throws CredentialKeyVersionError if the key version is unknown to the provider.
   */
  public decrypt(envelope: EncryptedCredentialEnvelope): string {
    if (!envelope || typeof envelope !== "object") {
      throw new CredentialMalformedEnvelopeError("Envelope must be a non-null object");
    }

    const { encryptedCiphertext, iv, authTag, keyVersion } = envelope;

    if (
      typeof encryptedCiphertext !== "string" ||
      typeof iv !== "string" ||
      typeof authTag !== "string" ||
      typeof keyVersion !== "string" ||
      iv.length === 0 ||
      authTag.length === 0 ||
      keyVersion.length === 0
    ) {
      throw new CredentialMalformedEnvelopeError(
        "Envelope is missing required cryptographic fields or contains non-string types"
      );
    }

    // Format validation
    if (!BASE64_REGEX.test(iv) || !BASE64_REGEX.test(authTag) || (encryptedCiphertext.length > 0 && !BASE64_REGEX.test(encryptedCiphertext))) {
      throw new CredentialMalformedEnvelopeError("Envelope contains invalid base64 encoding in cryptographic fields");
    }

    let ivBuf: Buffer;
    let tagBuf: Buffer;
    let ciphertextBuf: Buffer;

    try {
      ivBuf = Buffer.from(iv, "base64");
      tagBuf = Buffer.from(authTag, "base64");
      ciphertextBuf = Buffer.from(encryptedCiphertext, "base64");
    } catch {
      throw new CredentialMalformedEnvelopeError("Failed to decode base64 envelope fields");
    }

    if (ivBuf.length !== 12) {
      throw new CredentialMalformedEnvelopeError(
        `Invalid IV length: expected 12 bytes, got ${ivBuf.length} bytes`
      );
    }

    if (tagBuf.length !== 16) {
      throw new CredentialMalformedEnvelopeError(
        `Invalid authentication tag length: expected 16 bytes, got ${tagBuf.length} bytes`
      );
    }

    const key = this.keyProvider.getKey(keyVersion);
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new CredentialVaultError(
        `Invalid key for version '${keyVersion}'. Decryption key must be exactly 32 bytes.`,
        "INVALID_KEY_LENGTH"
      );
    }

    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
      decipher.setAuthTag(tagBuf);
      const decrypted = Buffer.concat([
        decipher.update(ciphertextBuf),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch (err: any) {
      if (err instanceof CredentialVaultError && !(err instanceof CredentialAuthenticationError)) {
        throw err;
      }
      // Any decipher error or bad auth tag throws strict authentication error without leaking payload
      throw new CredentialAuthenticationError(
        "Authentication tag verification failed: ciphertext or envelope metadata has been tampered with or corrupted"
      );
    }
  }
}
