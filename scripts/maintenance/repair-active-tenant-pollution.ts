/**
 * Read-only by default. This is the only approved status-only repair for the
 * all currently active noncanonical tenants; it never touches identity
 * tables or person tenant scopes.
 *
 * Audit:
 *   npx tsx scripts/maintenance/repair-active-tenant-pollution.ts
 * Guest audit:
 *   npx tsx scripts/maintenance/repair-active-tenant-pollution.ts --audit-guest-user
 * Apply (exact IDs and expected final active set are mandatory):
 *   npx tsx scripts/maintenance/repair-active-tenant-pollution.ts --apply ...
 */
import { getDatabaseAdapter, getDatabaseTargetIdentity } from "../../src/data/database";
import {
  CANONICAL_TENANT_ID,
  GUEST_TENANT_ID,
  applyTenantStatusRepair,
  auditTenant,
  listActiveTenants,
} from "../../src/lib/maintenance/active-tenant-pollution-repair";

function values(flag: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag) {
      const value = process.argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires an exact value.`);
      result.push(value);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const auditGuest = process.argv.includes("--audit-guest-user");
  const expectedActiveTenantIds = values("--expected-active");
  if (auditGuest && (apply || expectedActiveTenantIds.length)) {
    throw new Error("--audit-guest-user is read-only and cannot be combined with repair flags.");
  }
  const identity = getDatabaseTargetIdentity();
  const db = getDatabaseAdapter();
  const activeTenants = await listActiveTenants(db);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "read-only",
    database: { radarEnv: identity.radarEnv, engine: identity.engine, fingerprint: identity.fingerprint, target: identity.sanitizedTarget },
    activeTenants,
    affectedTenantIds: activeTenants.map((tenant) => tenant.id).filter((tenantId) => tenantId !== CANONICAL_TENANT_ID),
  }, null, 2));
  if (auditGuest) {
    console.log(JSON.stringify({ mode: "guest-user-read-only-audit", tenantId: GUEST_TENANT_ID, audit: await auditTenant(db, GUEST_TENANT_ID) }, null, 2));
    return;
  }
  const affectedTenantIds = activeTenants.map((tenant) => tenant.id).filter((tenantId) => tenantId !== CANONICAL_TENANT_ID);
  const audits = await Promise.all(affectedTenantIds.map((tenantId) => auditTenant(db, tenantId)));
  console.log(JSON.stringify({ mode: apply ? "apply-preflight" : "read-only-audit", audits }, null, 2));
  if (!apply) return;
  console.log(JSON.stringify(await applyTenantStatusRepair(db, { expectedActiveTenantIds: expectedActiveTenantIds.length ? expectedActiveTenantIds : [CANONICAL_TENANT_ID] }), null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
