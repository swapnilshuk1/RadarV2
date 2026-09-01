/**
 * src/lib/intelligence/ScraperPlanResolver.ts
 *
 * RADAR v2 — Authoritative Scraper Search Plan Resolver & Compiler.
 *
 * Resolves the authorized tenant/person active search plan, criteria payload,
 * and compiles discrete ranked search queries via SearchPlanner.
 *
 * Architectural Boundary:
 * - Keeps security authorization (scope-resolver.ts) strictly decoupled from
 *   business criteria compilation and query ranking.
 * - Single source of truth for converting persisted search plans / snapshots into
 *   executable queries for the scraper engine.
 * - Never executes raw SQL: delegates all persistence to StorageProvider.evaluationContexts.
 */

import path from "node:path";
import { getRepositories, createRepositories } from "../../data/sqlite/provider";
import type { DatabaseAdapter } from "../../data/database";
import type { AuthorizedPersonScope } from "../security/auth";
import type { ActiveServingContext } from "../security/scope-resolver";
import type { SearchCriteriaPayload } from "../domain/evaluation_context";
import { InsufficientSearchCriteriaError } from "../../../scripts/scraper/run/search-planner";

export interface ResolvedScraperPlan {
  readonly searchPlanId: string;
  readonly snapshotId?: string;
  readonly contextFingerprint?: string;
  readonly title: string;
  readonly criteria: SearchCriteriaPayload;
  readonly queries: string[];
  readonly queryCount: number;
  readonly source: "persisted_active_plan";
}

export class ScraperPlanResolver {
  /**
   * Resolves the active search plan for an authorized scope and compiles ranked queries.
   * Enforces zero-fallback: throws an explicit error if plan is missing, inactive, or has insufficient criteria.
   */
  static async resolveActivePlan(
    scope: AuthorizedPersonScope,
    activeContext?: ActiveServingContext,
    adapter?: DatabaseAdapter,
    searchPlanIdOverride?: string
  ): Promise<ResolvedScraperPlan> {
    const repos = adapter ? createRepositories(adapter) : getRepositories();
    const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
    const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");

    const targetPlanId = searchPlanIdOverride || activeContext?.searchPlanId;
    const targetFingerprint = activeContext?.contextFingerprint;

    // Resolve authoritative active plan and exact snapshot via repository store
    const lineage = await repos.evaluationContexts.getActiveSearchPlanWithSnapshot(scope, {
      searchPlanId: targetPlanId,
      contextFingerprint: targetFingerprint,
      allowOverrideWithoutPointer: !!searchPlanIdOverride,
    });

    const criteria = lineage.criteria;
    if (!criteria) {
      throw new InsufficientSearchCriteriaError(
        `[ScraperPlanResolver] Search plan '${lineage.planId}' has no valid criteria payload.`
      );
    }

    const targetRoles: string[] = criteria.targetRoles || [];
    const targetSeniority: string[] = criteria.targetSeniority || [];
    const targetLocations: string[] = criteria.targetLocations || [];
    const targetIndustries: string[] = criteria.targetIndustries || [];
    const customParams = (criteria.customParameters as Record<string, unknown>) || {};
    const functions: string[] = Array.isArray(customParams.functions)
      ? (customParams.functions as string[])
      : Array.isArray(customParams.function)
      ? (customParams.function as string[])
      : [];
    const operatingModels: string[] = Array.isArray(customParams.operatingModels)
      ? (customParams.operatingModels as string[])
      : [];
    const ownership: string[] = Array.isArray(customParams.ownership)
      ? (customParams.ownership as string[])
      : [];

    // Zero-fallback invariant: Must have at least targetRoles or declared functions
    if (targetRoles.length === 0 && functions.length === 0) {
      throw new InsufficientSearchCriteriaError(
        `[ScraperPlanResolver] Search plan '${lineage.planId}' has insufficient criteria to compile search queries. Target roles or functions must be defined.`
      );
    }

    const targetLevels = new Set<string>(targetSeniority);
    if (targetLevels.size === 0) {
      targetRoles.forEach((title: string) => {
        const lower = title.toLowerCase();
        if (lower.includes("cmo") || lower.includes("chief") || lower.includes("cco")) targetLevels.add("Chief");
        if (lower.includes("vp") || lower.includes("vice president")) targetLevels.add("VP");
        if (lower.includes("director")) targetLevels.add("Director");
        if (lower.includes("svp") || lower.includes("senior vice president")) targetLevels.add("SVP");
        if (lower.includes("head") || lower.includes("lead")) targetLevels.add("Head");
      });
    }

    const { SearchPlanner } = await import("../../../scripts/scraper/run/search-planner");
    const intent = {
      targetLevel: Array.from(targetLevels),
      functions,
      operatingModels,
      ownership,
      industries: targetIndustries,
      exclusions: criteria.excludedCompanies || [],
      targetTitles: targetRoles,
      preferredLocations: targetLocations,
    };

    const compiledPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);
    const queries = (compiledPlan.rankedQueries || []).map((q: any) => q.query);

    if (queries.length === 0) {
      throw new InsufficientSearchCriteriaError(
        `[ScraperPlanResolver] Search plan '${lineage.planId}' generated 0 ranked queries from criteria.`
      );
    }

    return {
      searchPlanId: lineage.planId,
      snapshotId: lineage.snapshotId,
      contextFingerprint: lineage.contextFingerprint,
      title: lineage.title,
      criteria,
      queries,
      queryCount: queries.length,
      source: "persisted_active_plan",
    };
  }
}

export const resolveActiveScraperPlan = ScraperPlanResolver.resolveActivePlan;

