import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import type { WorkIdentity } from "./operations-contracts";
import {
  operationalSettings,
  assertProviderDispatch,
  enqueueIncidentNotification,
} from "./operations-runtime";
import { searchUptake, TAVILY_CONNECTION } from "./search-connections";
import { appendAdminAudit, requirePlatformRole } from "./service";
import { resumeOperationalWork } from "../evaluation/operational-recovery";
import { configJobTables } from "./config-store";
import { SqliteStagedEvaluationStore } from "../data/sqlite/repositories/SqliteStagedEvaluationStore";
import { SqliteRichDossierStore } from "../data/sqlite/repositories/SqliteRichDossierStore";
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
};
const identity = (row: LinkedJob): WorkIdentity => ({
  pipeline: row.pipeline,
  jobId: row.job_id,
  tenantId: row.tenant_id,
  personId: row.person_id,
  canonicalJobId: row.canonical_job_id,
  opportunityVersion: row.opportunity_version,
  contextFingerprint: row.context_fingerprint,
});
async function recoveryReady(db: DatabaseAdapter, incidentId: string) {
  const incident = await db.one<{ connection_id: string; state: string }>(
    "SELECT connection_id,state FROM provider_incidents WHERE id=?",
    [incidentId],
  );
  if (!incident || incident.state === "resolved") throw new Error("INCIDENT_NOT_RECOVERABLE");
  await assertProviderDispatch(db, incident.connection_id);
  if (incident.connection_id !== TAVILY_CONNECTION || !(await searchUptake(db)).ready)
    throw new Error("WORKER_UPTAKE_REQUIRED");
  const active = await db.one<{ generation: number; active_id: string | null }>(
    "SELECT generation,active_id FROM admin_search_connection WHERE id=1",
  );
  const validated = await db.one(
    "SELECT id FROM admin_search_checks WHERE credential_id=? AND status='passed' AND completed_at>?",
    [active!.active_id, Date.now() - 15 * 60_000],
  );
  if (!validated) throw new Error("CURRENT_HEALTH_PROOF_REQUIRED");
  return active!.generation;
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
      const eligibility = await resumeOperationalWork(tx, identity(job), false);
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
      const outcome = await resumeOperationalWork(tx, JSON.parse(job.identity_json));
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
/** Completion is polled by workers, never asserted by an operator. */
export async function reconcileProviderIncidents(db: DatabaseAdapter) {
  const incidents = await db.many<{ id: string }>(
    "SELECT id FROM provider_incidents WHERE state='recovering' AND connection_id=?",
    [TAVILY_CONNECTION],
  );
  for (const incident of incidents) {
    try {
      await recoveryReady(db, incident.id);
    } catch {
      continue;
    }
    const jobs = await db.many<LinkedJob>(
      "SELECT * FROM provider_incident_jobs WHERE incident_id=?",
      [incident.id],
    );
    let complete = jobs.length > 0;
    for (const linked of jobs) {
      const work = identity(linked);
      const row = await db.one<{
        status: string;
        person_id: string;
        tenant_id: string;
        canonical_job_id: string;
        opportunity_version: string;
        evaluation_context_fingerprint: string;
      }>(`SELECT * FROM ${configJobTables[work.pipeline]} WHERE id=?`, [work.jobId]);
      if (
        !row ||
        row.tenant_id !== work.tenantId ||
        row.person_id !== work.personId ||
        row.opportunity_version !== work.opportunityVersion ||
        row.canonical_job_id !== work.canonicalJobId ||
        row.evaluation_context_fingerprint !== work.contextFingerprint
      ) {
        complete = false;
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
          accounted = evaluation?.evaluationState === "COMPLETED" && evaluation.decision === "PASS";
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
              "SELECT id FROM materialized_evaluations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND evaluation_fingerprint=? AND json_extract(evaluation_json,'$.presentationVersion')='dossier-v4.1'",
              [
                work.tenantId,
                work.personId,
                work.canonicalJobId,
                work.opportunityVersion,
                work.contextFingerprint,
                fingerprint,
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
      if (accounted && !paused && !userPaused)
        await db.execute(
          "UPDATE recovery_action_jobs SET outcome='completed',reason='REVIEWED_WORK_COMPLETED' WHERE pipeline=? AND job_id=? AND outcome='resumed' AND action_id IN (SELECT id FROM recovery_actions WHERE incident_id=?)",
          [work.pipeline, work.jobId, incident.id],
        );
      await db.execute(
        "UPDATE provider_incident_jobs SET accounted_reason=? WHERE incident_id=? AND pipeline=? AND job_id=?",
        [
          accounted ? (paused || userPaused ? "MANUALLY_PAUSED" : "COMPLETED") : null,
          incident.id,
          work.pipeline,
          work.jobId,
        ],
      );
    }
    if (complete)
      await db.transaction(async (tx) => {
        await recoveryReady(tx, incident.id); // Fence resolution against a failure or rotation racing reconciliation.
        const changed = await tx.execute(
          "UPDATE provider_incidents SET state='resolved',resolved_at=? WHERE id=? AND state='recovering'",
          [Date.now(), incident.id],
        );
        if (changed.rowsAffected) await enqueueIncidentNotification(tx, incident.id, "resolved");
      });
  }
}
