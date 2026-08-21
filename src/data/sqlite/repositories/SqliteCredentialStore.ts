import type { DatabaseAdapter } from "../../database/adapter";
import type { CredentialStore } from "../../../domain/repositories";
import type {
  SourceCredential,
  CredentialAuditLog,
  CredentialStatus,
  CredentialAuditAction,
} from "../../../domain/entities";

interface SourceCredentialRow {
  id: string;
  tenant_id: string;
  source: string;
  version: number;
  status: string;
  encrypted_ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_verified_at: string | null;
  error_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface CredentialAuditLogRow {
  id: string;
  tenant_id: string;
  credential_id: string;
  action: string;
  actor_user_id: string | null;
  details: string | null;
  created_at: string;
}

function mapRowToCredential(row: SourceCredentialRow): SourceCredential {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    source: row.source,
    version: row.version,
    status: row.status as CredentialStatus,
    encryptedCiphertext: row.encrypted_ciphertext,
    iv: row.iv,
    authTag: row.auth_tag,
    keyVersion: row.key_version,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastVerifiedAt: row.last_verified_at,
    errorReason: row.error_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToAuditLog(row: CredentialAuditLogRow): CredentialAuditLog {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    credentialId: row.credential_id,
    action: row.action as CredentialAuditAction,
    actorUserId: row.actor_user_id,
    details: row.details,
    createdAt: row.created_at,
  };
}

export class SqliteCredentialStore implements CredentialStore {
  constructor(private db: DatabaseAdapter) {}

  async saveCredential(credential: SourceCredential): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO source_credentials (
        id, tenant_id, source, version, status,
        encrypted_ciphertext, iv, auth_tag, key_version,
        expires_at, last_used_at, last_verified_at, error_reason,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, source, version) DO UPDATE SET
        status = EXCLUDED.status,
        encrypted_ciphertext = EXCLUDED.encrypted_ciphertext,
        iv = EXCLUDED.iv,
        auth_tag = EXCLUDED.auth_tag,
        key_version = EXCLUDED.key_version,
        expires_at = EXCLUDED.expires_at,
        last_used_at = EXCLUDED.last_used_at,
        last_verified_at = EXCLUDED.last_verified_at,
        error_reason = EXCLUDED.error_reason,
        updated_at = CURRENT_TIMESTAMP`,
      [
        credential.id,
        credential.tenantId,
        credential.source,
        credential.version,
        credential.status,
        credential.encryptedCiphertext,
        credential.iv,
        credential.authTag,
        credential.keyVersion,
        credential.expiresAt || null,
        credential.lastUsedAt || null,
        credential.lastVerifiedAt || null,
        credential.errorReason || null,
        credential.createdAt || now,
        credential.updatedAt || now,
      ]
    );
  }

  async getCredential(tenantId: string, id: string): Promise<SourceCredential | undefined> {
    const row = await this.db.one<SourceCredentialRow>(
      `SELECT * FROM source_credentials WHERE tenant_id = ? AND id = ?`,
      [tenantId, id]
    );
    return row ? mapRowToCredential(row) : undefined;
  }

  async getActiveCredentialForSource(tenantId: string, source: string): Promise<SourceCredential | undefined> {
    const row = await this.db.one<SourceCredentialRow>(
      `SELECT * FROM source_credentials 
       WHERE tenant_id = ? AND source = ? AND status = 'active'
       ORDER BY version DESC LIMIT 1`,
      [tenantId, source]
    );
    return row ? mapRowToCredential(row) : undefined;
  }

  async listCredentialsForTenant(
    tenantId: string,
    options?: { source?: string; status?: CredentialStatus }
  ): Promise<SourceCredential[]> {
    let query = `SELECT * FROM source_credentials WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (options?.source) {
      query += ` AND source = ?`;
      params.push(options.source);
    }
    if (options?.status) {
      query += ` AND status = ?`;
      params.push(options.status);
    }

    query += ` ORDER BY source ASC, version DESC`;

    const rows = await this.db.many<SourceCredentialRow>(query, params);
    return rows.map(mapRowToCredential);
  }

  async updateCredentialStatus(
    tenantId: string,
    id: string,
    status: CredentialStatus,
    errorReason?: string | null
  ): Promise<void> {
    await this.db.execute(
      `UPDATE source_credentials 
       SET status = ?, error_reason = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE tenant_id = ? AND id = ?`,
      [status, errorReason || null, tenantId, id]
    );
  }

  async updateCredentialUsage(tenantId: string, id: string, lastUsedAt?: string): Promise<void> {
    const timestamp = lastUsedAt || new Date().toISOString();
    await this.db.execute(
      `UPDATE source_credentials 
       SET last_used_at = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE tenant_id = ? AND id = ?`,
      [timestamp, tenantId, id]
    );
  }

  async updateCredentialVerification(tenantId: string, id: string, lastVerifiedAt?: string): Promise<void> {
    const timestamp = lastVerifiedAt || new Date().toISOString();
    await this.db.execute(
      `UPDATE source_credentials 
       SET last_verified_at = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE tenant_id = ? AND id = ?`,
      [timestamp, tenantId, id]
    );
  }

  async deleteCredential(tenantId: string, id: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM source_credentials WHERE tenant_id = ? AND id = ?`,
      [tenantId, id]
    );
  }

  async recordAuditLog(log: CredentialAuditLog): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO credential_audit_logs (
        id, tenant_id, credential_id, action, actor_user_id, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        log.id,
        log.tenantId,
        log.credentialId,
        log.action,
        log.actorUserId || null,
        log.details || null,
        log.createdAt || now,
      ]
    );
  }

  async getAuditLogsForCredential(tenantId: string, credentialId: string): Promise<CredentialAuditLog[]> {
    const rows = await this.db.many<CredentialAuditLogRow>(
      `SELECT * FROM credential_audit_logs 
       WHERE tenant_id = ? AND credential_id = ? 
       ORDER BY created_at DESC`,
      [tenantId, credentialId]
    );
    return rows.map(mapRowToAuditLog);
  }

  async listAuditLogsForTenant(tenantId: string, limit: number = 100): Promise<CredentialAuditLog[]> {
    const rows = await this.db.many<CredentialAuditLogRow>(
      `SELECT * FROM credential_audit_logs 
       WHERE tenant_id = ? 
       ORDER BY created_at DESC LIMIT ?`,
      [tenantId, limit]
    );
    return rows.map(mapRowToAuditLog);
  }

  async rotateCredentialTransaction(params: {
    tenantId: string;
    previousActiveCredentialId?: string;
    newCredential: SourceCredential;
    auditLog: CredentialAuditLog;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const txStore = new SqliteCredentialStore(tx);

      // 1. Mark previous active credential as rotation_required
      if (params.previousActiveCredentialId) {
        await txStore.updateCredentialStatus(
          params.tenantId,
          params.previousActiveCredentialId,
          "rotation_required",
          `Superseded by version ${params.newCredential.version}`
        );
      }

      // 2. Insert new credential record
      await txStore.saveCredential(params.newCredential);

      // 3. Insert rotation audit log
      await txStore.recordAuditLog(params.auditLog);
    });
  }
}
