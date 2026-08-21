-- Migration 018: Multi-Tenant Foundation

-- 1. Create the Auth-level users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create the tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create the memberships table to link users to tenants
CREATE TABLE IF NOT EXISTS memberships (
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    role TEXT NOT NULL,
    permissions TEXT NOT NULL, -- JSON array of strings
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    PRIMARY KEY (user_id, tenant_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

-- 4. Scope Person (candidate/executive profile) to a specific tenant
ALTER TABLE people ADD COLUMN tenant_id TEXT REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS idx_people_tenant_id ON people(tenant_id);
