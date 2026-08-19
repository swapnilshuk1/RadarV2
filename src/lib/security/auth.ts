import { DatabaseAdapter } from "../../data/database";

export type Permission = 'read:evaluation' | 'write:evaluation' | 'manage:search_plan' | 'manage:credentials' | 'read:person' | 'write:person';

// 1. Authentication context establishes who is calling
export interface AuthContext {
  userId: string;
  tenantId: string;
  permissions: Permission[];
}

// 2. Authorization derives the resource scope
export interface AuthorizedPersonScope {
  tenantId: string;
  personId: string;
}

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

/**
 * Derives an AuthorizedPersonScope from an AuthContext and a requested personId.
 * Validates against the database that the personId strictly belongs to the AuthContext's tenantId.
 */
export async function authorizePersonScope(
  authContext: AuthContext,
  requestedPersonId: string,
  db: DatabaseAdapter
): Promise<AuthorizedPersonScope> {
  // Direct tenant-scoped boundary query
  const row = await db.one<{ id: string; tenant_id: string | null }>(
    `SELECT id, tenant_id FROM people WHERE id = ? AND tenant_id = ?`,
    [requestedPersonId, authContext.tenantId]
  );

  if (!row) {
    // Diagnostic inspection for exact isolation error detail
    const existing = await db.one<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM people WHERE id = ?`,
      [requestedPersonId]
    );

    if (!existing) {
      throw new TenantIsolationError(`Person ${requestedPersonId} not found.`);
    }
    if (existing.tenant_id === null) {
      throw new TenantIsolationError(`Person ${requestedPersonId} is a legacy/unassigned record and cannot be accessed by tenant ${authContext.tenantId}.`);
    }
    throw new TenantIsolationError(`Access denied. Person ${requestedPersonId} does not belong to tenant ${authContext.tenantId}.`);
  }

  return {
    tenantId: authContext.tenantId,
    personId: row.id,
  };
}

/**
 * Derives an AuthContext by authenticating a user's membership within a specific tenant.
 * Validates that the membership exists, is active (status = 'active' and revoked_at is null),
 * and parses the assigned permissions.
 */
export async function authenticateTenantMembership(
  userId: string,
  tenantId: string,
  db: DatabaseAdapter
): Promise<AuthContext> {
  const row = await db.one<{
    user_id: string;
    tenant_id: string;
    permissions: string;
    status: string;
    revoked_at: string | null;
  }>(
    `SELECT user_id, tenant_id, permissions, status, revoked_at 
     FROM memberships 
     WHERE user_id = ? AND tenant_id = ?`,
    [userId, tenantId]
  );

  if (!row) {
    throw new TenantIsolationError(`User ${userId} has no membership in tenant ${tenantId}.`);
  }

  if (row.status !== 'active' || row.revoked_at !== null) {
    throw new TenantIsolationError(`Membership for user ${userId} in tenant ${tenantId} is inactive or revoked.`);
  }

  let permissions: Permission[] = [];
  try {
    permissions = JSON.parse(row.permissions || '[]');
  } catch {
    permissions = [];
  }

  return {
    userId,
    tenantId,
    permissions,
  };
}
