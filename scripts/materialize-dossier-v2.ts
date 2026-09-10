import { getDatabaseAdapter } from "../src/data/database";
import { resolveExactCandidateProjectionForScope } from "../src/data/sqlite/repositories/profile-projection-version";
import { SqliteDossierPresentationStore } from "../src/data/sqlite/repositories/SqliteDossierPresentationStore";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import {
  buildEvaluatedPresentationV2,
  buildUnavailablePresentationV2,
} from "../src/lib/intelligence/dossier/CanonicalDossierPresentationMaterializer";
import type { CanonicalDossierPresentationV2 } from "../src/lib/domain/dossier_presentation";

function parseArgs() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isDryRun = args.includes("--dry-run") || !isApply;
  const runIdIdx = args.indexOf("--run-id");
  const runId = runIdIdx !== -1 && args[runIdIdx + 1] ? args[runIdIdx + 1] : "run-1788945245759";
  const all = args.includes("--all");
  return { isApply, isDryRun, runId, all };
}

function parseJson(value: unknown): Record<string, any> {
  try {
    return value && typeof value === "object" ? (value as Record<string, any>) : JSON.parse(String(value));
  } catch {
    return {};
  }
}

async function main() {
  const { isApply, isDryRun, runId, all } = parseArgs();
  console.log(`[materialize-dossier-v2] Mode: ${isApply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[materialize-dossier-v2] Target: ${all ? "ALL active candidate cohorts" : `Run ${runId}`}`);

  const db = getDatabaseAdapter();

  const query = all
    ? `SELECT spc.canonical_job_id, spc.tenant_id, spc.person_id, spc.opportunity_version,
              me.evaluation_json, me.decision, me.quality_score, me.evaluation_context_fingerprint,
              me.evaluation_fingerprint, me.evaluation_state,
              ov.raw_content, ov.job_title, ov.company_name
       FROM search_plan_candidates spc
       LEFT JOIN materialized_evaluations me ON me.tenant_id=spc.tenant_id AND me.person_id=spc.person_id
         AND me.canonical_job_id=spc.canonical_job_id AND me.opportunity_version=spc.opportunity_version
       JOIN opportunity_versions ov ON ov.id=spc.opportunity_version
       WHERE spc.attention_decision='CANDIDATE'
       GROUP BY spc.tenant_id, spc.person_id, spc.canonical_job_id, spc.opportunity_version
       ORDER BY lower(ov.company_name), lower(ov.job_title)`
    : `WITH ingested AS (
         SELECT DISTINCT canonical_job_id, opportunity_version, tenant_id, person_id
         FROM acquisition_ingestion_lineage
         WHERE scrape_run_id=? AND canonical_job_id IS NOT NULL AND opportunity_version IS NOT NULL
       )
       SELECT i.canonical_job_id, i.tenant_id, i.person_id, i.opportunity_version,
              me.evaluation_json, me.decision, me.quality_score, me.evaluation_context_fingerprint,
              me.evaluation_fingerprint, me.evaluation_state,
              ov.raw_content, ov.job_title, ov.company_name
       FROM ingested i
       LEFT JOIN materialized_evaluations me ON me.tenant_id=i.tenant_id AND me.person_id=i.person_id
         AND me.canonical_job_id=i.canonical_job_id AND me.opportunity_version=i.opportunity_version
       JOIN opportunity_versions ov ON ov.id=i.opportunity_version
       JOIN search_plan_candidates spc ON spc.tenant_id=i.tenant_id AND spc.person_id=i.person_id
         AND spc.canonical_job_id=i.canonical_job_id AND spc.opportunity_version=i.opportunity_version
       WHERE spc.attention_decision='CANDIDATE'
       GROUP BY i.canonical_job_id, i.opportunity_version
       ORDER BY lower(ov.company_name), lower(ov.job_title)`;

  const rows = await db.many<any>(query, all ? [] : [runId]);
  console.log(`[materialize-dossier-v2] Loaded ${rows.length} cohort candidate records.`);

  const candidateCache = new Map<string, any | null>();
  const presentations: CanonicalDossierPresentationV2[] = [];
  let evaluatedCount = 0;
  let unavailableCount = 0;

  for (const row of rows) {
    const artifact = parseJson(row.evaluation_json);
    const projection = artifact.jobProjection;
    const presentationEvidence = JobProjectionBuilder.extractPresentationEvidenceForPresentation(
      String(row.raw_content ?? ""),
      row.opportunity_version,
      Array.isArray(projection?.capabilities) ? projection.capabilities : [],
    );

    const contextFingerprint =
      row.evaluation_context_fingerprint ||
      artifact.contextFingerprint ||
      "ctx-default";

    const identity = {
      tenantId: row.tenant_id,
      personId: row.person_id,
      canonicalJobId: row.canonical_job_id,
      opportunityVersion: row.opportunity_version,
      evaluationContextFingerprint: contextFingerprint,
    };

    let candidate: any = null;
    if (artifact.profileVersion) {
      const key = `${row.tenant_id}:${row.person_id}:${artifact.profileVersion}`;
      if (!candidateCache.has(key)) {
        const resolved = await resolveExactCandidateProjectionForScope(
          db,
          { tenantId: row.tenant_id, personId: row.person_id },
          artifact.profileVersion,
        );
        candidateCache.set(key, resolved ?? null);
      }
      candidate = candidateCache.get(key);
    }

    const isEvaluated =
      row.evaluation_state === "EVALUATED" ||
      (candidate && (row.decision === "PURSUE" || row.decision === "CONSIDER" || row.decision === "PASS"));

    if (isEvaluated && candidate) {
      const presentation = buildEvaluatedPresentationV2({
        identity,
        artifact,
        candidateProjection: candidate,
        presentationEvidence: {
          roleWorkEvidence: presentationEvidence.evidence,
          presentationQualificationEvidence: presentationEvidence.qualifications,
        },
        evaluationFingerprint: row.evaluation_fingerprint || artifact.evaluationInputHash || "eval-fingerprint",
      });
      presentations.push(presentation);
      evaluatedCount++;
    } else {
      const reasonCode =
        row.decision === "SPARSE_SPEC" || row.evaluation_state === "SPARSE_SPEC"
          ? "SPARSE_SPEC"
          : "NOT_EVALUABLE";
      const presentation = buildUnavailablePresentationV2({
        identity,
        reasonCode,
        presentationEvidence: {
          roleWorkEvidence: presentationEvidence.evidence,
          presentationQualificationEvidence: presentationEvidence.qualifications,
        },
      });
      presentations.push(presentation);
      unavailableCount++;
    }
  }

  console.log(`[materialize-dossier-v2] Prepared ${presentations.length} presentations:`);
  console.log(`  - Evaluated: ${evaluatedCount}`);
  console.log(`  - Unavailable: ${unavailableCount}`);

  if (isDryRun) {
    console.log("[materialize-dossier-v2] Dry-run complete. No changes written to database.");
    return;
  }

  console.log("[materialize-dossier-v2] Writing presentations to materialized_dossier_presentations in transactions...");
  const batchSize = 50;
  for (let i = 0; i < presentations.length; i += batchSize) {
    const batch = presentations.slice(i, i + batchSize);
    await db.transaction(async (tx) => {
      const store = new SqliteDossierPresentationStore(tx);
      for (const presentation of batch) {
        await store.savePresentation(presentation);
      }
    });
    console.log(`  Committed batch ${Math.floor(i / batchSize) + 1} / ${Math.ceil(presentations.length / batchSize)}`);
  }

  console.log("[materialize-dossier-v2] Successfully applied all presentations to database!");
}

main().catch((err) => {
  console.error("[materialize-dossier-v2] Fatal error:", err);
  process.exit(1);
});
