/**
 * Sub-Phase M6.2 — Cryptographic Vault & Envelope Encryption Security Tests
 */
import { describe, test, expect, beforeEach } from "vitest";
import crypto from "crypto";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  CredentialVault,
  InMemoryKeyProvider,
  DevDeterministicKeyProvider,
  CredentialAuthenticationError,
  CredentialKeyVersionError,
  CredentialMalformedEnvelopeError,
  CredentialVaultError,
  type EncryptedCredentialEnvelope,
} from "@/lib/security/CredentialVault";
import { SqliteCredentialStore } from "@/data/sqlite/repositories/SqliteCredentialStore";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import type { SourceCredential } from "@/domain/entities";

class TestSqliteAdapter implements DatabaseAdapter {
  constructor(public db: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params || []));
    return (row as T) || null;
  }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params || [])) as T[];
  }
  async execute(sql: string, params?: QueryParams): Promise<{
    rowsAffected: number;
    lastInsertRowid?: number | bigint | string;
  }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params || []));
    return { rowsAffected: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

describe("Sub-Phase M6.2: Cryptographic Vault & Envelope Encryption Security Invariants", () => {
  let vault: CredentialVault;

  beforeEach(() => {
    vault = new CredentialVault(new DevDeterministicKeyProvider());
  });

  // ==========================================================================
  // INVARIANT 1: Round-Trip Encryption / Decryption
  // ==========================================================================
  test("1. Round-Trip Invariant: decrypt(encrypt(secret)) === secret for arbitrary string payloads", () => {
    const samplePayloads = [
      "simple_api_token_xyz123",
      JSON.stringify({
        li_at: "AQEDAS_sample_session_cookie_token_with_symbols!@#$%",
        JSESSIONID: "ajax:1234567890",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
      "unicode_symbols_€_¥_£_🚀_ñ_ç_ü_語_🔒",
      "multi\nline\r\npayload\twith\tspecial\\escapes",
    ];

    for (const secret of samplePayloads) {
      const envelope = vault.encrypt(secret);
      expect(envelope).toBeDefined();
      expect(typeof envelope.encryptedCiphertext).toBe("string");
      expect(typeof envelope.iv).toBe("string");
      expect(typeof envelope.authTag).toBe("string");
      expect(envelope.keyVersion).toBe("kms_v1");

      const decrypted = vault.decrypt(envelope);
      expect(decrypted).toBe(secret);
    }
  });

  // ==========================================================================
  // INVARIANT 2: Random IV Invariant
  // ==========================================================================
  test("2. Random IV Invariant: Encrypting identical plaintext produces distinct IVs and ciphertexts", () => {
    const secret = "identical_high_entropy_executive_session_secret";
    const ivs = new Set<string>();
    const ciphertexts = new Set<string>();
    const count = 100;

    for (let i = 0; i < count; i++) {
      const envelope = vault.encrypt(secret, "kms_v1");
      ivs.add(envelope.iv);
      ciphertexts.add(envelope.encryptedCiphertext);

      // Verify each decodes to exactly 12-byte IV and 16-byte auth tag
      const ivBytes = Buffer.from(envelope.iv, "base64");
      const tagBytes = Buffer.from(envelope.authTag, "base64");
      expect(ivBytes.length).toBe(12);
      expect(tagBytes.length).toBe(16);
    }

    expect(ivs.size).toBe(count);
    expect(ciphertexts.size).toBe(count);
  });

  // ==========================================================================
  // INVARIANT 3: Zero Plaintext Exposure in Envelope
  // ==========================================================================
  test("3. Zero Plaintext Invariant: Ciphertext does not contain plaintext substrings or unencrypted tokens", () => {
    const sensitiveCookie = "SUPER_SECRET_AUTHENTICATED_EXECUTIVE_TOKEN_998877";
    const envelope = vault.encrypt(sensitiveCookie);

    expect(envelope.encryptedCiphertext).not.toContain(sensitiveCookie);
    expect(envelope.iv).not.toContain(sensitiveCookie);
    expect(envelope.authTag).not.toContain(sensitiveCookie);

    const rawCiphertext = Buffer.from(envelope.encryptedCiphertext, "base64").toString("binary");
    expect(rawCiphertext).not.toContain(sensitiveCookie);
  });

  // ==========================================================================
  // INVARIANT 4: Tamper Detection (Ciphertext, IV, AuthTag)
  // ==========================================================================
  test("4. Tamper Detection: Mutating ciphertext throws CredentialAuthenticationError", () => {
    const secret = "secret_to_tamper_test";
    const envelope = vault.encrypt(secret);

    // Tamper with ciphertext by altering a base64 character
    const rawCipher = Buffer.from(envelope.encryptedCiphertext, "base64");
    rawCipher[0] = rawCipher[0] ^ 0xff; // Flip bits in first byte
    const tamperedEnvelope: EncryptedCredentialEnvelope = {
      ...envelope,
      encryptedCiphertext: rawCipher.toString("base64"),
    };

    expect(() => vault.decrypt(tamperedEnvelope)).toThrow(CredentialAuthenticationError);
  });

  test("5. Tamper Detection: Mutating IV throws CredentialAuthenticationError", () => {
    const secret = "secret_to_tamper_iv";
    const envelope = vault.encrypt(secret);

    // Tamper with IV
    const rawIv = Buffer.from(envelope.iv, "base64");
    rawIv[0] = rawIv[0] ^ 0xff;
    const tamperedEnvelope: EncryptedCredentialEnvelope = {
      ...envelope,
      iv: rawIv.toString("base64"),
    };

    expect(() => vault.decrypt(tamperedEnvelope)).toThrow(CredentialAuthenticationError);
  });

  test("6. Tamper Detection: Mutating Auth Tag throws CredentialAuthenticationError", () => {
    const secret = "secret_to_tamper_auth_tag";
    const envelope = vault.encrypt(secret);

    // Tamper with Auth Tag
    const rawTag = Buffer.from(envelope.authTag, "base64");
    rawTag[0] = rawTag[0] ^ 0xff;
    const tamperedEnvelope: EncryptedCredentialEnvelope = {
      ...envelope,
      authTag: rawTag.toString("base64"),
    };

    expect(() => vault.decrypt(tamperedEnvelope)).toThrow(CredentialAuthenticationError);
  });

  // ==========================================================================
  // INVARIANT 5: Key Version Isolation & Cryptographic Separation
  // ==========================================================================
  test("7. Key Version Invariant: kms_v1 and kms_v2 encrypt and decrypt independently", () => {
    const secret = "multi_version_secret_payload";

    const envV1 = vault.encrypt(secret, "kms_v1");
    expect(envV1.keyVersion).toBe("kms_v1");
    expect(vault.decrypt(envV1)).toBe(secret);

    const envV2 = vault.encrypt(secret, "kms_v2");
    expect(envV2.keyVersion).toBe("kms_v2");
    expect(vault.decrypt(envV2)).toBe(secret);

    // Cross-key version decryption fails (using v2 key to decrypt v1 payload fails auth tag)
    const mismatchedEnvelope: EncryptedCredentialEnvelope = {
      ...envV1,
      keyVersion: "kms_v2", // Force decryptor to use kms_v2 key for kms_v1 ciphertext
    };

    expect(() => vault.decrypt(mismatchedEnvelope)).toThrow(CredentialAuthenticationError);
  });

  test("8. Key Version Invariant: Unknown key version throws CredentialKeyVersionError", () => {
    const secret = "test_unknown_version";
    expect(() => vault.encrypt(secret, "kms_v999")).toThrow(CredentialKeyVersionError);

    const envelope = vault.encrypt(secret, "kms_v1");
    const unknownVersionEnvelope: EncryptedCredentialEnvelope = {
      ...envelope,
      keyVersion: "kms_v_nonexistent",
    };

    expect(() => vault.decrypt(unknownVersionEnvelope)).toThrow(CredentialKeyVersionError);
  });

  // ==========================================================================
  // INVARIANT 6: Malformed Envelope Rejection
  // ==========================================================================
  test("9. Malformed Envelope Rejection: Missing or invalid envelope fields are rejected", () => {
    const secret = "envelope_validation_secret";
    const validEnv = vault.encrypt(secret);

    // Missing fields
    expect(() => vault.decrypt(null as any)).toThrow(CredentialMalformedEnvelopeError);
    expect(() => vault.decrypt({} as any)).toThrow(CredentialMalformedEnvelopeError);
    expect(() => vault.decrypt({ ...validEnv, iv: "" })).toThrow(CredentialMalformedEnvelopeError);
    expect(() => vault.decrypt({ ...validEnv, authTag: "" })).toThrow(CredentialMalformedEnvelopeError);
    expect(() => vault.decrypt({ ...validEnv, keyVersion: "" })).toThrow(CredentialMalformedEnvelopeError);

    // Invalid base64 or wrong byte length for IV (e.g. 8 bytes instead of 12)
    const shortIv = Buffer.from("12345678").toString("base64");
    expect(() => vault.decrypt({ ...validEnv, iv: shortIv })).toThrow(CredentialMalformedEnvelopeError);

    // Wrong byte length for Auth Tag (e.g. 12 bytes instead of 16)
    const shortTag = Buffer.from("123456789012").toString("base64");
    expect(() => vault.decrypt({ ...validEnv, authTag: shortTag })).toThrow(CredentialMalformedEnvelopeError);

    // Invalid base64 characters
    expect(() => vault.decrypt({ ...validEnv, iv: "???not_base64!!!" })).toThrow(CredentialMalformedEnvelopeError);
  });

  // ==========================================================================
  // INVARIANT 7: Boundary Edge Cases (Empty Payload & Large Payloads)
  // ==========================================================================
  test("10. Boundary Edge Cases: Empty string and large payloads (256KB) round-trip cleanly", () => {
    // 1. Empty string
    const emptyEnv = vault.encrypt("");
    expect(emptyEnv.encryptedCiphertext).toBe("");
    expect(vault.decrypt(emptyEnv)).toBe("");

    // 2. Large 256KB payload
    const largeObj: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {
      largeObj[`session_cookie_item_${i}`] = `cookie_value_${crypto.randomBytes(64).toString("hex")}`;
    }
    const largeSecret = JSON.stringify(largeObj);
    expect(largeSecret.length).toBeGreaterThan(200000); // > 200 KB

    const largeEnv = vault.encrypt(largeSecret, "kms_v2");
    expect(vault.decrypt(largeEnv)).toBe(largeSecret);
  });

  // ==========================================================================
  // INVARIANT 8: No Secret Leakage in Errors
  // ==========================================================================
  test("11. Zero Leakage in Exceptions: Error messages never contain plaintext secrets or raw keys", () => {
    const sensitiveSecret = "CONFIDENTIAL_EXECUTIVE_PASSKEY_XYZ_999";
    const envelope = vault.encrypt(sensitiveSecret);

    // Trigger auth tag tampering error
    try {
      const tampered: EncryptedCredentialEnvelope = {
        ...envelope,
        authTag: Buffer.from("0123456789012345").toString("base64"),
      };
      vault.decrypt(tampered);
      expect.unreachable("Should have thrown CredentialAuthenticationError");
    } catch (err: any) {
      expect(err.message).not.toContain(sensitiveSecret);
      expect(JSON.stringify(err)).not.toContain(sensitiveSecret);
    }

    // Trigger input error
    try {
      (vault as any).encrypt(12345);
      expect.unreachable("Should have thrown CredentialVaultError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(CredentialVaultError);
    }
  });

  // ==========================================================================
  // INVARIANT 9: Key Isolation & Custom Key Providers
  // ==========================================================================
  test("12. Key Isolation: InMemoryKeyProvider supports custom keys and rejects non-32-byte keys", () => {
    const customKey1 = crypto.randomBytes(32);
    const customKey2 = crypto.randomBytes(32);

    const provider = new InMemoryKeyProvider({
      kms_custom_1: customKey1,
      kms_custom_2: customKey2,
    }, "kms_custom_1");

    const customVault = new CredentialVault(provider);
    const secret = "custom_provider_secret";

    const env1 = customVault.encrypt(secret, "kms_custom_1");
    expect(customVault.decrypt(env1)).toBe(secret);

    const env2 = customVault.encrypt(secret, "kms_custom_2");
    expect(customVault.decrypt(env2)).toBe(secret);

    // Rejects invalid key lengths (e.g. 16 bytes)
    expect(() => {
      new InMemoryKeyProvider({
        bad_key: crypto.randomBytes(16),
      });
    }).toThrow(CredentialVaultError);
  });

  // ==========================================================================
  // INVARIANT 10: Integration with M6.1 SqliteCredentialStore
  // ==========================================================================
  test("13. Integration with M6.1: SqliteCredentialStore persists encrypted envelope without plaintext exposure", async () => {
    const sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");

    const migrationFiles = [
      "001_initial_schema.sql",
      "018_multi_tenant_foundation.sql",
      "022_source_credentials.sql",
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    const adapter = new TestSqliteAdapter(sqliteDb);
    const credStore = new SqliteCredentialStore(adapter);

    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_test', 'active')");

    // 1. Encrypt secret with Vault
    const rawCookiePayload = JSON.stringify({ li_at: "session_token_12345", bcookie: "browser_guid_67890" });
    const envelope = vault.encrypt(rawCookiePayload, "kms_v1");

    // 2. Persist to M6.1 Store
    const record: SourceCredential = {
      id: "cred_integration_1",
      tenantId: "tenant_test",
      source: "linkedin",
      version: 1,
      status: "active",
      ...envelope,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await credStore.saveCredential(record);

    // 3. Verify Database row strictly contains ciphertext (no plaintext column or value)
    const rawDbRow = await adapter.one<any>("SELECT * FROM source_credentials WHERE id = 'cred_integration_1'");
    expect(rawDbRow).toBeDefined();
    expect(rawDbRow.encrypted_ciphertext).toBe(envelope.encryptedCiphertext);
    expect(rawDbRow.iv).toBe(envelope.iv);
    expect(rawDbRow.auth_tag).toBe(envelope.authTag);
    expect(rawDbRow.key_version).toBe("kms_v1");

    // PRAGMA verify: no column contains rawCookiePayload
    for (const val of Object.values(rawDbRow)) {
      if (typeof val === "string") {
        expect(val).not.toContain("session_token_12345");
      }
    }

    // 4. Retrieve via M6.1 Store and decrypt with Vault
    const retrieved = await credStore.getCredential("tenant_test", "cred_integration_1");
    expect(retrieved).toBeDefined();

    const decrypted = vault.decrypt(retrieved!);
    expect(decrypted).toBe(rawCookiePayload);
  });
});
