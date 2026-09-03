/**
 * Read-only baseline for an operational market-corpus reset.
 * It deliberately does not prepare, activate, delete, rematerialize, or scrape.
 */
import crypto from "node:crypto";
import { getDatabaseAdapter } from "../../src/data/database";
import { getRepositories } from "../../src/data/sqlite/provider";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  if (!userId) throw new Error("Usage requires --user-id <authenticated-user-id>.");
  const db = getDatabaseAdapter();
  const { scope } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const active = await getRepositories().evaluationContexts.getActiveSearchPlanWithSnapshot(scope);
  if (!active.contextFingerprint) throw new Error("Active evaluation context is required.");
  if (active.criteria.eligibilitySpec?.locationPolicy !== "NCR") {
    throw new Error("Operational reset is blocked: active geography policy is not NCR.");
  }
  const [candidateCounts, materializedCount, projectionRows, profileRows, activeRuns, activeJobs, migrations] = await Promise.all([
    db.many<{ attention_decision: string; count: number }>(
      `SELECT attention_decision, COUNT(*) AS count FROM search_plan_candidates
       WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ? GROUP BY attention_decision`,
      [scope.tenantId, scope.personId, active.planId]),
    db.one<{ count: number }>(`SELECT COUNT(*) AS count FROM materialized_evaluations WHERE tenant_id = ? AND person_id = ? AND evaluation_context_fingerprint = ?`, [scope.tenantId, scope.personId, active.contextFingerprint]),
    db.many<{ id: string; projection_json: string | null; updated_at: string | null }>(`SELECT id, projection_json, updated_at FROM career_profiles WHERE person_id = ? ORDER BY id`, [scope.personId]),
    db.many<{ id: string; timeline: string; skills: string; claims: string | null }>(`SELECT id, timeline, skills, claims FROM candidate_projection WHERE person_id = ? ORDER BY id`, [scope.personId]),
    db.many<{ id: string; status: string }>(`SELECT id, status FROM scrape_runs WHERE tenant_id = ? AND person_id = ? AND status NOT IN ('completed', 'failed', 'aborted')`, [scope.tenantId, scope.personId]),
    db.many<{ id: string; status: string }>(`SELECT id, status FROM evaluation_jobs WHERE tenant_id = ? AND person_id = ? AND status NOT IN ('completed', 'dead_letter')`, [scope.tenantId, scope.personId]),
    db.many<{ migration_name: string }>(`SELECT migration_name FROM _migrations ORDER BY migration_name`),
  ]);
  const manifest = {
    version: 1, mode: "read-only", generatedAt: new Date().toISOString(),
    scope: { tenantId: scope.tenantId, personId: scope.personId },
    active: { searchPlanId: active.planId, snapshotId: active.snapshotId, contextFingerprint: active.contextFingerprint, locationPolicy: "NCR" },
    serving: { candidateCounts, materializedEvaluations: materializedCount?.count ?? 0 },
    candidateState: { careerProfilesHash: hash(profileRows), candidateProjectionHash: hash(projectionRows) },
    quiescence: { activeRuns, activeEvaluationJobs: activeJobs },
    schema: { migrations },
  };
  if (activeRuns.length || activeJobs.length) throw new Error(`Operational reset is blocked: ${JSON.stringify(manifest)}`);
  console.log(JSON.stringify({ ...manifest, manifestSha256: hash(manifest), result: "preflight-passed" }, null, 2));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
