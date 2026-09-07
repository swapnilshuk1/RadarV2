/**
 * A deliberately narrow repair plan for tenants created by two historical
 * live-verification scripts. It never creates, deletes, or re-scopes identity
 * records; the only possible write is an exact-id tenant status transition.
 */
import type { DatabaseAdapter } from "../../data/database/adapter";

export const CANONICAL_TENANT_ID = "tenant_default";
export const GUEST_TENANT_ID = "tenant_guest-user";

export const APPROVED_DISPOSABLE_TENANT_IDS = [
  "default_tenant_1787306389981",
  "default_tenant_1787306447294",
  "tenant_live_alpha_1787342691598",
  "tenant_live_beta_1787342691598",
  "tenant_live_alpha_1787342733248",
  "tenant_live_beta_1787342733248",
] as const;

export interface ActiveTenantRow {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface TenantAudit {
  readonly tenant: ActiveTenantRow | null;
  readonly membershipsByStatus: ReadonlyArray<{ status: string; count: number }>;
  readonly memberships: ReadonlyArray<{
    userId: string;
    status: string;
    userExists: boolean;
    personExists: boolean;
    personTenantId: string | null;
  }>;
  readonly oauthAccountCount: number | null;
  readonly canonicalDecisionCount: number | null;
  readonly searchPlanCount: number | null;
  readonly evaluationContextCount: number | null;
  readonly acquisitionReferences: Readonly<Record<string, number | null>>;
}

export interface RepairRequest {
  readonly expectedActiveTenantIds: readonly string[];
}

export interface RepairResult {
  readonly beforeActiveTenantIds: readonly string[];
  readonly afterActiveTenantIds: readonly string[];
  readonly updatedTenantIds: readonly string[];
}

function normalizedExactIds(ids: readonly string[], label: string): string[] {
  if (ids.length === 0) throw new Error(`${label} requires at least one exact tenant ID.`);
  const normalized = ids.map((id) => id.trim());
  // `_` is legal in all reviewed tenant IDs; only actual wildcard syntax is refused.
  if (normalized.some((id) => !id || /[*%]/.test(id))) {
    throw new Error(`${label} refuses wildcard, prefix, and empty tenant identifiers.`);
  }
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicate tenant IDs.`);
  return normalized;
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sorted(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export function validateRepairRequest(request: RepairRequest): { tenantIds: string[]; expectedActiveTenantIds: string[] } {
  const expectedActiveTenantIds = normalizedExactIds(request.expectedActiveTenantIds, "--expected-active");
  if (!sameSet(sorted(expectedActiveTenantIds), [CANONICAL_TENANT_ID])) {
    throw new Error("Repair requires tenant_default as the exact sole expected active tenant.");
  }
  return { tenantIds: [], expectedActiveTenantIds };
}

export async function listActiveTenants(db: DatabaseAdapter): Promise<ActiveTenantRow[]> {
  const rows = await db.many<{ id: string; status: string; created_at: string | null; updated_at: string | null }>(
    "SELECT id, status, created_at, updated_at FROM tenants WHERE status = 'active' ORDER BY id",
  );
  return rows.map((row) => ({ id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }));
}

async function tableExists(db: DatabaseAdapter, name: string): Promise<boolean> {
  return Boolean(await db.one<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));
}

async function countTenantReferences(db: DatabaseAdapter, table: string, tenantId: string): Promise<number | null> {
  if (!(await tableExists(db, table))) return null;
  const row = await db.one<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`, [tenantId]);
  return row?.count ?? 0;
}

/** Read-only identity and lineage audit. It intentionally selects IDs only, never names or emails. */
export async function auditTenant(db: DatabaseAdapter, tenantId: string): Promise<TenantAudit> {
  if (!tenantId || /[*%]/.test(tenantId)) throw new Error("Audit requires one exact tenant ID.");
  const tenant = await db.one<{ id: string; status: string; created_at: string | null; updated_at: string | null }>(
    "SELECT id, status, created_at, updated_at FROM tenants WHERE id = ?", [tenantId],
  );
  const membershipsByStatus = await db.many<{ status: string; count: number }>(
    "SELECT status, COUNT(*) AS count FROM memberships WHERE tenant_id = ? GROUP BY status ORDER BY status", [tenantId],
  );
  const memberships = await db.many<{
    user_id: string; status: string; user_exists: number; person_exists: number; person_tenant_id: string | null;
  }>(
    `SELECT m.user_id, m.status,
            EXISTS(SELECT 1 FROM users u WHERE u.id = m.user_id) AS user_exists,
            EXISTS(SELECT 1 FROM people p WHERE p.id = m.user_id) AS person_exists,
            (SELECT p.tenant_id FROM people p WHERE p.id = m.user_id) AS person_tenant_id
       FROM memberships m WHERE m.tenant_id = ? ORDER BY m.user_id`, [tenantId],
  );
  const memberOAuth = await db.one<{ count: number }>(
    `SELECT COUNT(*) AS count FROM oauth_accounts oa
       JOIN memberships m ON m.user_id = oa.user_id WHERE m.tenant_id = ?`, [tenantId],
  );
  const [canonicalDecisionCount, searchPlanCount, evaluationContextCount, candidateCount, jobCount, materializationCount, scrapeRunCount] = await Promise.all([
    countTenantReferences(db, "canonical_decisions", tenantId),
    countTenantReferences(db, "search_plans", tenantId),
    countTenantReferences(db, "evaluation_contexts", tenantId),
    countTenantReferences(db, "search_plan_candidates", tenantId),
    countTenantReferences(db, "evaluation_jobs", tenantId),
    countTenantReferences(db, "materialized_evaluations", tenantId),
    countTenantReferences(db, "scrape_runs", tenantId),
  ]);
  return {
    tenant: tenant ? { id: tenant.id, status: tenant.status, createdAt: tenant.created_at, updatedAt: tenant.updated_at } : null,
    membershipsByStatus,
    memberships: memberships.map((row) => ({
      userId: row.user_id, status: row.status, userExists: Boolean(row.user_exists),
      personExists: Boolean(row.person_exists), personTenantId: row.person_tenant_id,
    })),
    oauthAccountCount: memberOAuth?.count ?? 0,
    canonicalDecisionCount,
    searchPlanCount,
    evaluationContextCount,
    acquisitionReferences: {
      searchPlanCandidates: candidateCount,
      evaluationJobs: jobCount,
      materializedEvaluations: materializationCount,
      scrapeRuns: scrapeRunCount,
    },
  };
}

/** Applies only the reviewed status transitions and validates the exact final active set inside the transaction. */
export async function applyTenantStatusRepair(db: DatabaseAdapter, request: RepairRequest): Promise<RepairResult> {
  const { expectedActiveTenantIds } = validateRepairRequest(request);
  const before = await listActiveTenants(db);
  const beforeIds = before.map((tenant) => tenant.id);
  const tenantIds = beforeIds.filter((id) => id !== CANONICAL_TENANT_ID);
  const projected = beforeIds.filter((id) => !tenantIds.includes(id));
  if (!sameSet(sorted(projected), sorted(expectedActiveTenantIds))) {
    throw new Error(`Repair refused: projected active tenants ${JSON.stringify(sorted(projected))} do not equal --expected-active ${JSON.stringify(sorted(expectedActiveTenantIds))}.`);
  }
  const result = await db.transaction(async (tx) => {
    const insideBefore = (await listActiveTenants(tx)).map((tenant) => tenant.id);
    if (!sameSet(insideBefore, beforeIds)) throw new Error("Repair refused: active tenant set changed before transaction execution.");
    const update = await tx.execute(
      "UPDATE tenants SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id <> ? AND status = 'active'",
      [CANONICAL_TENANT_ID],
    );
    if (update.rowsAffected !== tenantIds.length) {
      throw new Error(`Repair rollback: expected ${tenantIds.length} active tenant updates, got ${update.rowsAffected}.`);
    }
    const afterIds = (await listActiveTenants(tx)).map((tenant) => tenant.id);
    if (!sameSet(sorted(afterIds), sorted(expectedActiveTenantIds))) {
      throw new Error(`Repair rollback: postcondition failed; active tenants are ${JSON.stringify(sorted(afterIds))}.`);
    }
    return afterIds;
  });
  return { beforeActiveTenantIds: beforeIds, afterActiveTenantIds: result, updatedTenantIds: tenantIds };
}

/** Historical live-verification scripts must never seed tenants into configured Turso. */
export function assertNoConfiguredTursoTenantMutation(identity: { engine: string; fingerprint: string }): void {
  if (identity.engine === "turso") {
    throw new Error(`Refusing tenant-mutating verification against configured Turso target ${identity.fingerprint}. Use an isolated test database.`);
  }
}
