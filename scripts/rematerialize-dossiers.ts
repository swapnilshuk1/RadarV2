/**
 * Additive local operator tool for legacy v4.3 evaluations.
 * Defaults to dry-run. It never changes evaluation scalar truth or decisions.
 * Usage: RADAR_USER_ID=... RADAR_TENANT_ID=... npx tsx scripts/rematerialize-dossiers.ts [--apply]
 */
import { getDatabaseAdapter } from "@/data/database";
import { resolveServingScope } from "@/lib/security/scope-resolver";
import { runEngineSingleIntrinsic } from "@/lib/intelligence/engine";
import { buildCanonicalEvaluatedPayload } from "@/lib/intelligence/evaluation/PayloadMapper";
import { buildCanonicalDossierPresentation } from "@/lib/intelligence/dossier/CanonicalDossierBuilder";
import { isCanonicalIntrinsicEvaluationV4_3 } from "@/lib/domain/evaluation_payloads";
import { isCanonicalDossierPresentationV1 } from "@/lib/domain/dossier_presentation";
import type { EvaluationContext } from "@/lib/domain/evaluation_context";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

const userId = process.env.RADAR_USER_ID;
const tenantId = process.env.RADAR_TENANT_ID;
const apply = process.argv.includes("--apply");

if (!userId || !tenantId) {
  throw new Error("RADAR_USER_ID and RADAR_TENANT_ID are required; default mode is dry-run.");
}

async function main() {
  const db = getDatabaseAdapter();
  const resolved = await resolveServingScope(userId!, tenantId!, db);
  const active = resolved.activeContext;
  if (!active) throw new Error("No explicit active evaluation context; refusing rematerialization.");

  const contextRow = await db.one<{
    search_plan_snapshot_id: string; ontology_version: string; ontology_fingerprint: string;
    policy_version: string; profile_version: string; created_at: string;
  }>(`SELECT search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      FROM evaluation_contexts WHERE context_fingerprint = ? AND tenant_id = ? AND person_id = ?`,
    [active.contextFingerprint, resolved.scope.tenantId, resolved.scope.personId]);
  if (!contextRow) throw new Error("Active context row is missing; refusing rematerialization.");
  const context: EvaluationContext = {
    contextFingerprint: active.contextFingerprint, tenantId: resolved.scope.tenantId, personId: resolved.scope.personId,
    searchPlanSnapshotId: contextRow.search_plan_snapshot_id, ontologyVersion: contextRow.ontology_version,
    ontologyFingerprint: contextRow.ontology_fingerprint, policyVersion: contextRow.policy_version,
    profileVersion: contextRow.profile_version, createdAt: contextRow.created_at,
  };
  const profile = await db.one<{ projection_json: string }>(
    `SELECT projection_json FROM career_profiles WHERE person_id = ? AND json_extract(projection_json, '$.profileVersion') = ? LIMIT 1`,
    [context.personId, context.profileVersion],
  );
  if (!profile) throw new Error("Pinned candidate projection is missing; refusing rematerialization.");
  const candidateProjection = JSON.parse(profile.projection_json);

  const rows = await db.many<{
    id: string; canonical_job_id: string; opportunity_version: string; evaluation_fingerprint: string;
    decision: string | null; quality_score: number | null; evaluation_json: string; raw_content: string;
  }>(`SELECT me.id, me.canonical_job_id, me.opportunity_version, me.evaluation_fingerprint, me.decision, me.quality_score,
             me.evaluation_json, ov.raw_content
      FROM materialized_evaluations me
      JOIN search_plan_candidates spc ON spc.canonical_job_id = me.canonical_job_id AND spc.opportunity_version = me.opportunity_version
      JOIN opportunity_versions ov ON ov.id = me.opportunity_version
      WHERE me.tenant_id = ? AND me.person_id = ? AND me.evaluation_context_fingerprint = ?
        AND spc.search_plan_id = ? AND me.evaluation_state = 'EVALUATED'`,
    [context.tenantId, context.personId, context.contextFingerprint, active.searchPlanId],
  );

  let skipped = 0; let eligible = 0; let updated = 0;
  for (const row of rows) {
    let persisted: unknown;
    try { persisted = JSON.parse(row.evaluation_json); } catch { skipped++; continue; }
    if (!isCanonicalIntrinsicEvaluationV4_3(persisted)) { skipped++; continue; }
    if (isCanonicalDossierPresentationV1(persisted.dossierPresentation)) continue;
    let source: OpportunitySource;
    try { source = JSON.parse(row.raw_content) as OpportunitySource; } catch { skipped++; continue; }
    source.jobHash ||= persisted.jobHash;
    const artifact = runEngineSingleIntrinsic(source.jobHash, candidateProjection, 0, [source]);
    if (!artifact) { skipped++; continue; }
    const reconstructed = buildCanonicalEvaluatedPayload(artifact, context, row.canonical_job_id, row.opportunity_version, persisted.evaluatedAt);
    // Never rewrite an evaluation if reconstruction would alter canonical truth.
    if (reconstructed.decision !== row.decision || reconstructed.score !== row.quality_score || reconstructed.evaluationInputHash !== row.evaluation_fingerprint) {
      skipped++; continue;
    }
    eligible++;
    if (apply) {
      const dossierPresentation = buildCanonicalDossierPresentation(artifact, candidateProjection, persisted.evaluationInputHash, persisted.evaluatedAt);
      await db.execute(
        `UPDATE materialized_evaluations SET evaluation_json = ?
         WHERE id = ? AND tenant_id = ? AND person_id = ? AND evaluation_fingerprint = ?
           AND decision = ? AND quality_score = ? AND evaluation_state = 'EVALUATED'`,
        [JSON.stringify({ ...persisted, dossierPresentation }), row.id, context.tenantId, context.personId,
          row.evaluation_fingerprint, row.decision, row.quality_score],
      );
      updated++;
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", activeContext: active, examined: rows.length, eligible, updated, skipped }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
