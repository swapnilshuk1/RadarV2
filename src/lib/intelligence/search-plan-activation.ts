import fs from "node:fs";
import path from "node:path";
import { getRepositories } from "../../data/sqlite/provider";
import { getDatabaseAdapter } from "../../data/database";
import { TenantScopedPersonStore } from "../../data/sqlite/repositories/TenantScopedPersonStore";
import { NoActiveEvaluationContextError } from "../../data/sqlite/repositories/SqliteEvaluationContextStore";
import type { AuthorizedPersonScope } from "../security/auth";
import { resolveServingScope } from "../security/scope-resolver";
import type { SearchCriteriaPayload } from "../domain/evaluation_context";
import type { CareerIntentRecord } from "../../data/sqlite/repositories/SqliteDocumentStore";
import { materializeExistingCanonicalPool } from "./context-materialization";

interface EvaluationVersionManifest {
  policyVersion: string;
  ontologyVersion: string;
  ontologyHash: string;
}

function loadEvaluationVersionManifest(): EvaluationVersionManifest {
  const manifestPath = path.join(process.cwd(), "config", "calibration_manifest.json");
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Partial<EvaluationVersionManifest>;
  if (
    typeof parsed.policyVersion !== "string" || !parsed.policyVersion ||
    typeof parsed.ontologyVersion !== "string" || !parsed.ontologyVersion ||
    typeof parsed.ontologyHash !== "string" || !parsed.ontologyHash
  ) {
    throw new Error("Calibration manifest is missing the required policy or ontology identity.");
  }
  return {
    policyVersion: parsed.policyVersion,
    ontologyVersion: parsed.ontologyVersion,
    ontologyHash: parsed.ontologyHash,
  };
}

/**
 * Compiles and atomically activates the canonical search-plan criteria used by
 * both the profile intent flow and the legacy session flow. Keeping this in a
 * shared service prevents an intent write from leaving the active scraper plan
 * stale or shaped like the planner's derived output.
 */
export async function activateSearchPlanForIntent(
  input: CareerIntentRecord & {
    functions?: string[];
    industries?: string[];
    activatedBy?: string;
    scope?: AuthorizedPersonScope;
  }
) {
  const preconditions = await validateIntentActivationPreconditions(input);
  const { effectiveFunctions, effectiveTitles, effectiveLocations, targetLevels, scope, profileVersion } = preconditions;

  const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
  const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");
  const { SearchPlanner } = await import("../../../scripts/scraper/run/search-planner");
  const searchPlan = SearchPlanner.plan({
    targetLevel: Array.from(targetLevels),
    functions: effectiveFunctions,
    operatingModels: [],
    ownership: [],
    industries: input.industries || [],
    exclusions: [],
    targetTitles: effectiveTitles,
    preferredLocations: effectiveLocations,
  }, taxonomyPath, lexiconPath);

  const criteria: SearchCriteriaPayload = {
    targetSeniority: Array.from(targetLevels),
    targetRoles: effectiveTitles,
    targetLocations: effectiveLocations,
    targetIndustries: input.industries || [],
    eligibilitySpec: {
      ...searchPlan.eligibilitySpec,
      ontologyVersion: loadEvaluationVersionManifest().ontologyVersion,
    },
    customParameters: {
      functions: effectiveFunctions,
      operatingModels: [],
      ownership: [],
      generatedQueries: searchPlan.rankedQueries.map((q) => q.query),
    },
  };
  const versions = loadEvaluationVersionManifest();
  const repos = getRepositories();
  let predecessor: { planId: string } | undefined;
  try {
    predecessor = await repos.evaluationContexts.getActiveSearchPlanWithSnapshot(scope);
  } catch (error) {
    if (!(error instanceof NoActiveEvaluationContextError)) throw error;
    // First activation deliberately has no inferred predecessor. It creates
    // an explicit lineage without promoting historical/latest data.
  }
  const activationInput = {
    title: "Executive Career Search Plan",
    criteria,
    ontologyVersion: versions.ontologyVersion,
    ontologyFingerprint: versions.ontologyHash,
    policyVersion: versions.policyVersion,
    profileVersion,
    activatedBy: input.activatedBy || "intent-update",
  };
  const activation = await repos.evaluationContexts.prepareSearchPlan(scope, activationInput);
  const coverage = predecessor
    ? await materializeExistingCanonicalPool(scope, activation, { sourceSearchPlanId: predecessor.planId })
    : { examined: 0, candidates: 0, materialized: 0 };
  if (coverage.candidates > 0 && coverage.materialized < coverage.candidates) {
    throw new Error(
      `Search-plan activation was not committed: evaluation coverage is incomplete (${coverage.materialized}/${coverage.candidates} eligible canonical opportunities).`
    );
  }
  await repos.evaluationContexts.activatePreparedSearchPlan(
    scope,
    activation.plan.id,
    activation.context.contextFingerprint,
    activationInput.activatedBy
  );
  return { activation: { ...activation, plan: { ...activation.plan, status: "active" as const } }, searchPlan, criteria, coverage };
}

/**
 * Validates intent-to-context prerequisites without selecting an active
 * context. It is used before an immutable intent write and by activation.
 */
export async function validateIntentActivationPreconditions(
  input: CareerIntentRecord & {
    functions?: string[];
    industries?: string[];
    scope?: AuthorizedPersonScope;
  }
): Promise<{
  effectiveFunctions: string[];
  effectiveTitles: string[];
  effectiveLocations: string[];
  targetLevels: Set<string>;
  scope: AuthorizedPersonScope;
  profileVersion: string;
}> {
  const effectiveFunctions = input.functions || [];
  const effectiveTitles = input.targetTitles || [];
  const effectiveLocations = input.preferredLocations || [];
  if (effectiveTitles.length === 0 || effectiveLocations.length === 0) {
    throw new Error("PROFILE_INTENT_REQUIRED: Search-plan activation requires explicitly saved target titles and locations.");
  }

  const targetLevels = new Set<string>();
  for (const title of effectiveTitles) {
    const lower = title.toLowerCase();
    if (lower.includes("cmo") || lower.includes("chief") || lower.includes("cco")) targetLevels.add("Chief");
    if (lower.includes("vp") || lower.includes("vice president")) targetLevels.add("VP");
    if (lower.includes("director")) targetLevels.add("Director");
    if (lower.includes("svp") || lower.includes("senior vice president")) targetLevels.add("SVP");
    if (lower.includes("head") || lower.includes("lead")) targetLevels.add("Head");
  }
  if (targetLevels.size === 0) {
    throw new Error("PROFILE_INTENT_REQUIRED: Target titles must contain an explicit recognized seniority level.");
  }

  const scope = input.scope || (await resolveServingScope(input.personId)).scope;
  const projection = await new TenantScopedPersonStore(getDatabaseAdapter(), scope).getLatestProjection(scope.personId);
  if (!projection?.profileVersion) {
    throw new Error("PROFILE_REQUIRED: Search-plan activation requires an authoritative candidate projection version.");
  }
  return { effectiveFunctions, effectiveTitles, effectiveLocations, targetLevels, scope, profileVersion: projection.profileVersion };
}
