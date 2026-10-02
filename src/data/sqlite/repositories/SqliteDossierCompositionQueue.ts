import { createHash, randomUUID } from "node:crypto";
import { reserveClaim, deferralFilter, renewReservation } from "../../../admin/protection";
import type { DatabaseAdapter } from "@/data/database";
import { DOSSIER_COMPOSITION_RECIPE } from "@/dossier/factual-review-integrity";
import { checkpointHash } from "@/dossier/runtime/durable-model";
import type { ProductionStagedIdentity } from "@/evaluation/contracts";

export const PREPARING_DOSSIER_VERSION = "dossier-preparing-v1";
export const DOSSIER_COMPOSITION_LEASE_MS = 180_000;

export interface DossierCompositionJob {
  id: string;
  tenant_id: string;
  person_id: string;
  canonical_job_id: string;
  opportunity_version: string;
  evaluation_context_fingerprint: string;
  evaluation_fingerprint: string;
  profile_version: string;
  recipe: string;
  status: "pending" | "processing" | "retry" | "completed" | "needs_attention";
  attempts: number;
  max_attempts: number;
  next_attempt_at: number;
  lease_token: string | null;
  lease_until: number | null;
  last_error: string | null;
  created_at: number;
}

export function compositionJobIdentity(job: DossierCompositionJob): ProductionStagedIdentity {
  return {
    tenantId: job.tenant_id,
    personId: job.person_id,
    canonicalJobId: job.canonical_job_id,
    opportunityVersion: job.opportunity_version,
    evaluationContextFingerprint: job.evaluation_context_fingerprint,
    profileVersion: job.profile_version,
  };
}

export function compositionCheckpointScope(
  identity: Omit<ProductionStagedIdentity, "profileVersion">,
  evaluationFingerprint: string,
): string {
  return checkpointHash({
    tenantId: identity.tenantId,
    personId: identity.personId,
    canonicalJobId: identity.canonicalJobId,
    opportunityVersion: identity.opportunityVersion,
    evaluationFingerprint,
    recipe: DOSSIER_COMPOSITION_RECIPE,
  });
}

function identityKey(identity: ProductionStagedIdentity, evaluationFingerprint: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity.tenantId,
        identity.personId,
        identity.canonicalJobId,
        identity.opportunityVersion,
        identity.evaluationContextFingerprint,
        evaluationFingerprint,
        DOSSIER_COMPOSITION_RECIPE,
      ]),
    )
    .digest("hex");
}

/** Durable composition stage. Evaluation truth exists before this queue is touched. */
export class SqliteDossierCompositionQueue {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly now = Date.now,
  ) {}

  async enqueue(
    identity: ProductionStagedIdentity,
    evaluationFingerprint: string,
  ): Promise<string> {
    const id = identityKey(identity, evaluationFingerprint);
    const now = this.now();
    await this.db.execute(
      `INSERT INTO dossier_composition_jobs(
        id,tenant_id,person_id,canonical_job_id,opportunity_version,
        evaluation_context_fingerprint,evaluation_fingerprint,profile_version,recipe,
        status,next_attempt_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?)
      ON CONFLICT(
        tenant_id,person_id,canonical_job_id,opportunity_version,
        evaluation_context_fingerprint,evaluation_fingerprint,recipe
      ) DO NOTHING`,
      [
        id,
        identity.tenantId,
        identity.personId,
        identity.canonicalJobId,
        identity.opportunityVersion,
        identity.evaluationContextFingerprint,
        evaluationFingerprint,
        identity.profileVersion,
        DOSSIER_COMPOSITION_RECIPE,
        now,
        now,
        now,
      ],
    );
    return id;
  }

  async find(
    identity: Omit<ProductionStagedIdentity, "profileVersion">,
    evaluationFingerprint: string,
  ): Promise<DossierCompositionJob | null> {
    return this.db.one<DossierCompositionJob>(
      `SELECT * FROM dossier_composition_jobs
       WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=?
         AND evaluation_context_fingerprint=? AND evaluation_fingerprint=? AND recipe=?`,
      [
        identity.tenantId,
        identity.personId,
        identity.canonicalJobId,
        identity.opportunityVersion,
        identity.evaluationContextFingerprint,
        evaluationFingerprint,
        DOSSIER_COMPOSITION_RECIPE,
      ],
    );
  }

  /** Explicit recovery action for one exact terminal composition job.
   * A terminal retry starts a fresh semantic repair cycle. Resumable memo
   * checkpoints for this exact immutable dossier scope are therefore cleared,
   * while model invocation audit and evaluation truth remain untouched. */
  async retryAttention(
    identity: Omit<ProductionStagedIdentity, "profileVersion">,
    evaluationFingerprint: string,
  ): Promise<boolean> {
    const now = this.now();
    const scope = compositionCheckpointScope(identity, evaluationFingerprint);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(
        `UPDATE dossier_composition_jobs
         SET status='pending',attempts=0,next_attempt_at=?,lease_token=NULL,lease_until=NULL,
             last_error=NULL,updated_at=?
         WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=?
           AND evaluation_context_fingerprint=? AND evaluation_fingerprint=? AND recipe=?
           AND status='needs_attention'`,
        [
          now,
          now,
          identity.tenantId,
          identity.personId,
          identity.canonicalJobId,
          identity.opportunityVersion,
          identity.evaluationContextFingerprint,
          evaluationFingerprint,
          DOSSIER_COMPOSITION_RECIPE,
        ],
      );
      if (!result.rowsAffected) return false;
      await tx.execute(`DELETE FROM dossier_model_checkpoints WHERE scope_fingerprint=?`, [scope]);
      return true;
    });
  }

  async claim(): Promise<DossierCompositionJob | null> {
    const now = this.now();
    const token = randomUUID();
    const filter = await deferralFilter(this.db, "dossier", "dcj.id");
    return this.db.transaction(async (tx) => {
      const row = await tx.one<DossierCompositionJob>(
        `SELECT * FROM dossier_composition_jobs AS dcj
         WHERE recipe=?
           ${filter}
           AND EXISTS (
             SELECT 1 FROM active_evaluation_contexts aec
             WHERE aec.tenant_id=dcj.tenant_id
               AND aec.person_id=dcj.person_id
               AND aec.context_fingerprint=dcj.evaluation_context_fingerprint
           )
           AND (
             (status IN ('pending','retry') AND next_attempt_at<=?)
             OR (status='processing' AND (lease_until IS NULL OR lease_until<=? OR updated_at<=?))
           )
         ORDER BY next_attempt_at,created_at
         LIMIT 1`,
        [DOSSIER_COMPOSITION_RECIPE, now, now, now - DOSSIER_COMPOSITION_LEASE_MS],
      );
      if (!row) return null;
      if (
        !(await reserveClaim(
          tx,
          {
            pipeline: "dossier",
            id: row.id,
            tenant: row.tenant_id,
            token,
            leaseUntil: now + DOSSIER_COMPOSITION_LEASE_MS,
          },
          now,
        ))
      )
        return null;
      const updated = await tx.execute(
        `UPDATE dossier_composition_jobs
         SET status='processing',lease_token=?,lease_until=?,updated_at=?
         WHERE id=? AND (
           (status IN ('pending','retry') AND next_attempt_at<=?)
           OR (status='processing' AND (lease_until IS NULL OR lease_until<=? OR updated_at<=?))
         )`,
        [
          token,
          now + DOSSIER_COMPOSITION_LEASE_MS,
          now,
          row.id,
          now,
          now,
          now - DOSSIER_COMPOSITION_LEASE_MS,
        ],
      );
      if (!updated.rowsAffected) return null;
      return {
        ...row,
        status: "processing",
        lease_token: token,
        lease_until: now + DOSSIER_COMPOSITION_LEASE_MS,
      };
    });
  }

  async heartbeat(job: DossierCompositionJob): Promise<void> {
    const now = this.now();
    const updated = await this.db.execute(
      `UPDATE dossier_composition_jobs
       SET lease_until=?,updated_at=?
       WHERE id=? AND status='processing' AND lease_token=? AND lease_until>?`,
      [now + DOSSIER_COMPOSITION_LEASE_MS, now, job.id, job.lease_token, now],
    );
    if (!updated.rowsAffected) throw new Error("DOSSIER_COMPOSITION_LEASE_LOST");
    await renewReservation(
      this.db,
      "dossier",
      job.id,
      job.lease_token!,
      now + DOSSIER_COMPOSITION_LEASE_MS,
    );
  }

  async markDraftPersisted(job: DossierCompositionJob): Promise<void> {
    const now = this.now();
    const updated = await this.db.execute(
      `UPDATE dossier_composition_jobs
       SET draft_persisted_at=COALESCE(draft_persisted_at,?),updated_at=?
       WHERE id=? AND status='processing' AND lease_token=? AND lease_until>?`,
      [now, now, job.id, job.lease_token, now],
    );
    if (!updated.rowsAffected) throw new Error("DOSSIER_COMPOSITION_LEASE_LOST");
  }

  async finish(job: DossierCompositionJob): Promise<void> {
    const now = this.now();
    const updated = await this.db.execute(
      `UPDATE dossier_composition_jobs
       SET status='completed',lease_token=NULL,lease_until=NULL,last_error=NULL,
           published_at=?,updated_at=?
       WHERE id=? AND status='processing' AND lease_token=? AND lease_until>?`,
      [now, now, job.id, job.lease_token, now],
    );
    if (!updated.rowsAffected) throw new Error("DOSSIER_COMPOSITION_LEASE_LOST");
  }

  async fail(
    job: DossierCompositionJob,
    error: { provider: boolean; delay?: number; code: string },
    random = Math.random,
  ): Promise<"retry" | "needs_attention" | "lease_lost"> {
    const now = this.now();
    const quota = error.code.startsWith("QUOTA_DEFERRED:");
    const attempt = job.attempts + (quota ? 0 : 1);
    const terminal = !quota && (!error.provider || attempt >= job.max_attempts);
    const delay = Math.max(
      error.delay ?? 0,
      Math.min(5 * 60_000, 15_000 * 2 ** Math.min(job.attempts, 4)) * (0.8 + random() * 0.2),
    );
    const result = await this.db.execute(
      `UPDATE dossier_composition_jobs
       SET status=?,attempts=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,
           last_error=?,updated_at=?
       WHERE id=? AND status='processing' AND lease_token=?`,
      [
        terminal ? "needs_attention" : "retry",
        attempt,
        now + delay,
        error.code,
        now,
        job.id,
        job.lease_token,
      ],
    );
    if (!result.rowsAffected) return "lease_lost";
    return terminal ? "needs_attention" : "retry";
  }
}
