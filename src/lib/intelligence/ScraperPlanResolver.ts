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
 */

import path from "node:path";
import { getDatabaseAdapter, type DatabaseAdapter } from "../../data/database";
import type { AuthorizedPersonScope } from "../security/auth";
import type { ActiveServingContext } from "../security/scope-resolver";
import type { SearchCriteriaPayload } from "../domain/evaluation_context";

export interface ResolvedScraperPlan {
  readonly searchPlanId: string;
  readonly snapshotId?: string;
  readonly contextFingerprint?: string;
  readonly title: string;
  readonly criteria: SearchCriteriaPayload;
  readonly queries: string[];
  readonly queryCount: number;
  readonly source: "persisted_active_plan" | "dynamic_candidate_state";
}

interface PlanRow {
  id: string;
  title: string;
  criteria_json: string;
  snapshot_id?: string;
  snapshot_payload?: string;
}

export class ScraperPlanResolver {
  /**
   * Resolves the active search plan for an authorized scope and compiles ranked queries.
   * Returns undefined if no persisted plan or valid candidate intent exists.
   */
  static async resolveActivePlan(
    scope: AuthorizedPersonScope,
    activeContext?: ActiveServingContext,
    adapter?: DatabaseAdapter,
    searchPlanIdOverride?: string
  ): Promise<ResolvedScraperPlan | undefined> {
    const db = adapter || getDatabaseAdapter();
    const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
    const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");

    const targetPlanId = searchPlanIdOverride || activeContext?.searchPlanId;

    let planRow: PlanRow | null = null;

    if (targetPlanId) {
      planRow = await db.one<PlanRow>(
        `SELECT sp.id, sp.title, sp.criteria_json, sps.id AS snapshot_id, sps.payload_json AS snapshot_payload
         FROM search_plans sp
         LEFT JOIN search_plan_snapshots sps ON sps.search_plan_id = sp.id AND sps.tenant_id = sp.tenant_id AND sps.person_id = sp.person_id
         WHERE sp.id = ? AND sp.tenant_id = ? AND sp.person_id = ?
         ORDER BY sps.created_at DESC
         LIMIT 1`,
        [targetPlanId, scope.tenantId, scope.personId]
      );
    }

    if (!planRow) {
      planRow = await db.one<PlanRow>(
        `SELECT sp.id, sp.title, sp.criteria_json, sps.id AS snapshot_id, sps.payload_json AS snapshot_payload
         FROM search_plans sp
         LEFT JOIN search_plan_snapshots sps ON sps.search_plan_id = sp.id AND sps.tenant_id = sp.tenant_id AND sps.person_id = sp.person_id
         WHERE sp.tenant_id = ? AND sp.person_id = ? AND sp.status = 'active'
         ORDER BY sp.updated_at DESC, sps.created_at DESC
         LIMIT 1`,
        [scope.tenantId, scope.personId]
      );
    }

    let criteria: SearchCriteriaPayload | null = null;
    let source: "persisted_active_plan" | "dynamic_candidate_state" = "persisted_active_plan";
    let planId = "";
    let planTitle = "";
    let snapshotId: string | undefined = undefined;

    if (planRow) {
      planId = planRow.id;
      planTitle = planRow.title;
      snapshotId = planRow.snapshot_id || undefined;
      const rawPayload = planRow.snapshot_payload || planRow.criteria_json;
      try {
        criteria = JSON.parse(rawPayload);
      } catch {
        criteria = null;
      }
    }

    // Fallback to candidate state in Turso if no active plan row exists
    if (!criteria) {
      try {
        const { getRepositories } = await import("../../data/sqlite/provider");
        const repos = getRepositories();
        const candidateState = await repos.people.getCandidateState(scope.personId);
        if (candidateState?.intent) {
          const { CareerIntentModel } = await import("../../../scripts/scraper/run/career-intent");
          const intent = CareerIntentModel.extractIntentFromCandidateState(candidateState, taxonomyPath);
          const { SearchPlanner } = await import("../../../scripts/scraper/run/search-planner");
          const searchPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);
          const queries = searchPlan.rankedQueries?.map((q: any) => q.query) || [];
          if (queries.length > 0) {
            return {
              searchPlanId: `dynamic_${scope.personId}`,
              contextFingerprint: activeContext?.contextFingerprint,
              title: "Dynamic Candidate Career Plan",
              criteria: {
                targetRoles: intent.targetTitles,
                targetSeniority: intent.targetLevel,
                targetLocations: intent.preferredLocations,
                targetIndustries: intent.industries,
              },
              queries,
              queryCount: queries.length,
              source: "dynamic_candidate_state",
            };
          }
        }
      } catch {
        // Ignore candidate state lookup failure
      }
    }

    if (!criteria) {
      return undefined;
    }

    // Synthesize CareerIntent and compile discrete SearchPlan queries
    const targetRoles: string[] = criteria.targetRoles || [];
    const targetSeniority: string[] = criteria.targetSeniority || [];
    const targetLocations: string[] = criteria.targetLocations || [];
    const targetIndustries: string[] = criteria.targetIndustries || [];
    const customParams = (criteria.customParameters as Record<string, unknown>) || {};
    const functions = (customParams.functions as string[]) || [];

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
    if (targetLevels.size === 0) {
      targetLevels.add("VP").add("Head").add("Chief");
    }

    const { SearchPlanner } = await import("../../../scripts/scraper/run/search-planner");
    const intent = {
      targetLevel: Array.from(targetLevels),
      functions: functions.length > 0 ? functions : ["Marketing", "Growth"],
      operatingModels: ["B2B", "Enterprise", "Scale-up"],
      ownership: ["P&L", "Commercial"],
      industries: targetIndustries,
      exclusions: criteria.excludedCompanies || [],
      targetTitles: targetRoles.length > 0 ? targetRoles : ["Vice President", "Chief Commercial Officer", "Head of Growth"],
      preferredLocations: targetLocations.length > 0 ? targetLocations : ["Gurugram", "Remote India"],
    };

    const compiledPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);
    const queries = (compiledPlan.rankedQueries || []).map((q: any) => q.query);

    return {
      searchPlanId: planId,
      snapshotId,
      contextFingerprint: activeContext?.contextFingerprint,
      title: planTitle,
      criteria,
      queries,
      queryCount: queries.length,
      source,
    };
  }
}

export const resolveActiveScraperPlan = ScraperPlanResolver.resolveActivePlan;
