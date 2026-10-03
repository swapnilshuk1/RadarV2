import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import { getDatabaseTargetIdentity } from "../data/database";
import { workIdentitySchema, type WorkIdentity } from "./operations-contracts";
import {
  operationalSettings,
  assertProviderDispatch,
  enqueueIncidentNotification,
} from "./operations-runtime";
import {
  RECEIPT_FRESH_MS,
  searchUptake,
  requiredSearchConsumers,
  TAVILY_CONNECTION,
} from "./search-connections";
import { appendAdminAudit, requirePlatformRole } from "./service";
import { resumeOperationalWork } from "../evaluation/operational-recovery";
import { configJobTables } from "./config-store";
import { SqliteStagedEvaluationStore } from "../data/sqlite/repositories/SqliteStagedEvaluationStore";
import {
  SqliteRichDossierStore,
  RICH_DOSSIER_VERSION,
} from "../data/sqlite/repositories/SqliteRichDossierStore";
import {
  createStagedEvaluationFingerprint,
  assertCanonicalDecisionTrace,
  parseCanonicalStagedDecisionResult,
} from "../dossier/staged-decision-integrity";

type LinkedJob = {
  pipeline: WorkIdentity["pipeline"];
  job_id: string;
  tenant_id: string;
  person_id: string;
  canonical_job_id: string;
  opportunity_version: string;
  context_fingerprint: string;
  document_id: string | null;
  accounted_reason: string | null;
};
const identity = (row: LinkedJob): WorkIdentity =>
  row.pipeline === "documents"
    ? {
        pipeline: "documents",
        jobId: row.job_id,
        tenantId: row.tenant_id,
        personId: row.person_id,
        documentId: row.document_id!,
      }
    : {
        pipeline: row.pipeline,
        jobId: row.job_id,
        tenantId: row.tenant_id,
        personId: row.person_id,
        canonicalJobId: row.canonical_job_id,
        opportunityVersion: row.opportunity_version,
        contextFingerprint: row.context_fingerprint,
      };
async function recoveryReady(db: DatabaseAdapter, incidentId: string) {
  const incident = await db.one<{
    connection_id: string;
    state: string;
    generation: number;
    last_seen: number;
    failure_class: string;
  }>(
    "SELECT connection_id,state,generation,last_seen,failure_class FROM provider_incidents WHERE id=?",
    [incidentId],
  );
  if (!incident || incident.state === "resolved") throw new Error("INCIDENT_NOT_RECOVERABLE");
  await assertProviderDispatch(db, incident.connection_id);
  if (incident.connection_id === TAVILY_CONNECTION) {
    if (!(await searchUptake(db)).ready) throw new Error("WORKER_UPTAKE_REQUIRED");
    const active = await db.one<{ generation: number; active_id: string | null }>(
      "SELECT generation,active_id FROM admin_search_connection WHERE id=1",
    );
    const hold = await db.one<{
      generation: number;
      requires_action: number;
      last_success_at: number | null;
    }>(
      "SELECT generation,requires_action,last_success_at FROM provider_cooldowns WHERE connection_id=?",
      [TAVILY_CONNECTION],
    );
    // A real current-generation request is sufficient proof for transient
    // episodes. Action-required failures still need explicit capability validation.
    if (
      !["credential", "quota_exhausted", "vault"].includes(incident.failure_class) &&
      hold?.generation === active!.generation &&
      hold.generation === incident.generation &&
      !hold.requires_action &&
      hold.last_success_at !== null &&
      hold.last_success_at > Math.max(incident.last_seen, Date.now() - 15 * 60_000)
    ) {
      return active!.generation;
    }
    const validated = await db.many<{
      worker_instance: string;
      release_sha: string;
      database_fingerprint: string;
    }>(
      `SELECT c.worker_instance,c.release_sha,c.database_fingerprint FROM admin_search_checks c JOIN worker_heartbeats w ON w.instance_id=c.worker_instance
       WHERE c.credential_id IS ? AND c.generation=? AND c.purpose='confirm' AND c.capability_version=1
       AND c.status='passed' AND c.completed_at>? AND c.release_sha=w.release_sha
       AND c.database_fingerprint=w.database_fingerprint AND w.worker_name='evaluation' AND w.last_seen_at>?`,
      [
        active!.active_id,
        active!.generation,
        Math.max(incident.last_seen, Date.now() - 15 * 60_000),
        new Date(Date.now() - 150000).toISOString(),
      ],
    );
    const consumers = await requiredSearchConsumers(db);
    if (
      !validated.some((proof) =>
        consumers.some(
          (c) =>
            c.instance_id === proof.worker_instance &&
            c.release_sha === proof.release_sha &&
            c.database_fingerprint === proof.database_fingerprint,
        ),
      )
    )
      throw new Error("CURRENT_HEALTH_PROOF_REQUIRED");
    return active!.generation;
  }

  const hostProviders: Record<string, { provider: string; worker: string }> = {
    "bedrock:host": { provider: "bedrock", worker: "evaluation" },
    "google:host": { provider: "google", worker: "dossier-review" },
  };
  const host = hostProviders[incident.connection_id];
  if (!host) throw new Error("INCIDENT_PROVIDER_NOT_RECOVERABLE");
  const probe = await db.one(
    `SELECT id FROM provider_host_checks WHERE provider=? AND status='passed' AND worker_name=?
      AND release_sha=? AND database_fingerprint=? AND completed_at>? AND completed_at>? ORDER BY completed_at DESC LIMIT 1`,
    [
      host.provider,
      host.worker,
      process.env.RADAR_RELEASE_SHA ?? "development",
      getDatabaseTargetIdentity().fingerprint,
      incident.last_seen,
      Date.now() - 15 * 60_000,
    ],
  );
  const hold = await db.one<{
    requires_action: number;
    blocked_until: number;
    generation: number;
    last_success_at: number | null;
  }>(
    "SELECT requires_action,blocked_until,generation,last_success_at FROM provider_cooldowns WHERE connection_id=?",
    [incident.connection_id],
  );
  const runtimeReceipt =
    hold?.last_success_at && hold.last_success_at > incident.last_seen
      ? await db.one(
          `SELECT instance_id FROM worker_runtime_receipts WHERE connection_id=? AND worker_name=?
          AND release_sha=? AND database_fingerprint=? AND reload_status='loaded'
          AND last_seen_at>? AND last_seen_at>? ORDER BY last_seen_at DESC LIMIT 1`,
          [
            incident.connection_id,
            host.worker,
            process.env.RADAR_RELEASE_SHA ?? "development",
            getDatabaseTargetIdentity().fingerprint,
            incident.last_seen,
            Date.now() - RECEIPT_FRESH_MS,
          ],
        )
      : null;
  if (
    (!probe && !runtimeReceipt) ||
    !hold ||
    hold.generation !== incident.generation ||
    hold.requires_action ||
    hold.blocked_until > Date.now()
  )
    throw new Error("CURRENT_HOST_MODEL_PROBE_REQUIRED");
  return incident.generation;
}
export async function previewRecovery(
  db: DatabaseAdapter,
  actor: string,
  incidentId: string,
  jobIds: string[],
  reason: string,
) {
  return db.transaction(async (tx) => {
    await requirePlatformRole(tx, actor, true);
    const generation = await recoveryReady(tx, incidentId);
    const limit = (await operationalSettings(tx)).settings.cohortLimit;
    const selected = [...new Set(jobIds)];
    if (!selected.length || selected.length > limit) throw new Error("RECOVERY_COHORT_LIMIT");
    const rows = await tx.many<LinkedJob>(
      "SELECT * FROM provider_incident_jobs WHERE incident_id=?",
      [incidentId],
    );
    const jobs = rows.filter((r) => selected.includes(r.job_id));
    if (jobs.length !== selected.length) throw new Error("RECOVERY_JOB_NOT_IN_INCIDENT");
    const id = randomUUID(),
      now = Date.now();
    await tx.execute(
      "INSERT INTO recovery_actions(id,incident_id,state,generation,created_at,expires_at,created_by,reason) VALUES(?,?,'previewed',?,?,?,?,?)",
      [id, incidentId, generation, now, now + 5 * 60_000, actor, reason],
    );
    for (const job of jobs) {
      const eligibility =
        job.accounted_reason === "OPERATOR_EXCLUDED"
          ? { outcome: "skipped" as const, reason: "OPERATOR_EXCLUDED" }
          : await resumeOperationalWork(tx, identity(job), false);
      await tx.execute(
        "INSERT INTO recovery_action_jobs(action_id,pipeline,job_id,identity_json,reason) VALUES(?,?,?,?,?)",
        [
          id,
          job.pipeline,
          job.job_id,
          JSON.stringify(identity(job)),
          `${eligibility.outcome}:${eligibility.reason}`,
        ],
      );
    }
    await appendAdminAudit(tx, {
      actor,
      action: "recovery.preview",
      target: id,
      reason,
      detail: {
        incidentId,
        generation,
        jobs: jobs.map((j) => ({ pipeline: j.pipeline, id: j.job_id })),
      },
    });
    return { id, expiresAt: now + 5 * 60_000, jobs: jobs.map(identity) };
  });
}
export async function executeRecovery(
  db: DatabaseAdapter,
  actor: string,
  actionId: string,
  reason: string,
) {
  // A single bounded DB transaction makes process death recoverable without partial unrecorded resumes.
  return db.transaction(async (tx) => {
    await requirePlatformRole(tx, actor, true);
    const action = await tx.one<{
      incident_id: string;
      state: string;
      generation: number;
      expires_at: number;
    }>("SELECT * FROM recovery_actions WHERE id=?", [actionId]);
    if (!action || action.state !== "previewed") throw new Error("RECOVERY_NOT_PREVIEWED");
    if (action.expires_at <= Date.now()) throw new Error("RECOVERY_PREVIEW_EXPIRED");
    if (action.generation !== (await recoveryReady(tx, action.incident_id)))
      throw new Error("RECOVERY_CONNECTION_CHANGED");
    await tx.execute(
      "UPDATE recovery_actions SET state='executing' WHERE id=? AND state='previewed'",
      [actionId],
    );
    const jobs = await tx.many<{ pipeline: string; job_id: string; identity_json: string }>(
      "SELECT * FROM recovery_action_jobs WHERE action_id=?",
      [actionId],
    );
    const outcomes = [];
    for (const job of jobs) {
      const linked = await tx.one<{ accounted_reason: string | null }>(
        "SELECT accounted_reason FROM provider_incident_jobs WHERE incident_id=? AND pipeline=? AND job_id=?",
        [action.incident_id, job.pipeline, job.job_id],
      );
      const outcome =
        linked?.accounted_reason === "OPERATOR_EXCLUDED"
          ? { outcome: "skipped" as const, reason: "OPERATOR_EXCLUDED" }
          : await resumeOperationalWork(
              tx,
              workIdentitySchema.parse(JSON.parse(job.identity_json)),
            );
      await tx.execute(
        "UPDATE recovery_action_jobs SET outcome=?,reason=? WHERE action_id=? AND pipeline=? AND job_id=?",
        [outcome.outcome, outcome.reason, actionId, job.pipeline, job.job_id],
      );
      outcomes.push({ jobId: job.job_id, ...outcome });
    }
    await tx.execute("UPDATE recovery_actions SET state=?,completed_at=? WHERE id=?", [
      outcomes.every((o) => o.outcome === "resumed") ? "completed" : "partially_completed",
      Date.now(),
      actionId,
    ]);
    await tx.execute("UPDATE provider_incidents SET state='recovering' WHERE id=?", [
      action.incident_id,
    ]);
    await appendAdminAudit(tx, {
      actor,
      action: "recovery.execute",
      target: actionId,
      reason,
      detail: { incidentId: action.incident_id, generation: action.generation, outcomes },
    });
    return { actionId, outcomes };
  });
}
async function accountIncidentJob(
  db: DatabaseAdapter,
  incidentId: string,
  work: WorkIdentity,
  reason: string | null,
) {
  await db.execute(
    "UPDATE provider_incident_jobs SET accounted_reason=? WHERE incident_id=? AND pipeline=? AND job_id=?",
    [reason, incidentId, work.pipeline, work.jobId],
  );
  if (reason)
    await db.execute(
      "UPDATE recovery_action_jobs SET outcome=?,reason=? WHERE pipeline=? AND job_id=? AND outcome='resumed' AND action_id IN (SELECT id FROM recovery_actions WHERE incident_id=?)",
      [
        reason === "COMPLETED" ? "completed" : "skipped",
        reason,
        work.pipeline,
        work.jobId,
        incidentId,
      ],
    );
}
/** Resolve the provider episode only after health and exact work accounting; terminal/excluded work is not successful output. */
export async function reconcileProviderIncidents(storage: DatabaseAdapter) {
  const incidents = await storage.many<{ id: string }>(
    "SELECT id FROM provider_incidents WHERE state!='resolved' AND connection_id IN (?,?,?)",
    [TAVILY_CONNECTION, "bedrock:host", "google:host"],
  );
  for (const incident of incidents) {
    await storage.transaction(async (db) => {
      let healthy = true;
      try {
        await recoveryReady(db, incident.id);
      } catch {
        healthy = false;
      }
      const jobs = await db.many<LinkedJob>(
        "SELECT * FROM provider_incident_jobs WHERE incident_id=?",
        [incident.id],
      );
      let complete = true; // A healthy episode with no linked work has no outstanding cohort.
      for (const linked of jobs) {
        const work = identity(linked);
        if (linked.accounted_reason === "OPERATOR_EXCLUDED") {
          await accountIncidentJob(db, incident.id, work, "OPERATOR_EXCLUDED");
          continue;
        }
        if (work.pipeline === "documents") {
          const row = await db.one<{ status: string }>(
            `SELECT j.status FROM candidate_document_jobs j JOIN candidate_documents d
             ON d.id=j.document_id AND d.tenant_id=j.tenant_id AND d.person_id=j.person_id
             WHERE j.id=? AND j.document_id=? AND j.tenant_id=? AND j.person_id=?`,
            [work.jobId, work.documentId, work.tenantId, work.personId],
          );
          const reason =
            row?.status === "completed"
              ? "COMPLETED"
              : row?.status === "dead_letter"
                ? "DOMAIN_TERMINAL_DEAD_LETTER"
                : null;
          await accountIncidentJob(db, incident.id, work, reason);
          if (!reason) complete = false;
          continue;
        }
        if (!healthy) {
          complete = false;
          continue;
        }
        const owner = work.pipeline === "pursuit" ? "p" : "j";
        const join =
          work.pipeline === "pursuit"
            ? "LEFT JOIN opportunity_pursuits p ON p.id=j.pursuit_id AND p.tenant_id=j.tenant_id AND p.person_id=j.person_id"
            : "";
        const row = await db.one<{
          status: string;
          person_id: string;
          tenant_id: string;
          canonical_job_id: string;
          opportunity_version: string;
          evaluation_context_fingerprint: string;
          search_plan_id?: string;
        }>(
          `SELECT j.*,${owner}.canonical_job_id,${owner}.opportunity_version,${owner}.evaluation_context_fingerprint FROM ${configJobTables[work.pipeline]} j ${join} WHERE j.id=?`,
          [work.jobId],
        );
        if (!row) {
          complete = false; // Missing data needs an explicit audited exclusion, not an invented success.
          await accountIncidentJob(db, incident.id, work, null);
          continue;
        }
        if (
          row.tenant_id !== work.tenantId ||
          row.person_id !== work.personId ||
          row.opportunity_version !== work.opportunityVersion ||
          row.canonical_job_id !== work.canonicalJobId ||
          row.evaluation_context_fingerprint !== work.contextFingerprint
        ) {
          await accountIncidentJob(db, incident.id, work, "IDENTITY_SUPERSEDED");
          continue;
        }
        const supersededContext = await db.one(
          `SELECT a.context_fingerprint FROM evaluation_context_scopes s JOIN active_evaluation_contexts a
         ON a.tenant_id=s.tenant_id AND a.person_id=s.person_id AND a.search_plan_id=s.search_plan_id
         WHERE s.tenant_id=? AND s.person_id=? AND s.context_fingerprint=? AND a.context_fingerprint!=s.context_fingerprint
         AND NOT EXISTS (SELECT 1 FROM active_evaluation_contexts current WHERE current.tenant_id=s.tenant_id AND current.person_id=s.person_id AND current.context_fingerprint=s.context_fingerprint)`,
          [work.tenantId, work.personId, work.contextFingerprint],
        );
        const supersededVersion =
          row.search_plan_id &&
          (await db.one(
            `SELECT newer.id FROM search_plan_candidates c JOIN opportunity_versions newer ON newer.id=c.opportunity_version AND newer.canonical_job_id=c.canonical_job_id
         JOIN opportunity_versions old ON old.id=? AND old.canonical_job_id=c.canonical_job_id
         WHERE c.tenant_id=? AND c.person_id=? AND c.search_plan_id=? AND c.canonical_job_id=? AND newer.created_at>old.created_at`,
            [
              work.opportunityVersion,
              work.tenantId,
              work.personId,
              row.search_plan_id,
              work.canonicalJobId,
            ],
          ));
        if (supersededContext || supersededVersion) {
          await accountIncidentJob(
            db,
            incident.id,
            work,
            supersededContext ? "CONTEXT_SUPERSEDED" : "VERSION_SUPERSEDED",
          );
          continue;
        }
        if (
          ["failed", "dead_letter", "staged_dead_letter", "needs_attention"].includes(row.status)
        ) {
          await accountIncidentJob(
            db,
            incident.id,
            work,
            `DOMAIN_TERMINAL_${row.status.toUpperCase()}`,
          );
          continue;
        }
        let accounted = ["completed", "staged_completed"].includes(row.status);
        if (accounted && work.pipeline === "evaluation") {
          try {
            const dossierIdentity = {
              ...work,
              evaluationContextFingerprint: work.contextFingerprint,
            };
            const evaluation = await new SqliteStagedEvaluationStore(db).get(dossierIdentity);
            accounted =
              evaluation?.evaluationState === "COMPLETED" && evaluation.decision === "PASS";
            if (evaluation?.evaluationState === "COMPLETED" && evaluation.decision !== "PASS") {
              const staged = parseCanonicalStagedDecisionResult(evaluation.evaluation);
              const fingerprint = createStagedEvaluationFingerprint({
                evaluationContextFingerprint: work.contextFingerprint,
                inputFingerprint: evaluation.inputFingerprint,
                evaluation: staged,
              });
              const memo = await new SqliteRichDossierStore(db).get(dossierIdentity, fingerprint);
              if (memo) assertCanonicalDecisionTrace(memo, staged.trace);
              const published = await db.one(
                "SELECT id FROM materialized_evaluations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND evaluation_fingerprint=? AND json_extract(evaluation_json,'$.presentationVersion')=?",
                [
                  work.tenantId,
                  work.personId,
                  work.canonicalJobId,
                  work.opportunityVersion,
                  work.contextFingerprint,
                  fingerprint,
                  RICH_DOSSIER_VERSION,
                ],
              );
              accounted = Boolean(memo && published);
            }
          } catch {
            accounted = false;
          }
        }
        const paused = await db.one(
          "SELECT scope_key FROM pipeline_controls WHERE paused=1 AND scope_key IN ('*',?) AND pipeline IN ('*',?)",
          [work.tenantId, work.pipeline],
        );
        const userPaused =
          work.pipeline === "evaluation" &&
          Boolean(
            await db.one(
              "SELECT desired_state FROM evaluation_runtime_control WHERE tenant_id=? AND person_id=? AND desired_state!='RUNNING'",
              [work.tenantId, work.personId],
            ),
          );
        if (paused || userPaused) accounted = true;
        if (!accounted) complete = false;
        await accountIncidentJob(
          db,
          incident.id,
          work,
          accounted ? (paused || userPaused ? "MANUALLY_PAUSED" : "COMPLETED") : null,
        );
      }
      if (complete && healthy) {
        await recoveryReady(db, incident.id); // Account and resolve inside the same transaction.
        const changed = await db.execute(
          "UPDATE provider_incidents SET state='resolved',resolved_at=? WHERE id=? AND state='recovering'",
          [Date.now(), incident.id],
        );
        if (changed.rowsAffected) await enqueueIncidentNotification(db, incident.id, "resolved");
      }
    });
  }
}
