/**
 * src/lib/security/scope-resolver.ts
 *
 * RADAR v2 — Consolidated Scope & Active Context Resolver (Phase 4).
 *
 * Consolidates sequential queries (people -> memberships -> authenticateTenantMembership ->
 * authorizePersonScope + getActiveContext) into a single deterministic query round-trip.
 *
 * Invariants:
 * 1. Zero Authorization Weakening: Rejection conditions (inactive, revoked, missing, ambiguous, cross-tenant)
 *    produce exact semantic parity with legacy auth functions.
 * 2. Strict Precedence: Active pointer table has strict priority over chronological evaluation context fallback.
 * 3. Zero Cartesian Multiplication: Subquery scalar projections prevent Cartesian row explosion across multiple plans/snapshots.
 */

import { getDatabaseAdapter, type DatabaseAdapter } from "../../data/database";
import { PERMISSIONS, TenantIsolationError, type AuthorizedPersonScope } from "./auth";
import type { Permission } from "./auth";
export type { AuthorizedPersonScope } from "./auth";

const ADMIN_PERMISSIONS: Permission[] = [...PERMISSIONS];

function parseStoredPermissions(serialized: string | null | undefined): Permission[] {
  try {
    const parsed: unknown = JSON.parse(serialized || "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((permission): permission is Permission =>
      typeof permission === "string" && (PERMISSIONS as readonly string[]).includes(permission)
    ))];
  } catch {
    return [];
  }
}

export interface ActiveServingContext {
  readonly searchPlanId: string;
  readonly contextFingerprint: string;
}

export interface ResolvedServingScope {
  readonly scope: AuthorizedPersonScope;
  readonly activeContext?: ActiveServingContext;
}

interface RawScopeContextRow {
  person_id: string | null;
  person_tenant_id: string | null;
  target_tenant_id: string | null;
  active_membership_count: number;
  target_membership_status: string | null;
  target_membership_revoked_at: string | null;
  pointer_context_fingerprint: string | null;
  pointer_search_plan_id: string | null;
  fallback_context_fingerprint: string | null;
  fallback_search_plan_id: string | null;
}

/**
 * Resolves AuthorizedPersonScope and active evaluation context in a single deterministic query round-trip.
 */
export async function resolveServingScope(
  userId: string,
  requestedTenantId?: string,
  adapter?: DatabaseAdapter
): Promise<ResolvedServingScope> {
  const db = adapter || getDatabaseAdapter();

  const row = await db.one<RawScopeContextRow>(
    `SELECT 
       p.id AS person_id,
       p.tenant_id AS person_tenant_id,

       COALESCE(
         ?,
         p.tenant_id,
         (SELECT m.tenant_id 
          FROM memberships m 
          WHERE m.user_id = u.target_user_id AND m.status = 'active' AND m.revoked_at IS NULL 
          LIMIT 1)
       ) AS target_tenant_id,

       (SELECT COUNT(*) 
        FROM memberships m 
        WHERE m.user_id = u.target_user_id AND m.status = 'active' AND m.revoked_at IS NULL
       ) AS active_membership_count,

       (SELECT m.status 
        FROM memberships m 
        WHERE m.user_id = u.target_user_id 
          AND m.tenant_id = COALESCE(?, p.tenant_id, (SELECT m2.tenant_id FROM memberships m2 WHERE m2.user_id = u.target_user_id AND m2.status = 'active' AND m2.revoked_at IS NULL LIMIT 1))
       ) AS target_membership_status,

       (SELECT m.revoked_at 
        FROM memberships m 
        WHERE m.user_id = u.target_user_id 
          AND m.tenant_id = COALESCE(?, p.tenant_id, (SELECT m2.tenant_id FROM memberships m2 WHERE m2.user_id = u.target_user_id AND m2.status = 'active' AND m2.revoked_at IS NULL LIMIT 1))
       ) AS target_membership_revoked_at,

       (SELECT aec.context_fingerprint
        FROM active_evaluation_contexts aec
        JOIN search_plans sp ON sp.id = aec.search_plan_id AND sp.tenant_id = aec.tenant_id AND sp.person_id = aec.person_id
        WHERE aec.person_id = u.target_user_id
          AND aec.tenant_id = COALESCE(?, p.tenant_id, (SELECT m2.tenant_id FROM memberships m2 WHERE m2.user_id = u.target_user_id AND m2.status = 'active' AND m2.revoked_at IS NULL LIMIT 1))
          AND sp.status = 'active'
        ORDER BY aec.activated_at DESC
        LIMIT 1
       ) AS pointer_context_fingerprint,

       (SELECT aec.search_plan_id
        FROM active_evaluation_contexts aec
        JOIN search_plans sp ON sp.id = aec.search_plan_id AND sp.tenant_id = aec.tenant_id AND sp.person_id = aec.person_id
        WHERE aec.person_id = u.target_user_id
          AND aec.tenant_id = COALESCE(?, p.tenant_id, (SELECT m2.tenant_id FROM memberships m2 WHERE m2.user_id = u.target_user_id AND m2.status = 'active' AND m2.revoked_at IS NULL LIMIT 1))
          AND sp.status = 'active'
        ORDER BY aec.activated_at DESC
        LIMIT 1
       ) AS pointer_search_plan_id,

       (SELECT ec.context_fingerprint
        FROM search_plans sp
        JOIN search_plan_snapshots sps ON sps.search_plan_id = sp.id AND sps.tenant_id = sp.tenant_id AND sps.person_id = sp.person_id
        JOIN evaluation_contexts ec ON ec.search_plan_snapshot_id = sps.id AND ec.tenant_id = sp.tenant_id AND ec.person_id = sp.person_id
        WHERE sp.person_id = u.target_user_id
          AND sp.tenant_id = COALESCE(?, p.tenant_id, (SELECT m2.tenant_id FROM memberships m2 WHERE m2.user_id = u.target_user_id AND m2.status = 'active' AND m2.revoked_at IS NULL LIMIT 1))
          AND sp.status = 'active'
        ORDER BY ec.created_at DESC, ec.context_fingerprint DESC
        LIMIT 1
       ) AS fallback_context_fingerprint,

       (SELECT sp.id
        FROM search_plans sp
        JOIN search_plan_snapshots sps ON sps.search_plan_id = sp.id AND sps.tenant_id = sp.tenant_id AND sps.person_id = sp.person_id
        JOIN evaluation_contexts ec ON ec.search_plan_snapshot_id = sps.id AND ec.tenant_id = sp.tenant_id AND ec.person_id = sp.person_id
        WHERE sp.person_id = u.target_user_id
          AND sp.tenant_id = COALESCE(?, p.tenant_id, (SELECT m2.tenant_id FROM memberships m2 WHERE m2.user_id = u.target_user_id AND m2.status = 'active' AND m2.revoked_at IS NULL LIMIT 1))
          AND sp.status = 'active'
        ORDER BY ec.created_at DESC, ec.context_fingerprint DESC
        LIMIT 1
       ) AS fallback_search_plan_id

     FROM (SELECT ? AS target_user_id) u
     LEFT JOIN people p ON p.id = u.target_user_id`,
    [
      requestedTenantId || null,
      requestedTenantId || null,
      requestedTenantId || null,
      requestedTenantId || null,
      requestedTenantId || null,
      requestedTenantId || null,
      requestedTenantId || null,
      userId,
    ]
  );

  if (!row) {
    throw new TenantIsolationError(`Person ${userId} not found.`);
  }

  // 1. Explicit Requested Tenant Path
  if (requestedTenantId) {
    if (row.target_membership_status === null) {
      throw new TenantIsolationError(`User ${userId} has no membership in tenant ${requestedTenantId}.`);
    }
    if (row.target_membership_status !== "active" || row.target_membership_revoked_at !== null) {
      throw new TenantIsolationError(`Membership for user ${userId} in tenant ${requestedTenantId} is inactive or revoked.`);
    }
    if (!row.person_id) {
      throw new TenantIsolationError(`Person ${userId} not found.`);
    }
    if (row.person_tenant_id === null) {
      throw new TenantIsolationError(`Person ${userId} is a legacy/unassigned record and cannot be accessed by tenant ${requestedTenantId}.`);
    }
    if (row.person_tenant_id !== requestedTenantId) {
      throw new TenantIsolationError(`Access denied. Person ${userId} does not belong to tenant ${requestedTenantId}.`);
    }
  } else {
    // 2. Implicit Tenant Path
    if (!row.person_id && row.active_membership_count === 0) {
      throw new TenantIsolationError(`User ${userId} has no active tenant memberships.`);
    }

    if (!row.person_tenant_id) {
      if (row.active_membership_count > 1) {
        throw new TenantIsolationError(
          `Ambiguous tenant context for user ${userId}. Multiple active memberships found; explicit tenantId required.`
        );
      }
      if (row.active_membership_count === 0) {
        throw new TenantIsolationError(`User ${userId} has no active tenant memberships.`);
      }
    }

    const resolvedTenantId = row.target_tenant_id;
    if (!resolvedTenantId) {
      throw new TenantIsolationError(`User ${userId} has no active tenant memberships.`);
    }

    if (row.target_membership_status === null) {
      throw new TenantIsolationError(`User ${userId} has no membership in tenant ${resolvedTenantId}.`);
    }
    if (row.target_membership_status !== "active" || row.target_membership_revoked_at !== null) {
      throw new TenantIsolationError(`Membership for user ${userId} in tenant ${resolvedTenantId} is inactive or revoked.`);
    }
    if (!row.person_id) {
      throw new TenantIsolationError(`Person ${userId} not found.`);
    }
    if (row.person_tenant_id === null) {
      throw new TenantIsolationError(`Person ${userId} is a legacy/unassigned record and cannot be accessed by tenant ${resolvedTenantId}.`);
    }
    if (row.person_tenant_id !== resolvedTenantId) {
      throw new TenantIsolationError(`Access denied. Person ${userId} does not belong to tenant ${resolvedTenantId}.`);
    }
  }

  const finalTenantId = requestedTenantId || row.target_tenant_id!;
  const scope: AuthorizedPersonScope = {
    tenantId: finalTenantId,
    personId: userId,
  };

  // 3. Derive Active Evaluation Context with strict pointer precedence
  let activeContext: ActiveServingContext | undefined;
  if (row.pointer_context_fingerprint && row.pointer_search_plan_id) {
    activeContext = {
      searchPlanId: row.pointer_search_plan_id,
      contextFingerprint: row.pointer_context_fingerprint,
    };
  } else if (row.fallback_context_fingerprint && row.fallback_search_plan_id) {
    activeContext = {
      searchPlanId: row.fallback_search_plan_id,
      contextFingerprint: row.fallback_context_fingerprint,
    };
  }

  return {
    scope,
    activeContext,
  };
}

export interface ScraperAuthResolution {
  readonly authContext: import("./auth").AuthContext;
  readonly scope: AuthorizedPersonScope;
  readonly activeContext?: ActiveServingContext;
  readonly membership: { readonly role: string; readonly permissions: readonly string[] };
}

/**
 * Resolves verified AuthContext, AuthorizedPersonScope, and active search context
 * for scraper execution strictly from database membership and roles.
 *
 * Invariants:
 * 1. ZERO fallback to "default_tenant" or fabricated permissions.
 * 2. Caller must possess active membership in the target tenant.
 * 3. Caller must possess 'run:scraper', 'manage:search_plan', or 'admin' role.
 */
export async function resolveScraperAuthContext(
  userId: string,
  requestedTenantId?: string,
  adapter?: DatabaseAdapter
): Promise<ScraperAuthResolution> {
  const db = adapter || getDatabaseAdapter();
  const resolved = await resolveServingScope(userId, requestedTenantId, db);
  const tenantId = resolved.scope.tenantId;

  const membership = await db.one<{ role: string; permissions: string }>(
    `SELECT role, permissions FROM memberships WHERE user_id = ? AND tenant_id = ? AND status = 'active' AND revoked_at IS NULL`,
    [userId, tenantId]
  );

  if (!membership) {
    throw new TenantIsolationError(`User ${userId} has no active membership in tenant ${tenantId}.`);
  }

  const permissions = parseStoredPermissions(membership.permissions);

  const isAdmin = membership.role === "admin";
  // Starting a scrape is an explicit workflow policy: search-plan managers can
  // start a run, but this policy never turns their grant into run:scraper or
  // credential-read authority. Downstream credential access remains separately
  // protected by CredentialBroker.
  const canRunScraper = isAdmin || permissions.includes("run:scraper") || permissions.includes("manage:search_plan");

  if (!canRunScraper) {
    throw new TenantIsolationError(`User ${userId} lacks 'run:scraper' or 'manage:search_plan' permission in tenant ${tenantId}.`);
  }

  const effectivePermissions: Permission[] = isAdmin ? ADMIN_PERMISSIONS : permissions;

  const authContext: import("./auth").AuthContext = {
    userId,
    tenantId,
    permissions: effectivePermissions,
  };

  return {
    authContext,
    scope: resolved.scope,
    activeContext: resolved.activeContext,
    membership: {
      role: membership.role,
      permissions,
    },
  };
}
