import { createHash, randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "@/data/database";
import { DOSSIER_COMPOSITION_RECIPE } from "@/dossier/factual-review-integrity";
import type { ProductionStagedIdentity } from "@/lib/intelligence/staged/ProductionStagedInputAdapter";

export const PREPARING_DOSSIER_VERSION = "dossier-preparing-v1";

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

function identityKey(
  identity: ProductionStagedIdentity,
  evaluationFingerprint: string,
): string {
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
    identity: ProductionStagedIdentity,
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

  async claim(): Promise<DossierCompositionJob | null> {
    const now = this.now();
    const token = randomUUID();
    return this.db.transaction(async (tx) => {
      const row = await tx.one<DossierCompositionJob>(
        `SELECT * FROM dossier_composition_jobs
         WHERE recipe=?
           AND (
             (status IN ('pending','retry') AND next_attempt_at<=?)
             OR (status='processing' AND lease_until<=?)
           )
         ORDER BY next_attempt_at,created_at
         LIMIT 1`,
        [DOSSIER_COMPOSITION_RECIPE, now, now],
      );
      if (!row) return null;
      const updated = await tx.execute(
        `UPDATE dossier_composition_jobs
         SET status='processing',lease_token=?,lease_until=?,updated_at=?
         WHERE id=? AND (
           (status IN ('pending','retry') AND next_attempt_at<=?)
           OR (status='processing' AND lease_until<=?)
         )`,
        [token, now + 15 * 60_000, now, row.id, now, now],
      );
      if (!updated.rowsAffected) return null;
      return {
        ...row,
        status: "processing",
        lease_token: token,
        lease_until: now + 15 * 60_000,
      };
    });
  }

  async heartbeat(job: DossierCompositionJob): Promise<void> {
    const now = this.now();
    const updated = await this.db.execute(
      `UPDATE dossier_composition_jobs
       SET lease_until=?,updated_at=?
       WHERE id=? AND status='processing' AND lease_token=? AND lease_until>?`,
      [now + 15 * 60_000, now, job.id, job.lease_token, now],
    );
    if (!updated.rowsAffected) throw new Error("DOSSIER_COMPOSITION_LEASE_LOST");
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
    const attempt = job.attempts + 1;
    const terminal = !error.provider || attempt >= job.max_attempts;
    const delay = Math.max(
      error.delay ?? 0,
      Math.min(5 * 60_000, 15_000 * 2 ** Math.min(job.attempts, 4)) *
        (0.8 + random() * 0.2),
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