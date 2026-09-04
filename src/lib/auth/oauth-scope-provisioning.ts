import type { DatabaseAdapter } from "../../data/database";

export interface OAuthIdentity {
  readonly provider: string;
  readonly providerUserId: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly emailVerified: boolean;
}

export interface ProvisionedOAuthScope { readonly personId: string; readonly tenantId: string; readonly isNewUser: boolean; }

/** Creates the whole person/user/membership/OAuth scope before a session exists. */
export async function provisionOAuthScope(db: DatabaseAdapter, identity: OAuthIdentity, createId: () => string): Promise<ProvisionedOAuthScope> {
  if (!identity.emailVerified) {
    throw new Error("[Auth] Verified provider email is required for OAuth identity provisioning.");
  }
  return db.transaction(async (tx) => {
    const tenants = await tx.many<{ id: string }>("SELECT id FROM tenants WHERE status = 'active' ORDER BY created_at ASC LIMIT 2");
    if (tenants.length !== 1) throw new Error("[Auth] OAuth provisioning requires exactly one active tenant.");
    const tenantId = tenants[0].id;
    const linked = await tx.one<{ user_id: string }>("SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?", [identity.provider, identity.providerUserId]);
    const person = linked
      ? await tx.one<{ id: string; onboarded: number }>("SELECT id, onboarded FROM people WHERE id = ?", [linked.user_id])
      : await tx.one<{ id: string; onboarded: number }>("SELECT id, onboarded FROM people WHERE email = ?", [identity.email]);
    if (linked && !person) throw new Error("[Auth] OAuth account is linked to a missing person.");
    const personId = person?.id || createId();
    const isNewUser = !person || person.onboarded === 0;
    const existingUser = await tx.one<{ id: string }>("SELECT id FROM users WHERE email = ?", [identity.email]);
    if (existingUser && existingUser.id !== personId) throw new Error("[Auth] OAuth identity has conflicting user and person records.");
    if (!person) {
      await tx.execute(`INSERT INTO people (id, email, tenant_id, name, avatar_url, onboarded, role, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'user', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [personId, identity.email, tenantId, identity.name, identity.avatarUrl, identity.emailVerified ? 1 : 0]);
    } else {
      await tx.execute("UPDATE people SET tenant_id = ?, name = ?, avatar_url = ?, email_verified = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [tenantId, identity.name, identity.avatarUrl, identity.emailVerified ? 1 : 0, personId]);
    }
    await tx.execute("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)", [personId, identity.email]);
    await tx.execute(`INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES (?, ?, 'member', '[]', 'active') ON CONFLICT(user_id, tenant_id) DO UPDATE SET status = 'active', revoked_at = NULL`, [personId, tenantId]);
    await tx.execute("INSERT OR IGNORE INTO oauth_accounts (provider, provider_user_id, user_id) VALUES (?, ?, ?)", [identity.provider, identity.providerUserId, personId]);
    return { personId, tenantId, isNewUser };
  });
}
