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

import { SqliteOpportunityQueries } from "../../data/sqlite/repositories/SqliteOpportunityQueries";
import { SingleflightOpportunityQueries } from "./serving/singleflight";
import type { FeedPage, FeedFilters, OpaqueCursor, NavigationContext } from "./opportunity-queries";

export class OpportunityService {
  private static getServingQueries(): SingleflightOpportunityQueries {
    return SingleflightOpportunityQueries.getGlobalInstance();
  }

  /**
   * Computes authoritative canonical aggregate metrics across the active search plan population via SQL aggregation.
   */
  static async getMetricsForUser(userId: string, requestedTenantId?: string): Promise<CanonicalOpportunityMetrics> {
    const scope = await resolveScope(userId, requestedTenantId);
    const queries = this.getServingQueries();
    return queries.getMetrics(scope);
  }

  /**
   * Retrieves a paginated feed of lean opportunity summaries with keyset cursor pagination.
   */
  static async getFeedForUser(
    userId: string,
    cursor?: OpaqueCursor,
    filters?: FeedFilters,
    pageSize?: number,
    requestedTenantId?: string
  ): Promise<FeedPage> {
    ensureWorkerDaemonStarted();
    const scope = await resolveScope(userId, requestedTenantId);
    const queries = this.getServingQueries();
    return queries.getFeed(scope, cursor, filters, pageSize);
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
   * Lists candidate opportunity DTOs for a specific user via the lean keyset feed query.
   */
  static async listForUser(userId: string, options?: ServiceOptions, requestedTenantId?: string): Promise<import("../../data/opportunity-fixtures").ServedOpportunity[]> {
    ensureWorkerDaemonStarted();
    const scope = await resolveScope(userId, requestedTenantId);
    const queries = this.getServingQueries();
    const feed = await queries.getFeed(
      scope,
      undefined,
      {
        categoryId: options?.categoryId as any,
        decisionFilter: "unreviewed",
      },
      50
    );

    return feed.items.map((f) => {
      if (f.evaluationState === "SPARSE_SPEC" || f.evaluationState === "UNMATERIALIZED") {
        return {
          evaluationState: f.evaluationState,
          jobHash: f.jobHash,
          role: f.role,
          company: f.company,
          location: f.location,
          postedRelative: "recently",
          scrapedFrom: f.scrapedFrom,
          applyUrl: f.applyUrl || undefined,
          reasonCode: f.evaluationState,
          userDecision: f.userAction ? {
            personId: scope.personId,
            jobHash: f.jobHash,
            userAction: f.userAction,
            reviewedFingerprint: null,
            updatedAt: null,
          } : null,
        } as any;
      }

      return {
        evaluationState: "COMPLETE",
        jobHash: f.jobHash,
        role: f.role,
        company: f.company,
        location: f.location,
        postedRelative: "recently",
        scrapedFrom: f.scrapedFrom,
        applyUrl: f.applyUrl || undefined,
        decision: f.engineVerdict || "PURSUE",
        effectiveDecision: f.effectiveDecision,
        reviewWorkflowState: f.reviewWorkflowState,
        populationTier: f.populationTier,
        engineRecommendation: {
          jobHash: f.jobHash,
          legacyStatus: "CANONICAL",
          verb0: f.engineVerdict || "PURSUE",
          engineVerdict: f.engineVerdict || "PURSUE",
          headspaceVerdict: f.engineVerdict || "PURSUE",
          headspaceDowngraded: false,
          parsingConfidence: 0.95,
          qualityScore: f.qualityScore ?? null,
          evaluatedAt: new Date().toISOString(),
          evaluationFingerprint: "v4.1",
        },
        recommendationResult: {
          score: f.qualityScore ?? null,
          vetoed: f.vetoed,
        },
        userDecision: f.userAction ? {
          personId: scope.personId,
          jobHash: f.jobHash,
          userAction: f.userAction,
          reviewedFingerprint: null,
          updatedAt: null,
        } : null,
        recommendation: "",
        hiringRisk: "Unknown",
        dimensions: [],
        positioning: [],
        headspace: [],
      } as any;
    });
  }

  /**
   * Gets a single computed opportunity DTO by hash strictly within the authorized canonical population.
   * Zero fallback to legacy un-scoped evaluators.
   */
  static async getForUser(userId: string, jobHash: string, options?: ServiceOptions, requestedTenantId?: string): Promise<import("../../data/opportunity-fixtures").ServedOpportunity | undefined> {
    const scope = await resolveScope(userId, requestedTenantId);
    const queries = this.getServingQueries();
    const opp = await queries.getDossier(scope, jobHash);
    return opp || undefined;
  }

  /**
   * Gets adjacent navigation metadata (current index & total count).
   */
  static async getAdjacentInfo(
    userId: string,
    jobHash: string,
    requestedTenantId?: string
  ): Promise<{ currentIndex: number; totalCount: number; prev?: any; next?: any }> {
    const scope = await resolveScope(userId, requestedTenantId);
    const queries = this.getServingQueries();
    const nav = await queries.getNavigation(scope, jobHash);
    if (!nav) {
      return {
        currentIndex: 0,
        totalCount: 0,
        prev: undefined,
        next: undefined,
      };
    }
    return {
      currentIndex: nav.currentIndex,
      totalCount: nav.totalCount,
      prev: nav.prevJobHash,
      next: nav.nextJobHash,
    };
  }

  /**
   * Gets neighbors (prev/next DTOs) of an opportunity across full canonical evaluation population.
   */
  static async neighboursForUser(
    userId: string,
    jobHash: string,
    options?: ServiceOptions,
    requestedTenantId?: string
  ): Promise<{ prev: any; next: any }> {
    const scope = await resolveScope(userId, requestedTenantId);
    const queries = this.getServingQueries();
    const nav = await queries.getNavigation(scope, jobHash, { categoryId: options?.categoryId as any });
    return {
      prev: nav?.prevJobHash,
      next: nav?.nextJobHash,
    };
  }

  /**
   * High-performance single-request loader for executive opportunity dossier.
   * Resolves authorized scope once and retrieves opportunity with adjacent navigation metadata.
   */
  static async getDetailsForUser(
    userId: string,
    jobHash: string,
    options?: ServiceOptions,
    requestedTenantId?: string
  ): Promise<{
    opportunity: import("../../data/opportunity-fixtures").ServedOpportunity | undefined;
    currentIndex: number;
    totalCount: number;
    neighbors: { prev: any; next: any };
  }> {
    const scope = await resolveScope(userId, requestedTenantId);
    const queries = this.getServingQueries();
    const [opp, nav] = await Promise.all([
      queries.getDossier(scope, jobHash),
      queries.getNavigation(scope, jobHash, { categoryId: options?.categoryId as any }),
    ]);

    if (!opp || !nav) {
      return {
        opportunity: undefined,
        currentIndex: 0,
        totalCount: 0,
        neighbors: {
          prev: undefined,
          next: undefined,
        },
      };
    }

    return {
      opportunity: opp,
      currentIndex: nav.currentIndex,
      totalCount: nav.totalCount,
      neighbors: {
        prev: nav.prevJobHash,
        next: nav.nextJobHash,
      },
    };
  }
}
