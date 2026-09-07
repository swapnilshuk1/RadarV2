/**
 * Additive local operator tool for legacy v4.3 evaluations.
 * Defaults to dry-run. It never changes evaluation scalar truth or decisions.
 * Usage: RADAR_USER_ID=... RADAR_TENANT_ID=... npx tsx scripts/rematerialize-dossiers.ts
 *        [--refresh-stale] [--apply --canonical-job-id=<id>|--all]
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
import { resolveExactCandidateProjectionForScope } from "@/data/sqlite/repositories/profile-projection-version";
import {
  parseDossierRematerializationOptions,
  presentationsAreSemanticallyEqual,
  reconstructHistoricalOpportunitySource,
  selectsCanonicalJob,
} from "@/lib/intelligence/dossier/rematerialization-support";

const userId = process.env.RADAR_USER_ID;
const tenantId = process.env.RADAR_TENANT_ID;
const options = parseDossierRematerializationOptions(process.argv.slice(2));

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
  const candidateProjection = await resolveExactCandidateProjectionForScope(
    db,
    resolved.scope,
    context.profileVersion,
  );
  if (!candidateProjection) {
    throw new Error("Pinned candidate projection is missing or ambiguous; refusing rematerialization.");
  }

  const rows = await db.many<{
    id: string; canonical_job_id: string; opportunity_version: string; evaluation_fingerprint: string;
    decision: string | null; quality_score: number | null; evaluation_json: string; raw_content: string;
    job_title: string; company_name: string | null; location: string | null;
  }>(`SELECT me.id, me.canonical_job_id, me.opportunity_version, me.evaluation_fingerprint, me.decision, me.quality_score,
             me.evaluation_json, ov.raw_content, ov.job_title, ov.company_name, ov.location
      FROM materialized_evaluations me
      JOIN search_plan_candidates spc ON spc.tenant_id = me.tenant_id AND spc.person_id = me.person_id
        AND spc.canonical_job_id = me.canonical_job_id AND spc.opportunity_version = me.opportunity_version
      JOIN opportunity_versions ov ON ov.id = me.opportunity_version AND ov.canonical_job_id = me.canonical_job_id
      WHERE me.tenant_id = ? AND me.person_id = ? AND me.evaluation_context_fingerprint = ?
        AND spc.search_plan_id = ? AND me.evaluation_state = 'EVALUATED'`,
    [context.tenantId, context.personId, context.contextFingerprint, active.searchPlanId],
  );

  let current = 0;
  let stale = 0;
  let missingOrInvalidReconstructable = 0;
  let canonicalMismatch = 0;
  let unsafe = 0;
  let eligible = 0;
  let updated = 0;
  let casMiss = 0;
  for (const row of rows) {
    let persisted: unknown;
    try { persisted = JSON.parse(row.evaluation_json); } catch { unsafe++; continue; }
    if (!isCanonicalIntrinsicEvaluationV4_3(persisted)
      || persisted.evaluationInputHash !== row.evaluation_fingerprint) {
      canonicalMismatch++;
      continue;
    }
    const validHashBound = isCanonicalDossierPresentationV1(persisted.dossierPresentation)
      && persisted.dossierPresentation.evaluationInputHash === persisted.evaluationInputHash;
    // Preserve legacy default behavior: valid hash-bound dossiers are not touched
    // unless an operator explicitly asks to compare their semantics.
    if (validHashBound && !options.refreshStale) continue;

    let source: OpportunitySource;
    try {
      source = reconstructHistoricalOpportunitySource({
        canonicalJobId: row.canonical_job_id,
        rawContent: row.raw_content,
        jobTitle: row.job_title,
        companyName: row.company_name,
        location: row.location,
      });
    } catch { unsafe++; continue; }
    const artifact = runEngineSingleIntrinsic(source.jobHash, candidateProjection, 0, [source]);
    if (!artifact) { unsafe++; continue; }
    const reconstructed = buildCanonicalEvaluatedPayload(artifact, context, row.canonical_job_id, row.opportunity_version, persisted.evaluatedAt);
    // Never rewrite an evaluation if reconstruction would alter canonical truth.
    if (reconstructed.decision !== row.decision || reconstructed.score !== row.quality_score || reconstructed.evaluationInputHash !== row.evaluation_fingerprint) {
      canonicalMismatch++; continue;
    }
    const dossierPresentation = buildCanonicalDossierPresentation(
      artifact, candidateProjection, persisted.evaluationInputHash, new Date().toISOString(), persisted.evaluatedAt,
    );
    const classification = validHashBound
      ? (presentationsAreSemanticallyEqual(persisted.dossierPresentation, dossierPresentation) ? "CURRENT" : "STALE")
      : "MISSING_OR_INVALID_RECONSTRUCTABLE";
    if (classification === "CURRENT") { current++; continue; }
    if (classification === "STALE") stale++;
    else missingOrInvalidReconstructable++;

    // Stale rows require an explicit selector only for an apply. Dry-runs remain
    // useful for seeing the complete stale population without granting write scope.
    const selectedForWrite = classification !== "STALE"
      || !options.apply
      || selectsCanonicalJob(options.selector, row.canonical_job_id);
    if (!selectedForWrite) continue;
    eligible++;
    if (options.apply) {
      const write = await db.execute(
        `UPDATE materialized_evaluations SET evaluation_json = ?
         WHERE id = ? AND tenant_id = ? AND person_id = ? AND evaluation_fingerprint = ?
           AND decision IS ? AND quality_score IS ? AND evaluation_state = 'EVALUATED' AND evaluation_json = ?`,
        [JSON.stringify({ ...persisted, dossierPresentation }), row.id, context.tenantId, context.personId,
          row.evaluation_fingerprint, row.decision, row.quality_score, row.evaluation_json],
      );
      if (write.rowsAffected === 1) updated++;
      else casMiss++;
    }
  }
  console.log(JSON.stringify({
    mode: options.apply ? "apply" : "dry-run",
    refreshStale: options.refreshStale,
    selector: options.selector?.kind === "all" ? "all" : options.selector?.canonicalJobId ?? null,
    activeContext: active,
    examined: rows.length,
    current,
    stale,
    missingOrInvalidReconstructable,
    canonicalMismatch,
    unsafe,
    eligible,
    updated,
    casMiss,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
