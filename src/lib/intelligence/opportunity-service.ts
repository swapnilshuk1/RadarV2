/**
 * src/lib/intelligence/opportunity-service.ts
 *
 * RADAR V4 Canonical Multi-Tenant Opportunity Serving Service (Milestone M8).
 *
 * Exposes the executive-facing opportunity query contracts backed by the canonical
 * multi-tenant relational lineage:
 *   tenants
 *   → people (tenant_id scoped)
 *   → search_plans (active)
 *   → search_plan_snapshots
 *   → evaluation_contexts (ontology + policy fingerprint)
 *   → search_plan_candidates (attention_decision = 'CANDIDATE')
 *   → canonical_opportunities
 *   → opportunity_versions
 *   → materialized_evaluations (tenant/person/context scoped)
 *   → decisions (user actions)
 *   → Opportunity DTO
 */

import { getRepositories } from "../../data/sqlite/provider";
import { getDatabaseAdapter } from "../../data/database";
import type { Opportunity } from "@/data/opportunity-fixtures";
import type { CanonicalOpportunityMetrics } from "./metric-integrity";
import {
  authenticateTenantMembership,
  authorizePersonScope,
  TenantIsolationError,
  type AuthorizedPersonScope,
} from "../security/auth";

export type ServiceOptions = {
  activePursuits?: number;
  categoryId?: string;
};

export interface OpportunityMetrics {
  totalScreened: number;
  activePursuits: number;
  totalShortlisted: number;
  totalDecisions: number;
  remainingToReview: number;
  breakdown: {
    pursue: number;
    consider: number;
    pass: number;
    sparse: number;
  };
}

function ensureWorkerDaemonStarted() {
  if (typeof window !== "undefined" || process.env.NODE_ENV === "test") return;
  import("./EvaluationDaemon").then(({ EvaluationDaemon }) => {
    EvaluationDaemon.startGlobalDaemon(2000);
  }).catch(() => {});
}

/**
 * Resolves AuthorizedPersonScope strictly through authenticated database membership and person scoping.
 * Zero implicit fallback to default tenants.
 */
export async function resolveScope(userId: string, requestedTenantId?: string): Promise<AuthorizedPersonScope> {
  const db = getDatabaseAdapter();
  let tenantId = requestedTenantId;

  if (!tenantId) {
    // Determine active tenant from person's explicit tenant assignment or unique active membership
    const person = await db.one<{ tenant_id: string | null }>(
      `SELECT tenant_id FROM people WHERE id = ?`,
      [userId]
    );

    if (person?.tenant_id) {
      tenantId = person.tenant_id;
    } else {
      const activeMemberships = await db.many<{ tenant_id: string }>(
        `SELECT tenant_id FROM memberships WHERE user_id = ? AND status = 'active' AND revoked_at IS NULL`,
        [userId]
      );
      if (activeMemberships.length === 1) {
        tenantId = activeMemberships[0].tenant_id;
      } else if (activeMemberships.length > 1) {
        throw new TenantIsolationError(
          `Ambiguous tenant context for user ${userId}. Multiple active memberships found; explicit tenantId required.`
        );
      } else {
        throw new TenantIsolationError(`User ${userId} has no active tenant memberships.`);
      }
    }
  }

  const authContext = await authenticateTenantMembership(userId, tenantId, db);
  return authorizePersonScope(authContext, userId, db);
}

export class OpportunityService {
  /**
   * Computes authoritative canonical aggregate metrics across the active search plan population.
   */
  static async getMetricsForUser(userId: string, requestedTenantId?: string): Promise<CanonicalOpportunityMetrics> {
    const scope = await resolveScope(userId, requestedTenantId);
    const repos = getRepositories();
    return repos.canonicalServing.getOpportunityMetrics(scope);
  }

  /**
   * Hydrates exact opportunity DTOs for user decisions independent of feed rank bounds.
   */
  static async listDecidedForUser(userId: string, requestedTenantId?: string): Promise<Opportunity[]> {
    const scope = await resolveScope(userId, requestedTenantId);
    const repos = getRepositories();
    return repos.canonicalServing.listDecidedOpportunities(scope);
  }

  /**
   * Lists all candidate opportunity DTOs for a specific user via the canonical joined query with dynamic contextual serving.
   */
  static async listForUser(userId: string, options?: ServiceOptions, requestedTenantId?: string): Promise<Opportunity[]> {
    ensureWorkerDaemonStarted();
    const scope = await resolveScope(userId, requestedTenantId);
    const repos = getRepositories();
    return repos.canonicalServing.listOpportunities(scope, options);
  }

  /**
   * Gets a single computed opportunity DTO by hash strictly within the authorized canonical population.
   * Zero fallback to legacy un-scoped evaluators.
   */
  static async getForUser(userId: string, jobHash: string, options?: ServiceOptions, requestedTenantId?: string): Promise<Opportunity | undefined> {
    const scope = await resolveScope(userId, requestedTenantId);
    const repos = getRepositories();
    return repos.canonicalServing.getOpportunity(scope, jobHash, options);
  }

  /**
   * Gets neighbors (prev/next DTOs) of an opportunity across full canonical evaluation population.
   */
  static async neighboursForUser(
    userId: string,
    jobHash: string,
    options?: ServiceOptions,
    requestedTenantId?: string
  ): Promise<{ prev: Opportunity | undefined; next: Opportunity | undefined }> {
    const scope = await resolveScope(userId, requestedTenantId);
    const repos = getRepositories();
    const adj = await repos.canonicalServing.getAdjacentOpportunities(scope, jobHash);
    return { prev: adj.prev, next: adj.next };
  }

  /**
   * Gets adjacent navigation metadata (current index & total count).
   */
  static async getAdjacentInfo(
    userId: string,
    jobHash: string,
    requestedTenantId?: string
  ): Promise<{ currentIndex: number; totalCount: number; prev?: Opportunity; next?: Opportunity }> {
    const scope = await resolveScope(userId, requestedTenantId);
    const repos = getRepositories();
    return repos.canonicalServing.getAdjacentOpportunities(scope, jobHash);
  }
}
