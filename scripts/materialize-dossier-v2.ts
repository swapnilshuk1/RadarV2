import { getDatabaseAdapter } from "../src/data/database";
import { resolveExactCandidateProjectionForScope } from "../src/data/sqlite/repositories/profile-projection-version";
import { SqliteDossierPresentationStore } from "../src/data/sqlite/repositories/SqliteDossierPresentationStore";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import {
  buildEvaluatedPresentationV2,
  buildUnavailablePresentationV2,
} from "../src/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer";
import { isCanonicalDossierPresentationV2, type CanonicalDossierPresentationV2 } from "../src/lib/domain/dossier_presentation";
import type { CandidateProjection } from "../src/lib/domain/candidate_projection";
import { isCanonicalIntrinsicEvaluationV4_3, isCanonicalUnavailablePayload, type CanonicalEvaluatedPayloadV4_3 } from "../src/lib/domain/evaluation_payloads";
import { computeEvaluationIdentity } from "../src/lib/domain/evaluation_fingerprint";
import type { EvaluationArtifact } from "../src/lib/intelligence/engine";

type MaterializationReason =
  | "EVALUATED_BUILDABLE"
  | "SOURCE_ONLY_BUILDABLE"
  | "INVALID_CANONICAL_ARTIFACT"
  | "EVALUATION_IDENTITY_MISMATCH"
  | "EVALUATION_FINGERPRINT_MISMATCH"
  | "MISSING_PINNED_PROFILE"
  | "UNTRUSTED_SOURCE"
  | "INACTIVE_VERSION"
  | "UNSUPPORTED_UNAVAILABLE_STATE"
  | "MISSING_EVALUATION"
  | "INVALID_UNAVAILABLE_ARTIFACT"
  | "UNAVAILABLE_IDENTITY_MISMATCH"
  | "UNAVAILABLE_STATE_MISMATCH"
  | "EVALUATED_RELATIONAL_MISMATCH";

interface CohortRow {
  canonical_job_id: string;
  tenant_id: string;
  person_id: string;
  search_plan_id: string;
  opportunity_version: string;
  active_context_fingerprint: string;
  evaluation_json: string | null;
  evaluation_fingerprint: string | null;
  evaluation_state: string | null;
  decision: string | null;
  quality_score: number | null;
  raw_content: string | null;
  job_title: string | null;
  company_name: string | null;
  lifecycle_state: string | null;
  acquisition_status: string | null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isDryRun = args.includes("--dry-run") || !isApply;
  const runIdIdx = args.indexOf("--run-id");
  const runId = runIdIdx !== -1 && args[runIdIdx + 1] ? args[runIdIdx + 1] : "run-1788945245759";
  return { isApply, isDryRun, runId, all: args.includes("--all"), repairInvalidV2: args.includes("--repair-invalid-v2") };
}

function parseJsonStrict(value: string | null): unknown | null {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function isSourceOnlyState(value: string | null): value is "SPARSE_SPEC" | "NOT_EVALUABLE" {
  return value === "SPARSE_SPEC" || value === "NOT_EVALUABLE";
}

function addReason(histogram: Map<MaterializationReason, number>, reason: MaterializationReason) {
  histogram.set(reason, (histogram.get(reason) ?? 0) + 1);
}

function trustedSource(row: CohortRow): boolean {
  return row.acquisition_status === "ACQUIRED"
    && row.lifecycle_state === "ACTIVE"
    && Boolean(row.raw_content?.trim());
}

function evaluatedArtifactFailure(row: CohortRow, artifact: unknown): MaterializationReason | null {
  if (!isCanonicalIntrinsicEvaluationV4_3(artifact)) return "INVALID_CANONICAL_ARTIFACT";
  if (
    artifact.tenantId !== row.tenant_id ||
    artifact.personId !== row.person_id ||
    artifact.canonicalJobId !== row.canonical_job_id ||
    artifact.opportunityVersion !== row.opportunity_version ||
    artifact.contextFingerprint !== row.active_context_fingerprint
  ) return "EVALUATION_IDENTITY_MISMATCH";
  if (!row.evaluation_fingerprint || artifact.evaluationInputHash !== row.evaluation_fingerprint) {
    return "EVALUATION_FINGERPRINT_MISMATCH";
  }
  if (row.evaluation_state !== "EVALUATED" || row.decision !== artifact.decision || row.quality_score !== artifact.score) return "EVALUATED_RELATIONAL_MISMATCH";
  return null;
}

function unavailableArtifactFailure(row: CohortRow, artifact: unknown): MaterializationReason | null {
  if (!isCanonicalUnavailablePayload(artifact)) return "INVALID_UNAVAILABLE_ARTIFACT";
  if (artifact.tenantId !== row.tenant_id || artifact.personId !== row.person_id || artifact.canonicalJobId !== row.canonical_job_id
    || artifact.opportunityVersion !== row.opportunity_version || artifact.contextFingerprint !== row.active_context_fingerprint) return "UNAVAILABLE_IDENTITY_MISMATCH";
  if (!isSourceOnlyState(row.evaluation_state) || artifact.evaluationState !== row.evaluation_state || artifact.reasonCode !== row.evaluation_state) return "UNAVAILABLE_STATE_MISMATCH";
  const expected = computeEvaluationIdentity(row.canonical_job_id, row.opportunity_version, row.active_context_fingerprint).idempotencyKey;
  return artifact.evaluationInputHash === expected ? null : "UNAVAILABLE_IDENTITY_MISMATCH";
}

/**
 * The persisted intrinsic payload intentionally has no legacy `record` object.
 * This adapter restores that narrow in-memory shape from the payload's own
 * canonical decision and score fields; it never reads relational scalars or
 * presentation aliases.
 */
function presentationArtifact(payload: CanonicalEvaluatedPayloadV4_3): EvaluationArtifact {
  return {
    ...payload,
    record: {
      verb: payload.decision,
      qualityScore: payload.score,
      jobHash: payload.jobHash,
      diligenceStatus: payload.diligenceStatus,
    },
    jobProjection: payload.jobProjection,
    decisionTrace: payload.decisionTrace,
  } as unknown as EvaluationArtifact;
}

async function main() {
  const { isApply, isDryRun, runId, all, repairInvalidV2 } = parseArgs();
  console.log(`[materialize-dossier-v2] Mode: ${isApply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[materialize-dossier-v2] Target: ${all ? "ALL active candidate cohorts" : `Run ${runId}`}`);
  const db = getDatabaseAdapter();

  const activeScopeJoin = `
    JOIN active_evaluation_contexts aec
      ON aec.tenant_id = spc.tenant_id
     AND aec.person_id = spc.person_id
     AND aec.search_plan_id = spc.search_plan_id`;
  const evaluationJoin = `
    LEFT JOIN materialized_evaluations me
      ON me.tenant_id = spc.tenant_id
     AND me.person_id = spc.person_id
     AND me.canonical_job_id = spc.canonical_job_id
     AND me.opportunity_version = spc.opportunity_version
     AND me.evaluation_context_fingerprint = aec.context_fingerprint`;
  const selectedColumns = `
    spc.canonical_job_id, spc.tenant_id, spc.person_id, spc.search_plan_id,
    spc.opportunity_version, aec.context_fingerprint AS active_context_fingerprint,
    me.evaluation_json, me.evaluation_fingerprint, me.evaluation_state, me.decision, me.quality_score,
    ov.raw_content, ov.job_title, ov.company_name, ov.lifecycle_state, ov.acquisition_status`;
  const query = all
    ? `SELECT ${selectedColumns}
       FROM search_plan_candidates spc ${activeScopeJoin} ${evaluationJoin}
       JOIN opportunity_versions ov ON ov.id = spc.opportunity_version
       WHERE spc.attention_decision = 'CANDIDATE'
       ORDER BY lower(ov.company_name), lower(ov.job_title), spc.tenant_id, spc.person_id, spc.search_plan_id`
    : `WITH ingested AS (
         SELECT DISTINCT canonical_job_id, opportunity_version, tenant_id, person_id
         FROM acquisition_ingestion_lineage
         WHERE scrape_run_id = ? AND canonical_job_id IS NOT NULL AND opportunity_version IS NOT NULL
       )
       SELECT ${selectedColumns}
       FROM ingested i
       JOIN search_plan_candidates spc
         ON spc.tenant_id = i.tenant_id AND spc.person_id = i.person_id
        AND spc.canonical_job_id = i.canonical_job_id AND spc.opportunity_version = i.opportunity_version
       ${activeScopeJoin} ${evaluationJoin}
       JOIN opportunity_versions ov ON ov.id = spc.opportunity_version
       WHERE spc.attention_decision = 'CANDIDATE'
       ORDER BY lower(ov.company_name), lower(ov.job_title), spc.tenant_id, spc.person_id, spc.search_plan_id`;
  const rows = await db.many<CohortRow>(query, all ? [] : [runId]);
  console.log(`[materialize-dossier-v2] Loaded ${rows.length} active-context cohort records.`);
  const persisted = await db.many<{
    tenant_id: string; person_id: string; canonical_job_id: string; opportunity_version: string;
    evaluation_context_fingerprint: string; presentation_json: string;
  }>(`SELECT tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, presentation_json
      FROM materialized_dossier_presentations WHERE presentation_version = 'dossier-v2'`);
  const presentationKey = (row: { tenant_id: string; person_id: string; canonical_job_id: string; opportunity_version: string; evaluation_context_fingerprint: string }) =>
    [row.tenant_id, row.person_id, row.canonical_job_id, row.opportunity_version, row.evaluation_context_fingerprint].join(":");
  const invalidPersistedKeys = new Set(persisted.flatMap((row) => {
    const parsed = parseJsonStrict(row.presentation_json);
    return isCanonicalDossierPresentationV2(parsed) ? [] : [presentationKey(row)];
  }));
  if (repairInvalidV2 && invalidPersistedKeys.size !== 56) {
    throw new Error(`[materialize-dossier-v2] Guarded repair requires exactly 56 invalid persisted V2 rows; found ${invalidPersistedKeys.size}.`);
  }

  const candidateCache = new Map<string, CandidateProjection | null>();
  const presentations: CanonicalDossierPresentationV2[] = [];
  const reasons = new Map<MaterializationReason, number>();
  const failures: Array<{ reason: MaterializationReason; canonicalJobId: string; opportunityVersion: string }> = [];
  const fail = (row: CohortRow, reason: MaterializationReason) => {
    addReason(reasons, reason);
    failures.push({ reason, canonicalJobId: row.canonical_job_id, opportunityVersion: row.opportunity_version });
  };

  for (const row of rows) {
    if (row.lifecycle_state !== "ACTIVE") { fail(row, "INACTIVE_VERSION"); continue; }
    if (!trustedSource(row)) { fail(row, "UNTRUSTED_SOURCE"); continue; }
    const artifact = parseJsonStrict(row.evaluation_json);
    const identity = {
      tenantId: row.tenant_id,
      personId: row.person_id,
      canonicalJobId: row.canonical_job_id,
      opportunityVersion: row.opportunity_version,
      evaluationContextFingerprint: row.active_context_fingerprint,
    };

    // The immutable v4.3 evaluated artifact, rather than a mutable
    // materialized scalar, is the only authority for an evaluated V2 dossier.
    if (isCanonicalIntrinsicEvaluationV4_3(artifact)) {
      const failure = evaluatedArtifactFailure(row, artifact);
      if (failure) { fail(row, failure); continue; }
      const canonicalArtifact = artifact;
      const candidateKey = `${row.tenant_id}:${row.person_id}:${canonicalArtifact.profileVersion}`;
      if (!candidateCache.has(candidateKey)) {
        candidateCache.set(candidateKey, await resolveExactCandidateProjectionForScope(
          db, { tenantId: row.tenant_id, personId: row.person_id }, canonicalArtifact.profileVersion,
        ));
      }
      const candidate = candidateCache.get(candidateKey);
      if (!candidate) { fail(row, "MISSING_PINNED_PROFILE"); continue; }
      const presentationEvidence = JobProjectionBuilder.extractPresentationEvidenceForPresentation(
        row.raw_content!, row.opportunity_version,
        Array.isArray(canonicalArtifact.jobProjection.capabilities) ? canonicalArtifact.jobProjection.capabilities : [],
      );
      presentations.push(buildEvaluatedPresentationV2({
        identity, artifact: presentationArtifact(canonicalArtifact), candidateProjection: candidate,
        presentationEvidence: {
          roleWorkEvidence: presentationEvidence.evidence,
          presentationQualificationEvidence: presentationEvidence.qualifications,
        },
        evaluationFingerprint: row.evaluation_fingerprint,
      }));
      addReason(reasons, "EVALUATED_BUILDABLE");
      continue;
    }

    const unavailableFailure = unavailableArtifactFailure(row, artifact);
    if (unavailableFailure) {
      fail(row, unavailableFailure);
      continue;
    }
    if (!isSourceOnlyState(row.evaluation_state)) {
      fail(row, row.evaluation_json ? "INVALID_CANONICAL_ARTIFACT" : row.evaluation_state ? "UNSUPPORTED_UNAVAILABLE_STATE" : "MISSING_EVALUATION");
      continue;
    }
    const presentationEvidence = JobProjectionBuilder.extractPresentationEvidenceForPresentation(
      row.raw_content!, row.opportunity_version, [],
    );
    presentations.push(buildUnavailablePresentationV2({
      identity, reasonCode: row.evaluation_state,
      presentationEvidence: {
        roleWorkEvidence: presentationEvidence.evidence,
        presentationQualificationEvidence: presentationEvidence.qualifications,
      },
    }));
    addReason(reasons, "SOURCE_ONLY_BUILDABLE");
  }

  console.log(`[materialize-dossier-v2] Prepared ${presentations.length} presentations.`);
  console.log("[materialize-dossier-v2] Reason histogram:");
  for (const reason of [
    "EVALUATED_BUILDABLE", "SOURCE_ONLY_BUILDABLE", "INVALID_CANONICAL_ARTIFACT",
    "EVALUATION_IDENTITY_MISMATCH", "EVALUATION_FINGERPRINT_MISMATCH", "MISSING_PINNED_PROFILE",
    "UNTRUSTED_SOURCE", "INACTIVE_VERSION", "UNSUPPORTED_UNAVAILABLE_STATE", "MISSING_EVALUATION",
    "INVALID_UNAVAILABLE_ARTIFACT", "UNAVAILABLE_IDENTITY_MISMATCH", "UNAVAILABLE_STATE_MISMATCH", "EVALUATED_RELATIONAL_MISMATCH",
  ] as const) console.log(`  - ${reason}: ${reasons.get(reason) ?? 0}`);
  if (failures.length > 0) {
    console.log(`[materialize-dossier-v2] Failures: ${failures.length}`);
    for (const failure of failures.slice(0, 25)) {
      console.log(`  - ${failure.reason}: ${failure.canonicalJobId} / ${failure.opportunityVersion}`);
    }
  }
  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  const repairPresentations = repairInvalidV2
    ? presentations.filter((presentation) => invalidPersistedKeys.has(presentationKey({
      tenant_id: presentation.identity.tenantId, person_id: presentation.identity.personId,
      canonical_job_id: presentation.identity.canonicalJobId, opportunity_version: presentation.identity.opportunityVersion,
      evaluation_context_fingerprint: presentation.identity.evaluationContextFingerprint,
    })))
    : presentations;
  if (repairInvalidV2) {
    if (repairPresentations.length !== 56 || repairPresentations.some((presentation) => presentation.evaluation.state !== "EVALUATED")) {
      throw new Error(`[materialize-dossier-v2] Guarded repair set is not exactly 56 evaluated presentations.`);
    }
    console.log(`[materialize-dossier-v2] Guarded repair set: ${repairPresentations.length} evaluated stale V2 presentations.`);
  }
  if (isDryRun) {
    console.log("[materialize-dossier-v2] Dry-run complete. No changes written to database.");
    return;
  }
  const batchSize = 50;
  for (let i = 0; i < repairPresentations.length; i += batchSize) {
    const batch = repairPresentations.slice(i, i + batchSize);
    await db.transaction(async (tx) => {
      const store = new SqliteDossierPresentationStore(tx);
      for (const presentation of batch) await store.savePresentation(presentation);
    });
    console.log(`  Committed batch ${Math.floor(i / batchSize) + 1} / ${Math.ceil(repairPresentations.length / batchSize)}`);
  }
  console.log("[materialize-dossier-v2] Successfully applied all buildable presentations.");
}

main().catch((err) => {
  console.error("[materialize-dossier-v2] Fatal error:", err);
  process.exit(1);
});
