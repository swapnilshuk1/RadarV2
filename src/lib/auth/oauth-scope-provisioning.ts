import type { DatabaseAdapter } from "../../data/database";

export interface OAuthIdentity {
  readonly provider: string;
  readonly providerUserId: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly emailVerified: boolean;
}

export interface ProvisionedOAuthScope {
  readonly personId: string;
  readonly tenantId: string;
  /** True only when this callback created a person identity. */
  readonly isNewUser: boolean;
  /** A distinct profile-completion concern; it never changes identity age. */
  readonly needsOnboarding: boolean;
}

const DEFAULT_ADMIN_PERMISSIONS = JSON.stringify([
  "read:evaluation",
  "write:evaluation",
  "manage:search_plan",
  "run:scraper",
  "manage:credentials",
  "read:credentials",
  "read:person",
  "write:person",
]);

/** Creates the whole person/user/membership/OAuth scope before a session exists. */
export async function provisionOAuthScope(
  db: DatabaseAdapter,
  identity: OAuthIdentity,
  createId: () => string,
  createTenantId?: () => string,
): Promise<ProvisionedOAuthScope> {
  if (!identity.emailVerified) {
    throw new Error("[Auth] Verified provider email is required for OAuth identity provisioning.");
  }
  return db.transaction(async (tx) => {
    const linked = await tx.one<{ user_id: string }>(
      "SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?",
      [identity.provider, identity.providerUserId],
    );
    const person = linked
      ? await tx.one<{ id: string; tenant_id: string | null; onboarded: number; role: string }>(
          "SELECT id, tenant_id, onboarded, role FROM people WHERE id = ?",
          [linked.user_id],
        )
      : await tx.one<{ id: string; tenant_id: string | null; onboarded: number; role: string }>(
          "SELECT id, tenant_id, onboarded, role FROM people WHERE email = ?",
          [identity.email],
        );

    if (linked && !person) throw new Error("[Auth] OAuth account is linked to a missing person.");

    const personId = person?.id || createId();
    const isNewUser = !person;
    const needsOnboarding = !person || person.onboarded === 0;

    const existingUser = await tx.one<{ id: string }>("SELECT id FROM users WHERE email = ?", [identity.email]);
    if (existingUser && existingUser.id !== personId) {
      throw new Error("[Auth] OAuth identity has conflicting user and person records.");
    }

    let tenantId = person?.tenant_id || null;
    let createdTenant = false;

    if (!tenantId && person) {
      // Returning person record without a direct tenant_id: resolve from active memberships
      const activeMemberships = await tx.many<{ tenant_id: string }>(
        "SELECT tenant_id FROM memberships WHERE user_id = ? AND status = 'active' AND revoked_at IS NULL ORDER BY created_at ASC",
        [personId],
      );
      if (activeMemberships.length === 1) {
        tenantId = activeMemberships[0].tenant_id;
      } else if (activeMemberships.length > 1) {
        throw new Error(
          `[Auth] Ambiguous tenant context for user ${personId}. Multiple active memberships found; explicit tenant selection required.`,
        );
      }
    }

    if (!tenantId) {
      // Genuinely new identity or legacy unassigned identity: provision their own new tenant
      const candidateTenantId = createTenantId ? createTenantId() : createId();
      tenantId = candidateTenantId === personId ? `tenant_${candidateTenantId}` : candidateTenantId;
      await tx.execute(
        "INSERT INTO tenants (id, status, created_at, updated_at) VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        [tenantId],
      );
      createdTenant = true;
    }

    if (!person) {
      await tx.execute(
        `INSERT INTO people (id, email, tenant_id, name, avatar_url, onboarded, role, email_verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 'admin', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [personId, identity.email, tenantId, identity.name, identity.avatarUrl, identity.emailVerified ? 1 : 0],
      );
    } else {
      // Returning user: adopt resolved/created tenant into people.tenant_id if previously NULL
      const roleClause = createdTenant && person.role !== "admin" ? ", role = 'admin'" : "";
      await tx.execute(
        `UPDATE people SET tenant_id = COALESCE(tenant_id, ?)${roleClause}, name = ?, avatar_url = ?, email_verified = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [tenantId, identity.name, identity.avatarUrl, identity.emailVerified ? 1 : 0, personId],
      );
    }

    await tx.execute("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)", [personId, identity.email]);

    // The owner of a newly created tenant receives the admin role and full self-service permissions.
    // For an existing user whose tenant was pre-existing, respect their established membership and role.
    const isTenantAdmin = createdTenant || !person || person.role === "admin";
    const initialRole = isTenantAdmin ? "admin" : "member";
    const initialPermissions = isTenantAdmin ? DEFAULT_ADMIN_PERMISSIONS : "[]";

    await tx.execute(
      `INSERT INTO memberships (user_id, tenant_id, role, permissions, status)
       VALUES (?, ?, ?, ?, 'active')
       ON CONFLICT(user_id, tenant_id) DO NOTHING`,
      [personId, tenantId, initialRole, initialPermissions],
    );

    await tx.execute(
      "INSERT OR IGNORE INTO oauth_accounts (provider, provider_user_id, user_id) VALUES (?, ?, ?)",
      [identity.provider, identity.providerUserId, personId],
    );

    return { personId, tenantId, isNewUser, needsOnboarding };
  });
}
