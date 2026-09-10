/**
 * Phase 3A — canonical evaluation rebaseline.
 *
 * Re-evaluates a fixed acquisition cohort against its active canonical
 * context, persists evaluator-produced decision traces, and never generates
 * a dossier presentation. It defaults to a read-only preflight.
 *
 * Usage:
 *   npx tsx scripts/rebaseline-canonical-evaluations.ts --run=<scrape-run-id>
 *   npx tsx scripts/rebaseline-canonical-evaluations.ts --run=<scrape-run-id> --apply --confirm-run=<scrape-run-id>
 */
import fs from "node:fs";
import path from "node:path";
import { getDatabaseAdapter, getDatabaseTargetIdentity } from "@/data/database";
import { resolveExactCandidateProjectionForScope } from "@/data/sqlite/repositories/profile-projection-version";
import { SqliteMaterializedEvaluationStore } from "@/data/sqlite/repositories/SqliteMaterializedEvaluationStore";
import type { EvaluationContext, MaterializedEvaluation } from "@/lib/domain/evaluation_context";
import {
  buildCanonicalEvaluatedPayload,
  buildCanonicalUnavailablePayload,
  materializeCanonicalPayload,
  resolveArtifactEvaluationState,
} from "@/lib/intelligence/evaluation/PayloadMapper";
import { runEngineSingleIntrinsic } from "@/lib/intelligence/engine";
import { JobProjectionBuilder } from "@/lib/intelligence/builders/JobProjectionBuilder";
import { reconstructHistoricalOpportunitySource } from "@/lib/intelligence/dossier/rematerialization-support";
import type { CanonicalEvaluatedPayloadV4_3 } from "@/lib/domain/evaluation_payloads";

type CohortRow = {
  canonical_job_id: string;
  opportunity_version: string;
  tenant_id: string;
  person_id: string;
  raw_content: string;
  job_title: string;
  company_name: string | null;
  location: string | null;
};

type ContextRow = {
  context_fingerprint: string;
  search_plan_snapshot_id: string;
  ontology_version: string;
  ontology_fingerprint: string;
  policy_version: string;
  profile_version: string;
  created_at: string;
};

type ExistingEvaluation = {
  decision: string | null;
  quality_score: number | null;
  evaluation_fingerprint: string | null;
  evaluation_json: string;
};

const argument = (name: string): string | undefined =>
  process.argv.slice(2).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1)?.trim();
const runId = argument("--run");
const apply = process.argv.includes("--apply");
const confirmation = argument("--confirm-run");

if (!runId) throw new Error("--run=<scrape-run-id> is required.");
if (apply && confirmation !== runId) {
  throw new Error("Writes require --apply --confirm-run=<the exact --run value>.");
}

function parse(value: unknown): Record<string, unknown> {
  try { return value && typeof value === "object" ? value as Record<string, unknown> : JSON.parse(String(value)); }
  catch { return {}; }
}

function contextFrom(row: ContextRow, tenantId: string, personId: string): EvaluationContext {
  return {
    contextFingerprint: row.context_fingerprint,
    tenantId,
    personId,
    searchPlanSnapshotId: row.search_plan_snapshot_id,
    ontologyVersion: row.ontology_version,
    ontologyFingerprint: row.ontology_fingerprint,
    policyVersion: row.policy_version,
    profileVersion: row.profile_version,
    createdAt: row.created_at,
  };
}

function preservedLegacyPresentation(
  previous: ExistingEvaluation | null,
  payload: CanonicalEvaluatedPayloadV4_3,
): CanonicalEvaluatedPayloadV4_3 {
  const old = previous ? parse(previous.evaluation_json) : {};
  // This tool intentionally never composes or mutates a dossier presentation.
  // Preserve a valid legacy blob byte-for-byte until the reviewed Phase 3
  // presentation migration decides how it should be rematerialized.
  return old.dossierPresentation && typeof old.dossierPresentation === "object"
    ? { ...payload, dossierPresentation: old.dossierPresentation as CanonicalEvaluatedPayloadV4_3["dossierPresentation"] }
    : payload;
}

async function activeContextFor(row: CohortRow): Promise<ContextRow | null> {
  const db = getDatabaseAdapter();
  return db.one<ContextRow>(
    `SELECT ec.context_fingerprint, ec.search_plan_snapshot_id, ec.ontology_version,
            ec.ontology_fingerprint, ec.policy_version, ec.profile_version, ec.created_at
       FROM search_plan_candidates spc
       JOIN active_evaluation_contexts aec
         ON aec.tenant_id = spc.tenant_id
        AND aec.person_id = spc.person_id
        AND aec.search_plan_id = spc.search_plan_id
       JOIN evaluation_contexts ec
         ON ec.context_fingerprint = aec.context_fingerprint
        AND ec.tenant_id = aec.tenant_id
        AND ec.person_id = aec.person_id
      WHERE spc.tenant_id = ? AND spc.person_id = ?
        AND spc.canonical_job_id = ? AND spc.opportunity_version = ?
      ORDER BY aec.activated_at DESC
      LIMIT 1`,
    [row.tenant_id, row.person_id, row.canonical_job_id, row.opportunity_version],
  );
}

async function existingEvaluationFor(row: CohortRow, contextFingerprint: string): Promise<ExistingEvaluation | null> {
  const db = getDatabaseAdapter();
  return db.one<ExistingEvaluation>(
    `SELECT decision, quality_score, evaluation_fingerprint, evaluation_json
       FROM materialized_evaluations
      WHERE tenant_id = ? AND person_id = ? AND canonical_job_id = ?
        AND opportunity_version = ? AND evaluation_context_fingerprint = ?`,
    [row.tenant_id, row.person_id, row.canonical_job_id, row.opportunity_version, contextFingerprint],
  );
}

async function main() {
  const db = getDatabaseAdapter();
  const target = getDatabaseTargetIdentity();
  if (target.engine !== "turso") throw new Error(`Refusing rebaseline against ${target.engine}; an explicitly configured Turso target is required.`);

  const cohort = await db.many<CohortRow>(
    `WITH ingested AS (
       SELECT DISTINCT canonical_job_id, opportunity_version, tenant_id, person_id
       FROM acquisition_ingestion_lineage
       WHERE scrape_run_id = ?
         AND canonical_job_id IS NOT NULL
         AND opportunity_version IS NOT NULL
     )
     SELECT i.canonical_job_id, i.opportunity_version, i.tenant_id, i.person_id,
            ov.raw_content, ov.job_title, ov.company_name, ov.location
       FROM ingested i
       JOIN search_plan_candidates spc
         ON spc.tenant_id = i.tenant_id AND spc.person_id = i.person_id
        AND spc.canonical_job_id = i.canonical_job_id AND spc.opportunity_version = i.opportunity_version
       JOIN opportunity_versions ov
         ON ov.canonical_job_id = i.canonical_job_id AND ov.id = i.opportunity_version
      WHERE spc.attention_decision = 'CANDIDATE'
      GROUP BY i.canonical_job_id, i.opportunity_version, i.tenant_id, i.person_id
      ORDER BY lower(ov.company_name), lower(ov.job_title)`,
    [runId],
  );

  const projectionCache = new Map<string, unknown>();
  const prepared: Array<{
    row: CohortRow;
    context: EvaluationContext | null;
    existing: ExistingEvaluation | null;
    materialized?: MaterializedEvaluation;
    decisionTrace?: CanonicalEvaluatedPayloadV4_3["decisionTrace"];
    status: "EVALUATED" | "SPARSE_SPEC" | "NOT_EVALUABLE" | "FAILED" | "NO_ACTIVE_CONTEXT" | "NO_CANDIDATE_PROJECTION";
    error?: string;
    unavailableDetail?: string;
  }> = [];

  for (const row of cohort) {
    const contextRow = await activeContextFor(row);
    if (!contextRow) {
      prepared.push({ row, context: null, existing: null, status: "NO_ACTIVE_CONTEXT" });
      continue;
    }
    const context = contextFrom(contextRow, row.tenant_id, row.person_id);
    const existing = await existingEvaluationFor(row, context.contextFingerprint);
    const candidateKey = `${row.tenant_id}:${row.person_id}:${context.profileVersion}`;
    let candidate = projectionCache.get(candidateKey);
    if (candidate === undefined) {
      candidate = await resolveExactCandidateProjectionForScope(
        db,
        { tenantId: row.tenant_id, personId: row.person_id },
        context.profileVersion,
      );
      projectionCache.set(candidateKey, candidate ?? null);
    }
    if (!candidate) {
      prepared.push({ row, context, existing, status: "NO_CANDIDATE_PROJECTION" });
      continue;
    }

    try {
      const source = reconstructHistoricalOpportunitySource({
        canonicalJobId: row.canonical_job_id,
        rawContent: row.raw_content,
        jobTitle: row.job_title,
        companyName: row.company_name,
        location: row.location,
      });
      // The exact pinned version is part of presentation evidence identity.
      // It does not alter source text, capability extraction, or score logic.
      (source as Record<string, unknown>).opportunityVersion = row.opportunity_version;
      const artifact = runEngineSingleIntrinsic(source.jobHash, candidate as never, 0, [source]);
      if (!artifact) throw new Error("Intrinsic evaluation artifact was not produced.");

      const presentationEvidence = JobProjectionBuilder.extractPresentationEvidenceForPresentation(
        row.raw_content,
        row.opportunity_version,
        Array.isArray(artifact.jobProjection.capabilities) ? artifact.jobProjection.capabilities : [],
      );
      artifact.jobProjection = {
        ...artifact.jobProjection,
        roleWorkEvidence: presentationEvidence.evidence,
        presentationQualificationEvidence: presentationEvidence.qualifications,
      };

      const state = resolveArtifactEvaluationState(artifact);
      if (state !== "EVALUATED") {
        const pipeline = (artifact.record?.trace as { pipeline?: Array<{ reason?: unknown }> } | undefined)?.pipeline ?? [];
        const pipelineReason = pipeline
          .map((stage) => typeof stage.reason === "string" ? stage.reason.trim() : "")
          .filter(Boolean)
          .at(-1);
        prepared.push({
          row,
          context,
          existing,
          materialized: materializeCanonicalPayload(buildCanonicalUnavailablePayload(
            source.jobHash,
            state,
            context,
            row.canonical_job_id,
            row.opportunity_version,
            new Date().toISOString(),
          )),
          status: state,
          unavailableDetail: pipelineReason || `Evaluator returned ${artifact.record?.verb ?? "no decision verb"} without a materializable score.`,
        });
        continue;
      }
      const intrinsic = buildCanonicalEvaluatedPayload(
        artifact,
        context,
        row.canonical_job_id,
        row.opportunity_version,
        new Date().toISOString(),
        candidate as never,
      );
      const payload = preservedLegacyPresentation(existing, intrinsic);
      prepared.push({
        row,
        context,
        existing,
        materialized: materializeCanonicalPayload(payload),
        decisionTrace: payload.decisionTrace,
        status: "EVALUATED",
      });
    } catch (error) {
      prepared.push({
        row,
        context,
        existing,
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const evaluated = prepared.filter((item) => item.status === "EVALUATED" && item.materialized);
  const unavailable = prepared.filter((item) => item.status === "SPARSE_SPEC" || item.status === "NOT_EVALUABLE");
  const materialized = prepared.filter((item) => item.materialized);
  const decisionDistribution = (items: typeof evaluated, source: "old" | "new") => {
    const count: Record<string, number> = {};
    for (const item of items) {
      const decision = source === "old" ? item.existing?.decision : item.materialized?.decision;
      count[decision ?? "NONE"] = (count[decision ?? "NONE"] ?? 0) + 1;
    }
    return count;
  };
  const scoreChanges = evaluated.filter((item) => item.existing && item.existing.quality_score !== item.materialized?.qualityScore).length;
  const verdictChanges = evaluated.filter((item) => item.existing && item.existing.decision !== item.materialized?.decision).length;
  const relationships = evaluated.flatMap((item) => item.decisionTrace?.relationships ?? []);
  const components = evaluated.flatMap((item) => item.decisionTrace?.components ?? []);
  const withCandidateEvidence = relationships.filter((item) => item.candidateEvidenceIds.length > 0).length;
  const withJobEvidence = relationships.filter((item) => item.jobEvidenceIds.length > 0).length;

  let writes = 0;
  if (apply && prepared.some((item) => item.status === "FAILED" || item.status === "NO_ACTIVE_CONTEXT" || item.status === "NO_CANDIDATE_PROJECTION")) {
    throw new Error("Refusing partial rebaseline: fix missing context, candidate projection, or evaluation failures before --apply.");
  }
  if (apply) {
    const store = new SqliteMaterializedEvaluationStore(db);
    for (const item of materialized) {
      await store.materializeEvaluation(
        { tenantId: item.row.tenant_id, personId: item.row.person_id },
        item.materialized!,
      );
      writes++;
    }
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    runId,
    database: target,
    cohort: cohort.length,
    evaluated: evaluated.length,
    unavailable: unavailable.length,
    unavailableReasons: unavailable.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {}),
    unavailableDetails: unavailable.reduce<Record<string, number>>((counts, item) => {
      const detail = item.unavailableDetail ?? item.status;
      counts[detail] = (counts[detail] ?? 0) + 1;
      return counts;
    }, {}),
    noActiveContext: prepared.filter((item) => item.status === "NO_ACTIVE_CONTEXT").length,
    noCandidateProjection: prepared.filter((item) => item.status === "NO_CANDIDATE_PROJECTION").length,
    failures: prepared.filter((item) => item.status === "FAILED").map((item) => ({
      canonicalJobId: item.row.canonical_job_id,
      company: item.row.company_name,
      role: item.row.job_title,
      error: item.error,
    })),
    oldDecisionDistribution: decisionDistribution(evaluated, "old"),
    newDecisionDistribution: decisionDistribution(evaluated, "new"),
    verdictChanges,
    scoreChanges,
    decisionTrace: {
      version: "canonical-decision-trace/v1",
      relationships: relationships.length,
      withCandidateEvidence,
      withJobEvidence,
      components: components.length,
      strengths: components.filter((item) => item.state === "STRENGTH").length,
      constraints: components.filter((item) => item.state === "CONSTRAINT").length,
      unknowns: components.filter((item) => item.state === "UNKNOWN").length,
    },
    writes,
    dossierPresentation: "not generated; an existing legacy blob is preserved unchanged when an evaluation row is replaced",
  };
  const reportPath = path.join(process.cwd(), "audit-reports", `phase3a-rebaseline-${runId}-${apply ? "apply" : "preflight"}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

void main();
