-- Migration 022: Multi-Tenant Credential Broker & Source Authentication Subsystem
-- Sub-Phase M6.1 — Schema & Durable Persistence

CREATE TABLE IF NOT EXISTS source_credentials (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    source TEXT NOT NULL, -- e.g. 'linkedin', 'naukri', 'indeed', 'greenhouse'
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, active, expiring, invalid, revoked, rotation_required
    
    -- Encrypted Credential Vault Fields (No plaintext secrets)
    encrypted_ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    key_version TEXT NOT NULL,
    
    expires_at DATETIME,
    last_used_at DATETIME,
    last_verified_at DATETIME,
    error_reason TEXT,
    
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE RESTRICT,

    CONSTRAINT unq_tenant_source_version UNIQUE (tenant_id, source, version)
);

CREATE INDEX IF NOT EXISTS idx_source_credentials_tenant_source 
    ON source_credentials(tenant_id, source, status);

CREATE INDEX IF NOT EXISTS idx_source_credentials_status 
    ON source_credentials(status);

CREATE TABLE IF NOT EXISTS credential_audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    credential_id TEXT NOT NULL,
    action TEXT NOT NULL, -- created, activated, leased, verified, invalidated, revoked, rotated
    actor_user_id TEXT,
    details TEXT, -- JSON or descriptive metadata with zero secrets
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (credential_id)
        REFERENCES source_credentials(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_credential_audit_logs_lookup 
    ON credential_audit_logs(tenant_id, credential_id, created_at);
