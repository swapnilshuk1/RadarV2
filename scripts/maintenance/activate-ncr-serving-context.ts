/**
 * Creates an immutable NCR-serving successor to the current authenticated
 * context. The current context remains active until the successor has
 * rematerialized the existing canonical pool with complete coverage.
 *
 * Default mode is read-only. --apply performs the bounded context transition;
 * it never edits canonical opportunities, historical contexts, or decisions.
 *
 * Usage:
 *   npx tsx scripts/maintenance/activate-ncr-serving-context.ts \
 *     --user-id <authenticated-user-id> [--tenant-id <tenant-id>] [--apply]
 */
import { getDatabaseAdapter } from "../../src/data/database";
import { getRepositories } from "../../src/data/sqlite/provider";
import { materializeExistingCanonicalPool } from "../../src/lib/intelligence/context-materialization";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import path from "node:path";
import { readFileSync } from "node:fs";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadCurrentPolicyVersion(): string {
  const manifest = JSON.parse(
    readFileSync(path.join(process.cwd(), "config", "calibration_manifest.json"), "utf8"),
  ) as { policyVersion?: unknown };
  if (typeof manifest.policyVersion !== "string" || !manifest.policyVersion) {
    throw new Error("Calibration manifest is missing its current policyVersion.");
  }
  return manifest.policyVersion;
}

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  const apply = process.argv.includes("--apply");
  if (!userId) {
    throw new Error("Usage requires --user-id <authenticated-user-id>.");
  }

  const db = getDatabaseAdapter();
  const { scope } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const repos = getRepositories();
  const active = await repos.evaluationContexts.getActiveSearchPlanWithSnapshot(scope);
  if (!active.contextFingerprint) {
    throw new Error("The active plan has no immutable evaluation-context fingerprint.");
  }
  const currentContext = await repos.evaluationContexts.getEvaluationContext(scope, active.contextFingerprint);
  if (!currentContext) {
    throw new Error(`Active evaluation context '${active.contextFingerprint}' cannot be resolved.`);
  }
  const criteria = structuredClone(active.criteria);
  const policyVersion = loadCurrentPolicyVersion();
  const customParameters = (criteria.customParameters || {}) as Record<string, unknown>;
  const functions = Array.isArray(customParameters.functions)
    ? customParameters.functions.filter((value): value is string => typeof value === "string")
    : [];
  const operatingModels = Array.isArray(customParameters.operatingModels)
    ? customParameters.operatingModels.filter((value): value is string => typeof value === "string")
    : [];
  const ownership = Array.isArray(customParameters.ownership)
    ? customParameters.ownership.filter((value): value is string => typeof value === "string")
    : [];
  const { SearchPlanner } = await import("../scraper/run/search-planner");
  const compiled = SearchPlanner.plan({
    targetLevel: criteria.targetSeniority || [],
    functions,
    operatingModels,
    ownership,
    industries: criteria.targetIndustries || [],
    exclusions: criteria.excludedCompanies || [],
    targetTitles: criteria.targetRoles || [],
    preferredLocations: criteria.targetLocations || [],
  },
  path.join(process.cwd(), "config", "ontologies", "taxonomy.json"),
  path.join(process.cwd(), "config", "ontologies", "lexicon.json"));
  criteria.eligibilitySpec = {
    ...(criteria.eligibilitySpec || compiled.eligibilitySpec),
    ontologyVersion: currentContext.ontologyVersion,
    locationPolicy: "NCR",
  };

  const proposed = {
    mode: apply ? "apply" : "preflight",
    scope: { tenantId: scope.tenantId, personId: scope.personId },
    current: {
      searchPlanId: active.planId,
      snapshotId: active.snapshotId,
      contextFingerprint: active.contextFingerprint,
      locationPolicy: active.criteria.eligibilitySpec?.locationPolicy ?? null,
    },
    successor: {
      locationPolicy: criteria.eligibilitySpec.locationPolicy,
      targetLocations: criteria.targetLocations,
      eligibilitySpecSource: active.criteria.eligibilitySpec ? "persisted" : "compiled-from-current-versioned-ontology",
      policyVersion,
      transition: "prepare -> materialize complete coverage -> activate",
    },
  };

  if (!apply) {
    console.log(JSON.stringify(proposed, null, 2));
    return;
  }

  const prepared = await repos.evaluationContexts.prepareSearchPlan(scope, {
    title: active.title,
    criteria,
    ontologyVersion: currentContext.ontologyVersion,
    ontologyFingerprint: currentContext.ontologyFingerprint,
    policyVersion,
    profileVersion: currentContext.profileVersion,
    activatedBy: "g3-ncr-serving-policy",
  });
  const coverage = await materializeExistingCanonicalPool(scope, prepared, db);
  if (coverage.candidates > 0 && coverage.materialized < coverage.candidates) {
    throw new Error(
      `NCR context remains paused: evaluation coverage is incomplete (${coverage.materialized}/${coverage.candidates}).`,
    );
  }

  await repos.evaluationContexts.activatePreparedSearchPlan(
    scope,
    prepared.plan.id,
    prepared.context.contextFingerprint,
    "g3-ncr-serving-policy",
  );
  const distribution = await db.many<{ attention_decision: string; eligibility: string | null; count: number }>(
    `SELECT attention_decision, eligibility, COUNT(*) AS count
     FROM search_plan_candidates
     WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ?
     GROUP BY attention_decision, eligibility
     ORDER BY attention_decision, eligibility`,
    [scope.tenantId, scope.personId, prepared.plan.id],
  );

  console.log(JSON.stringify({
    ...proposed,
    successor: {
      ...proposed.successor,
      searchPlanId: prepared.plan.id,
      snapshotId: prepared.snapshot.id,
      contextFingerprint: prepared.context.contextFingerprint,
    },
    coverage,
    candidateDistribution: distribution,
    result: "activated",
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
