/**
 * Prepare, but never activate, a source-bound semantic-regression context.
 *
 * This command is deliberately narrower than a normal context transition: a
 * caller must name the immutable source plan and the exact source-association
 * count.  Tenant/person scope authorizes the operation; it never selects a
 * tenant-wide market population implicitly.
 *
 * Usage:
 *   npx tsx scripts/maintenance/prepare-semantic-regression-context.ts \
 *     --user-id <id> --tenant-id <id> --source-plan-id <id> \
 *     --expected-source-records 44 --title <unique-title> [--apply]
 */
import crypto from "node:crypto";
import { getDatabaseAdapter } from "../../src/data/database";
import { getRepositories } from "../../src/data/sqlite/provider";
import { materializeExistingCanonicalPool } from "../../src/lib/intelligence/context-materialization";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function candidateHashes(db: ReturnType<typeof getDatabaseAdapter>, personId: string) {
  const [careerProfiles, candidateProjections] = await Promise.all([
    db.many(`SELECT id, projection_json, updated_at FROM career_profiles WHERE person_id = ? ORDER BY id`, [personId]),
    db.many(`SELECT id, timeline, skills, claims FROM candidate_projection WHERE person_id = ? ORDER BY id`, [personId]),
  ]);
  return {
    careerProfilesHash: hash(careerProfiles),
    candidateProjectionHash: hash(candidateProjections),
  };
}

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  const sourcePlanId = argument("--source-plan-id");
  const title = argument("--title")?.trim();
  const expectedSourceRecords = positiveInteger(argument("--expected-source-records"), "--expected-source-records");
  const apply = process.argv.includes("--apply");
  if (!userId || !sourcePlanId || !title) {
    throw new Error("Usage requires --user-id, --source-plan-id, and a unique --title.");
  }

  const db = getDatabaseAdapter();
  const { scope } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const repos = getRepositories();
  const active = await repos.evaluationContexts.getActiveSearchPlanWithSnapshot(scope);
  if (!active.contextFingerprint) throw new Error("An active immutable context is required.");
  if (active.planId !== sourcePlanId) {
    throw new Error(`Source plan '${sourcePlanId}' is not the active controlled cohort '${active.planId}'.`);
  }
  if (active.criteria.eligibilitySpec?.locationPolicy !== "NCR") {
    throw new Error("Semantic regression preparation requires the active NCR policy.");
  }
  const context = await repos.evaluationContexts.getEvaluationContext(scope, active.contextFingerprint);
  if (!context) throw new Error("The active immutable context cannot be resolved.");

  const [sourceCount, activeRuns, activeJobs, beforeHashes, existing] = await Promise.all([
    db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM search_plan_candidates
       WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ?`,
      [scope.tenantId, scope.personId, sourcePlanId],
    ),
    db.many<{ id: string }>(
      `SELECT id FROM scrape_runs WHERE tenant_id = ? AND person_id = ?
       AND status NOT IN ('completed', 'failed', 'aborted')`,
      [scope.tenantId, scope.personId],
    ),
    db.many<{ id: string }>(
      `SELECT id FROM evaluation_jobs WHERE tenant_id = ? AND person_id = ?
       AND status NOT IN ('completed', 'dead_letter')`,
      [scope.tenantId, scope.personId],
    ),
    candidateHashes(db, scope.personId),
    db.many<{ id: string; status: string }>(
      `SELECT id, status FROM search_plans
       WHERE tenant_id = ? AND person_id = ? AND title = ?`,
      [scope.tenantId, scope.personId, title],
    ),
  ]);
  const actualSourceRecords = Number(sourceCount?.count || 0);
  if (actualSourceRecords !== expectedSourceRecords) {
    throw new Error(`Controlled source count mismatch: expected ${expectedSourceRecords}, found ${actualSourceRecords}.`);
  }
  if (activeRuns.length || activeJobs.length) {
    throw new Error("Preparation requires quiescent scraper and evaluation work.");
  }
  if (existing.length) {
    throw new Error(`A prior '${title}' context exists (${existing.map((row) => `${row.id}:${row.status}`).join(", ")}); refusing to reuse or overwrite it.`);
  }

  const preflight = {
    mode: apply ? "apply" : "dry-run",
    scope: { tenantId: scope.tenantId, personId: scope.personId },
    source: { searchPlanId: sourcePlanId, associations: actualSourceRecords },
    active: { searchPlanId: active.planId, contextFingerprint: active.contextFingerprint, locationPolicy: "NCR" },
    candidateState: beforeHashes,
    successor: { title, status: "paused", activation: "prohibited-by-this-command" },
  };
  if (!apply) {
    console.log(JSON.stringify(preflight, null, 2));
    return;
  }

  const prepared = await repos.evaluationContexts.prepareSearchPlan(scope, {
    title,
    criteria: structuredClone(active.criteria),
    ontologyVersion: context.ontologyVersion,
    ontologyFingerprint: context.ontologyFingerprint,
    policyVersion: context.policyVersion,
    profileVersion: context.profileVersion,
    activatedBy: "controlled-semantic-regression",
  });
  const materialization = await materializeExistingCanonicalPool(scope, prepared, { sourceSearchPlanId: sourcePlanId }, db);
  const [successorRows, materializedRows, successorJobs, activeAfter, afterHashes] = await Promise.all([
    db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM search_plan_candidates
       WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ?`,
      [scope.tenantId, scope.personId, prepared.plan.id],
    ),
    db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM materialized_evaluations
       WHERE tenant_id = ? AND person_id = ? AND evaluation_context_fingerprint = ?`,
      [scope.tenantId, scope.personId, prepared.context.contextFingerprint],
    ),
    db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM evaluation_jobs
       WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ?`,
      [scope.tenantId, scope.personId, prepared.plan.id],
    ),
    repos.evaluationContexts.getActiveSearchPlanWithSnapshot(scope),
    candidateHashes(db, scope.personId),
  ]);
  const successorAssociationCount = Number(successorRows?.count || 0);
  const checks = {
    exactSourceCohort: successorAssociationCount === expectedSourceRecords && materialization.examined === expectedSourceRecords,
    paused: prepared.plan.status === "paused",
    predecessorStillActive: activeAfter.planId === active.planId && activeAfter.contextFingerprint === active.contextFingerprint,
    noEvaluationJobs: Number(successorJobs?.count || 0) === 0,
    candidateStateUnchanged: JSON.stringify(beforeHashes) === JSON.stringify(afterHashes),
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`Prepared successor validation failed: ${JSON.stringify(checks)}. It remains paused and must not be activated.`);
  }
  console.log(JSON.stringify({
    ...preflight,
    result: "prepared-paused-successor",
    successor: {
      ...preflight.successor,
      searchPlanId: prepared.plan.id,
      snapshotId: prepared.snapshot.id,
      contextFingerprint: prepared.context.contextFingerprint,
      associations: successorAssociationCount,
      materializedEvaluations: Number(materializedRows?.count || 0),
      evaluationJobs: Number(successorJobs?.count || 0),
    },
    materialization,
    checks,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
