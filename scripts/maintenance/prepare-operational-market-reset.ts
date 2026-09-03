/** Prepare, but never activate, an empty operational market-corpus successor. */
import crypto from "node:crypto";
import { getDatabaseAdapter } from "../../src/data/database";
import { getRepositories } from "../../src/data/sqlite/provider";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";

function argument(name: string): string | undefined { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; }
function hash(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function candidateHashes(db: ReturnType<typeof getDatabaseAdapter>, personId: string) {
  const [profiles, projections] = await Promise.all([
    db.many(`SELECT id, projection_json, updated_at FROM career_profiles WHERE person_id = ? ORDER BY id`, [personId]),
    db.many(`SELECT id, timeline, skills, claims FROM candidate_projection WHERE person_id = ? ORDER BY id`, [personId]),
  ]);
  return { careerProfilesHash: hash(profiles), candidateProjectionHash: hash(projections) };
}

async function main(): Promise<void> {
  const userId = argument("--user-id"), tenantId = argument("--tenant-id"), manifestHash = argument("--manifest-sha256");
  const expectedProfileHash = argument("--career-profiles-sha256"), expectedProjectionHash = argument("--candidate-projection-sha256");
  const apply = process.argv.includes("--apply");
  if (!userId || !manifestHash || !expectedProfileHash || !expectedProjectionHash) throw new Error("Usage requires --user-id, --manifest-sha256, --career-profiles-sha256, and --candidate-projection-sha256.");
  const db = getDatabaseAdapter();
  const { scope } = await resolveScraperAuthContext(userId, tenantId, db);
  const repos = getRepositories();
  const active = await repos.evaluationContexts.getActiveSearchPlanWithSnapshot(scope);
  if (!active.contextFingerprint || active.criteria.eligibilitySpec?.locationPolicy !== "NCR") throw new Error("Preparation requires the preflight's NCR active context.");
  const [runs, jobs] = await Promise.all([
    db.many(`SELECT id FROM scrape_runs WHERE tenant_id=? AND person_id=? AND status NOT IN ('completed','failed','aborted')`, [scope.tenantId, scope.personId]),
    db.many(`SELECT id FROM evaluation_jobs WHERE tenant_id=? AND person_id=? AND status NOT IN ('completed','dead_letter')`, [scope.tenantId, scope.personId]),
  ]);
  if (runs.length || jobs.length) throw new Error("Preparation requires quiescent acquisition and evaluation work.");
  const before = await candidateHashes(db, scope.personId);
  const expected = { careerProfilesHash: expectedProfileHash, candidateProjectionHash: expectedProjectionHash };
  if (!/^[a-f0-9]{64}$/.test(manifestHash) || JSON.stringify(before) !== JSON.stringify(expected)) throw new Error("Preparation is blocked: authoritative preflight baseline no longer matches.");
  if (!apply) { console.log(JSON.stringify({ mode: "dry-run", scope, active: { planId: active.planId, contextFingerprint: active.contextFingerprint }, candidateState: before, successor: "paused and empty" }, null, 2)); return; }
  const context = await repos.evaluationContexts.getEvaluationContext(scope, active.contextFingerprint);
  if (!context) throw new Error("Active immutable context cannot be resolved.");
  const prepared = await repos.evaluationContexts.prepareSearchPlan(scope, { title: `${active.title} — operational reset successor`, criteria: structuredClone(active.criteria), ontologyVersion: context.ontologyVersion, ontologyFingerprint: context.ontologyFingerprint, policyVersion: context.policyVersion, profileVersion: context.profileVersion, activatedBy: "operational-market-reset" });
  const [candidates, materializations, evaluations, after] = await Promise.all([
    db.one<{ count: number }>(`SELECT COUNT(*) AS count FROM search_plan_candidates WHERE tenant_id=? AND person_id=? AND search_plan_id=?`, [scope.tenantId, scope.personId, prepared.plan.id]),
    db.one<{ count: number }>(`SELECT COUNT(*) AS count FROM materialized_evaluations WHERE tenant_id=? AND person_id=? AND evaluation_context_fingerprint=?`, [scope.tenantId, scope.personId, prepared.context.contextFingerprint]),
    db.one<{ count: number }>(`SELECT COUNT(*) AS count FROM evaluation_jobs WHERE tenant_id=? AND person_id=? AND search_plan_id=?`, [scope.tenantId, scope.personId, prepared.plan.id]),
    candidateHashes(db, scope.personId),
  ]);
  if ((candidates?.count ?? 0) || (materializations?.count ?? 0) || (evaluations?.count ?? 0) || JSON.stringify(after) !== JSON.stringify(before)) throw new Error("Prepared successor validation failed; it remains paused and must not be activated.");
  console.log(JSON.stringify({ result: "prepared-empty-successor", predecessor: { planId: active.planId, contextFingerprint: active.contextFingerprint }, successor: { planId: prepared.plan.id, snapshotId: prepared.snapshot.id, contextFingerprint: prepared.context.contextFingerprint, status: prepared.plan.status }, market: { candidates: 0, materializations: 0, evaluations: 0 }, candidateState: after }, null, 2));
}
main().catch((e: unknown) => { console.error(e); process.exitCode = 1; });
