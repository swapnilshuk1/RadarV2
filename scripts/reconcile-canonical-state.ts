/**
 * One-time pre-production promotion of an already accepted local staged-v8
 * context into Turso.  This deliberately imports no queues, leases, model
 * checkpoints, or telemetry and imports no model client.
 */
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../src/data/database/sqlite";
import { getDatabaseAdapter, getDatabaseTargetIdentity } from "../src/data/database";
import type { DatabaseAdapter } from "../src/data/database/adapter";
import {
  SqliteStagedInputStore,
  validateSnapshot,
} from "../src/data/sqlite/repositories/SqliteStagedInputStore";
import {
  SqliteStagedEvaluationStore,
  type StagedEvaluationRecord,
} from "../src/data/sqlite/repositories/SqliteStagedEvaluationStore";
import {
  RICH_DOSSIER_VERSION,
  SqliteRichDossierStore,
} from "../src/data/sqlite/repositories/SqliteRichDossierStore";
import { StagedServingPublisher } from "../src/lib/intelligence/staged/StagedServingPublisher";
import { createStagedEvaluationFingerprint } from "../src/dossier/staged-decision-integrity";

type Row = Record<string, unknown>;
const SOURCE_PATH = path.resolve(process.cwd(), ".radar/local-review/app-current.sqlite");
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.split("=");
    return [key, value.join("=")];
  }),
);
const apply = args.has("--apply");
const context = args.get("--context");

function fail(code: string): never {
  throw new Error(`CANONICAL_RECONCILIATION_${code}`);
}
function stable(value: Row): string {
  const ignored = new Set([
    "created_at",
    "updated_at",
    "last_seen_at",
    "activated_at",
    "materialized_at",
    "evaluated_at",
    "generated_at",
  ]);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !ignored.has(key))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}
function sha(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function q(identifier: string): string {
  if (!/^[a-z_]+$/i.test(identifier)) fail("UNSAFE_IDENTIFIER");
  return `\"${identifier}\"`;
}

async function row(
  db: DatabaseAdapter,
  sql: string,
  values: readonly unknown[] = [],
): Promise<Row | null> {
  return db.one<Row>(sql, values);
}
async function rows(
  db: DatabaseAdapter,
  sql: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  return db.many<Row>(sql, values);
}
async function insertExact(
  target: DatabaseAdapter,
  table: string,
  source: Row,
  where: string,
  params: readonly unknown[],
): Promise<"existing" | "inserted"> {
  const winner = await row(target, `SELECT * FROM ${q(table)} WHERE ${where}`, params);
  if (winner) {
    if (stable(winner) !== stable(source)) fail(`${table.toUpperCase()}_CONFLICT`);
    return "existing";
  }
  const columns = Object.keys(source);
  await target.execute(
    `INSERT INTO ${q(table)} (${columns.map(q).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    columns.map((column) => source[column]),
  );
  return "inserted";
}

async function main(): Promise<void> {
  if (!context) fail("CONTEXT_REQUIRED");
  if (!apply) fail("APPLY_REQUIRED");
  if (!process.env.RADAR_RECONCILE_RECOVERY_POINT) fail("RECOVERY_POINT_REQUIRED");
  if (!process.env.RADAR_RECONCILE_WORKERS_STOPPED) fail("WORKERS_MUST_BE_STOPPED");
  if (!process.env.RADAR_RECONCILE_WORKERS_STOPPED.match(/^true$/i))
    fail("WORKERS_MUST_BE_STOPPED");
  const targetIdentity = getDatabaseTargetIdentity();
  if (targetIdentity.engine !== "turso") fail("TURSO_TARGET_REQUIRED");
  if (
    !process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT ||
    process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT !== targetIdentity.fingerprint
  )
    fail("TARGET_FINGERPRINT_REQUIRED");

  const localFile = args.get("--source") ? path.resolve(args.get("--source")!) : SOURCE_PATH;
  const local = new SqliteAdapter(new Database(localFile, { readonly: true }));
  const target = getDatabaseAdapter();
  const sourceContext = await row(
    local,
    `SELECT ec.*,sps.search_plan_id,sps.id AS snapshot_id,sps.snapshot_hash,sps.payload_json,sp.title,sp.status,sp.criteria_json
    FROM evaluation_contexts ec JOIN search_plan_snapshots sps ON sps.id=ec.search_plan_snapshot_id
    JOIN search_plans sp ON sp.id=sps.search_plan_id WHERE ec.context_fingerprint=?`,
    [context],
  );
  if (!sourceContext) fail("SOURCE_CONTEXT_NOT_FOUND");
  const tenantId = String(sourceContext.tenant_id),
    personId = String(sourceContext.person_id),
    planId = String(sourceContext.search_plan_id);
  const person = await row(target, "SELECT id,tenant_id FROM people WHERE id=? AND tenant_id=?", [
    personId,
    tenantId,
  ]);
  if (!person) fail("TARGET_PERSON_MISSING");
  if (!(await row(target, "SELECT id FROM tenants WHERE id=?", [tenantId])))
    fail("TARGET_TENANT_MISSING");

  const sourcePlan = await row(local, "SELECT * FROM search_plans WHERE id=?", [planId]);
  const sourceSnapshot = await row(local, "SELECT * FROM search_plan_snapshots WHERE id=?", [
    sourceContext.search_plan_snapshot_id,
  ]);
  if (!sourcePlan || !sourceSnapshot) fail("SOURCE_LINEAGE_INCOMPLETE");
  const sourceCandidates = await rows(
    local,
    "SELECT * FROM search_plan_candidates WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND attention_decision='CANDIDATE'",
    [tenantId, personId, planId],
  );
  const sourceProfileBindings = await rows(
    local,
    "SELECT * FROM profile_projection_source_bindings WHERE tenant_id=? AND person_id=? AND profile_version=?",
    [tenantId, personId, sourceContext.profile_version],
  );
  const sourceProfileArtifacts = await Promise.all(
    sourceProfileBindings.map(async (binding) => {
      const document = await row(
        local,
        "SELECT * FROM candidate_documents WHERE id=? AND tenant_id=? AND person_id=?",
        [binding.document_id, tenantId, personId],
      );
      const contents = await rows(
        local,
        "SELECT * FROM document_contents WHERE document_id=? AND tenant_id=? AND person_id=?",
        [binding.document_id, tenantId, personId],
      );
      const graph = await row(
        local,
        "SELECT * FROM evidence_graphs WHERE id=? AND document_id=? AND tenant_id=? AND person_id=?",
        [binding.evidence_graph_id, binding.document_id, tenantId, personId],
      );
      if (!document || !graph) fail("SOURCE_PROFILE_LINEAGE_INCOMPLETE");
      return { binding, document, contents, graph };
    }),
  );
  // Shortlist membership is evaluation-based. A reviewed dossier enriches a
  // card, but it is not a prerequisite for serving an accepted evaluation.
  // Select exactly the local P/C serving population, rather than accidentally
  // treating memo publication as the source of truth. Existing human decisions
  // remain part of this population and are copied below when fingerprint-matched.
  const sourceEvaluations = await rows(
    local,
    `SELECT se.* FROM staged_evaluations se
     JOIN materialized_evaluations me
       ON me.tenant_id=se.tenant_id AND me.person_id=se.person_id
      AND me.canonical_job_id=se.canonical_job_id AND me.opportunity_version=se.opportunity_version
      AND me.evaluation_context_fingerprint=se.evaluation_context_fingerprint
     JOIN search_plan_candidates spc
       ON spc.tenant_id=se.tenant_id AND spc.person_id=se.person_id
      AND spc.canonical_job_id=se.canonical_job_id AND spc.opportunity_version=se.opportunity_version
      AND spc.search_plan_id=? AND spc.attention_decision='CANDIDATE'
     WHERE se.tenant_id=? AND se.person_id=? AND se.evaluation_context_fingerprint=?
       AND se.evaluation_state='COMPLETED' AND se.decision IN ('PURSUE','CONSIDER')
       AND me.evaluation_state='STAGED_EVALUATED' AND me.decision IN ('PURSUE','CONSIDER')
       AND me.evaluation_fingerprint IS NOT NULL`,
    [planId, tenantId, personId, context],
  );
  if (!sourceEvaluations.length) fail("SOURCE_ACCEPTED_EVALUATIONS_MISSING");
  const candidateKeys = new Set(
    sourceCandidates.map((item) => `${item.canonical_job_id}:${item.opportunity_version}`),
  );
  if (
    sourceEvaluations.some(
      (item) => !candidateKeys.has(`${item.canonical_job_id}:${item.opportunity_version}`),
    )
  )
    fail("SOURCE_EVALUATION_OUTSIDE_PLAN");

  // Validate all source artifacts before mutating Turso.
  const prepared = await Promise.all(
    sourceEvaluations.map(async (evaluation) => {
      const identity = {
        tenantId,
        personId,
        canonicalJobId: String(evaluation.canonical_job_id),
        opportunityVersion: String(evaluation.opportunity_version),
        evaluationContextFingerprint: context,
      };
      const frozen = await row(
        local,
        `SELECT * FROM staged_frozen_inputs WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND model_configuration_fingerprint=?`,
        [...Object.values(identity), evaluation.model_configuration_fingerprint],
      );
      if (!frozen) fail("SOURCE_FROZEN_INPUT_MISSING");
      const input = validateSnapshot(JSON.parse(String(frozen.input_json)));
      if (input.fingerprint !== evaluation.input_fingerprint)
        fail("SOURCE_INPUT_FINGERPRINT_MISMATCH");
      const record = new SqliteStagedEvaluationStore(local).get(identity);
      const staged = await record;
      if (!staged || staged.inputFingerprint !== input.fingerprint)
        fail("SOURCE_STAGED_EVALUATION_INVALID");
      const evaluationFingerprint = createStagedEvaluationFingerprint({
        evaluationContextFingerprint: context,
        inputFingerprint: staged.inputFingerprint,
        evaluation: staged.evaluation as never,
      });
      const presentation = await row(
        local,
        `SELECT * FROM materialized_dossier_presentations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND presentation_version=?`,
        [...Object.values(identity), RICH_DOSSIER_VERSION],
      );
      // A dossier may be absent or have become invalid under the current
      // validator. In either case the evaluation remains eligible for the
      // shortlist and is explicitly served as dossier-preparing-v1.
      const dossier =
        presentation?.source_evaluation_fingerprint === evaluationFingerprint
          ? await new SqliteRichDossierStore(local).get(
              identity,
              evaluationFingerprint,
              RICH_DOSSIER_VERSION,
            )
          : null;
      const decision = await row(
        local,
        "SELECT * FROM canonical_decisions WHERE tenant_id=? AND person_id=? AND canonical_job_id=?",
        [tenantId, personId, identity.canonicalJobId],
      );
      // Decisions are evidence-bound. A historical decision whose fingerprint
      // no longer matches this accepted evaluation is intentionally left behind;
      // it must never be rebound to a newer evaluation during promotion.
      const matchingDecision =
        decision?.reviewed_fingerprint === evaluationFingerprint ? decision : null;
      return {
        identity,
        frozen,
        input,
        staged,
        evaluationFingerprint,
        dossier,
        decision: matchingDecision,
        staleDecisionSkipped: Boolean(decision && !matchingDecision),
      };
    }),
  );

  const manifest = {
    context,
    tenantId,
    personId,
    planId,
    sourceCandidates: sourceCandidates.length,
    shortlistMembers: sourceEvaluations.length,
    validEvaluations: prepared.length,
    validReviewedDossiers: prepared.filter((item) => item.dossier).length,
    preparingDossiers: prepared.filter((item) => !item.dossier).length,
    copiedDecisions: prepared.filter((item) => item.decision).length,
    staleDecisionsSkipped: prepared.filter((item) => item.staleDecisionSkipped).length,
    recoveryPoint: process.env.RADAR_RECONCILE_RECOVERY_POINT,
    target: targetIdentity.fingerprint,
  };
  console.log(JSON.stringify({ ...manifest, manifestSha256: sha(manifest) }, null, 2));

  await target.transaction(async (tx) => {
    await insertExact(tx, "search_plans", sourcePlan, "id=?", [planId]);
    await insertExact(tx, "search_plan_snapshots", sourceSnapshot, "id=?", [sourceSnapshot.id]);
    const sourceEc = await row(
      local,
      "SELECT * FROM evaluation_contexts WHERE context_fingerprint=?",
      [context],
    );
    if (!sourceEc) fail("SOURCE_CONTEXT_NOT_FOUND");
    await insertExact(tx, "evaluation_contexts", sourceEc, "context_fingerprint=?", [context]);
    await insertExact(
      tx,
      "evaluation_context_scopes",
      {
        context_fingerprint: context,
        tenant_id: tenantId,
        person_id: personId,
        search_plan_id: planId,
      },
      "context_fingerprint=?",
      [context],
    );
    for (const artifact of sourceProfileArtifacts) {
      await insertExact(tx, "candidate_documents", artifact.document, "id=?", [
        artifact.document.id,
      ]);
      for (const content of artifact.contents)
        await insertExact(tx, "document_contents", content, "id=?", [content.id]);
      await insertExact(tx, "evidence_graphs", artifact.graph, "id=?", [artifact.graph.id]);
      await insertExact(
        tx,
        "profile_projection_source_bindings",
        artifact.binding,
        "tenant_id=? AND person_id=? AND profile_version=? AND document_id=?",
        [tenantId, personId, artifact.binding.profile_version, artifact.binding.document_id],
      );
    }
    for (const candidate of sourceCandidates) {
      const opportunity = await row(local, "SELECT * FROM canonical_opportunities WHERE id=?", [
        candidate.canonical_job_id,
      ]);
      const version = await row(
        local,
        "SELECT * FROM opportunity_versions WHERE id=? AND canonical_job_id=?",
        [candidate.opportunity_version, candidate.canonical_job_id],
      );
      if (!opportunity || !version) fail("SOURCE_OPPORTUNITY_LINEAGE_MISSING");
      await insertExact(tx, "canonical_opportunities", opportunity, "id=?", [opportunity.id]);
      await insertExact(tx, "opportunity_versions", version, "id=?", [version.id]);
      await insertExact(
        tx,
        "search_plan_candidates",
        candidate,
        "tenant_id=? AND person_id=? AND search_plan_id=? AND canonical_job_id=? AND opportunity_version=?",
        [tenantId, personId, planId, candidate.canonical_job_id, candidate.opportunity_version],
      );
    }
    for (const item of prepared) {
      for (const [table, source, predicate, values] of [
        [
          "staged_frozen_inputs",
          item.frozen,
          "tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND model_configuration_fingerprint=?",
          [
            tenantId,
            personId,
            item.identity.canonicalJobId,
            item.identity.opportunityVersion,
            context,
            item.frozen.model_configuration_fingerprint,
          ],
        ],
        [
          "staged_evaluations",
          await row(
            local,
            "SELECT * FROM staged_evaluations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?",
            [
              tenantId,
              personId,
              item.identity.canonicalJobId,
              item.identity.opportunityVersion,
              context,
            ],
          )!,
          "tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?",
          [
            tenantId,
            personId,
            item.identity.canonicalJobId,
            item.identity.opportunityVersion,
            context,
          ],
        ],
      ] as const) {
        const existing = await row(tx, `SELECT * FROM ${q(table)} WHERE ${predicate}`, values);
        if (existing && stable(existing) !== stable(source))
          fail(`${table.toUpperCase()}_CONFLICT`);
      }
      const serving = await row(
        tx,
        "SELECT evaluation_fingerprint FROM materialized_evaluations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?",
        [
          tenantId,
          personId,
          item.identity.canonicalJobId,
          item.identity.opportunityVersion,
          context,
        ],
      );
      if (serving && serving.evaluation_fingerprint !== item.evaluationFingerprint)
        fail("MATERIALIZED_EVALUATION_CONFLICT");
      const inputStore = new SqliteStagedInputStore(tx);
      await inputStore.save(
        item.identity,
        String(item.frozen.source_binding_fingerprint),
        {
          id: String(item.frozen.model_id),
          version: String(item.frozen.model_version),
          configurationFingerprint: String(item.frozen.model_configuration_fingerprint),
        },
        item.input,
      );
      await new SqliteStagedEvaluationStore(tx).save(item.staged as StagedEvaluationRecord);
      if (item.dossier) {
        await new SqliteRichDossierStore(tx).save(
          item.identity,
          item.evaluationFingerprint,
          item.dossier,
        );
      }
      await new StagedServingPublisher(tx).publish(item.identity, { allowPreparing: true });
      if (item.decision) {
        await insertExact(
          tx,
          "canonical_decisions",
          item.decision,
          "tenant_id=? AND person_id=? AND canonical_job_id=?",
          [tenantId, personId, item.identity.canonicalJobId],
        );
      }
    }
    await tx.execute(
      "UPDATE search_plans SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND person_id=?",
      [planId, tenantId, personId],
    );
    await tx.execute(
      "INSERT INTO active_evaluation_contexts(tenant_id,person_id,search_plan_id,context_fingerprint,activated_by) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,person_id,search_plan_id) DO UPDATE SET context_fingerprint=excluded.context_fingerprint,activated_at=CURRENT_TIMESTAMP,activated_by=excluded.activated_by",
      [tenantId, personId, planId, context, "canonical-reconciliation"],
    );
  });
  const targetCount = await row(
    target,
    "SELECT COUNT(*) AS count FROM materialized_evaluations WHERE tenant_id=? AND person_id=? AND evaluation_context_fingerprint=? AND decision IN ('PURSUE','CONSIDER')",
    [tenantId, personId, context],
  );
  if (Number(targetCount?.count) !== prepared.length) fail("POST_APPLY_SHORTLIST_PARITY_FAILED");
  console.log(
    `CANONICAL_RECONCILIATION_APPLIED context=${context} promoted=${prepared.length} ` +
      `reviewed=${prepared.filter((item) => item.dossier).length} preparing=${prepared.filter((item) => !item.dossier).length} ` +
      `decisions=${prepared.filter((item) => item.decision).length} staleDecisionsSkipped=${prepared.filter((item) => item.staleDecisionSkipped).length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
