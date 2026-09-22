import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "@/data/database";
import { dossierSchema, type Dossier } from "@/dossier/contracts";
import { DOSSIER_COMPOSITION_RECIPE, reviewFingerprint } from "@/dossier/factual-review-integrity";
import { assertMemoIntegrity } from "@/dossier/memo-integrity";
import { validateComposition, validateClaims } from "@/dossier/grounding";
import type { ProductionStagedIdentity } from "@/lib/intelligence/staged/ProductionStagedInputAdapter";
import type { DossierPresentationIdentity } from "./SqliteDossierPresentationStore";

export const DRAFT_DOSSIER_VERSION = "dossier-v4.1-draft";
export interface ReviewJob {
  id: string;
  tenant_id: string;
  person_id: string;
  canonical_job_id: string;
  opportunity_version: string;
  evaluation_context_fingerprint: string;
  profile_version: string;
  evaluation_fingerprint: string;
  draft_json: string;
  draft_fingerprint: string;
  status: string;
  withheld: number;
  attempts: number;
  lease_token: string;
  created_at: number;
}
export function reviewJobIdentity(job: ReviewJob): ProductionStagedIdentity {
  return {
    tenantId: job.tenant_id,
    personId: job.person_id,
    canonicalJobId: job.canonical_job_id,
    opportunityVersion: job.opportunity_version,
    evaluationContextFingerprint: job.evaluation_context_fingerprint,
    profileVersion: job.profile_version,
  };
}
export function validateDraft(
  value: unknown,
  identity: DossierPresentationIdentity,
  fingerprint: string,
): Dossier {
  const draft = dossierSchema.parse(value);
  if (
    draft.opportunity.id !== identity.canonicalJobId ||
    draft.sourceEvaluationFingerprint !== fingerprint ||
    !draft.sourceInputFingerprint
  )
    throw new Error("DRAFT_IDENTITY_MISMATCH");
  if (draft.generation.factualReviewer || draft.generation.factualReviews)
    throw new Error("DRAFT_MUST_NOT_CLAIM_REVIEW");
  assertMemoIntegrity(draft);
  const claims = [
    ...draft.evidence.roleClaims,
    ...draft.evidence.candidateClaims,
    ...draft.evidence.contextualClaims,
    ...draft.evidence.relationalClaims,
  ];
  validateClaims(claims, draft.evidence.lineage);
  validateComposition(draft, {
    claims,
    resolutions: draft.resolutions,
    candidateConflicts: draft.candidateConflicts,
    narrativePlan: draft.narrativePlan,
    evaluation: draft.verdict,
  });
  return draft;
}
const params = (i: DossierPresentationIdentity, fp: string) => [
  i.tenantId,
  i.personId,
  i.canonicalJobId,
  i.opportunityVersion,
  i.evaluationContextFingerprint,
  fp,
  DOSSIER_COMPOSITION_RECIPE,
];
const exact =
  "tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND evaluation_fingerprint=? AND recipe=?";

/** One durable draft/review task per exact evaluation and composition recipe. */
export class SqliteDossierReviewQueue {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly now = Date.now,
  ) {}
  async find(identity: DossierPresentationIdentity, fp: string) {
    return this.db.one<ReviewJob>(
      `SELECT * FROM dossier_review_jobs WHERE ${exact}`,
      params(identity, fp),
    );
  }
  async getDraft(identity: DossierPresentationIdentity, fp: string): Promise<Dossier | null> {
    const row = await this.find(identity, fp);
    if (!row || row.withheld || row.status === "completed") return null;
    try {
      const value = JSON.parse(row.draft_json);
      if (reviewFingerprint(value) !== row.draft_fingerprint) return null;
      return validateDraft(value, identity, fp);
    } catch {
      return null;
    }
  }
  async enqueue(identity: ProductionStagedIdentity, fp: string, value: Dossier) {
    const draft = validateDraft(value, identity, fp),
      key = params(identity, fp),
      now = this.now();
    await this.db.execute(
      `INSERT INTO dossier_review_jobs(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,recipe,profile_version,draft_json,draft_fingerprint,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?) ON CONFLICT DO NOTHING`,
      [
        reviewFingerprint(key),
        ...key,
        identity.profileVersion,
        JSON.stringify(draft),
        reviewFingerprint(draft),
        now,
        now,
        now,
      ],
    );
  }
  async claim(): Promise<ReviewJob | null> {
    const now = this.now(),
      token = randomUUID();
    return this.db.transaction(async (tx) => {
      const lane = await tx.execute(
        `UPDATE dossier_review_lane SET lease_token=?,lease_until=? WHERE id='factual-review' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)`,
        [token, now + 180_000, now, now],
      );
      if (!lane.rowsAffected) return null;
      const row = await tx.one<ReviewJob>(
        `SELECT * FROM dossier_review_jobs WHERE recipe=? AND ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?)) ORDER BY next_attempt_at,created_at LIMIT 1`,
        [DOSSIER_COMPOSITION_RECIPE, now, now],
      );
      if (!row) {
        await tx.execute(
          `UPDATE dossier_review_lane SET lease_token=NULL,lease_until=NULL WHERE lease_token=?`,
          [token],
        );
        return null;
      }
      await tx.execute(
        `UPDATE dossier_review_jobs SET status='processing',lease_token=?,lease_until=?,updated_at=? WHERE id=?`,
        [token, now + 180_000, now, row.id],
      );
      return { ...row, status: "processing", lease_token: token };
    });
  }
  async heartbeat(job: ReviewJob) {
    const now = this.now();
    const result = await this.db.execute(
      `UPDATE dossier_review_lane SET lease_until=? WHERE id='factual-review' AND lease_token=? AND lease_until>?`,
      [now + 180_000, job.lease_token, now],
    );
    if (!result.rowsAffected) throw new Error("REVIEW_LEASE_LOST");
    await this.db.execute(
      `UPDATE dossier_review_jobs SET lease_until=?,updated_at=? WHERE id=? AND lease_token=?`,
      [now + 180_000, now, job.id, job.lease_token],
    );
  }
  async withhold(job: ReviewJob) {
    await this.db.execute(
      `UPDATE dossier_review_jobs SET withheld=1,updated_at=? WHERE id=? AND status='processing' AND lease_token=?`,
      [this.now(), job.id, job.lease_token],
    );
  }
  async finish(job: ReviewJob, save: (tx: DatabaseAdapter) => Promise<void>) {
    await this.db.transaction(async (tx) => {
      const guard = await tx.execute(
        `UPDATE dossier_review_jobs SET status='completed',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='processing' AND lease_token=? AND lease_until>?`,
        [this.now(), job.id, job.lease_token, this.now()],
      );
      if (!guard.rowsAffected) throw new Error("REVIEW_LEASE_LOST");
      const lane = await tx.execute(
        `UPDATE dossier_review_lane SET lease_token=NULL,lease_until=NULL,failures=0,next_attempt_at=0 WHERE id='factual-review' AND lease_token=? AND lease_until>?`,
        [job.lease_token, this.now()],
      );
      if (!lane.rowsAffected) throw new Error("REVIEW_LEASE_LOST");
      await save(tx);
    });
  }
  async fail(
    job: ReviewJob,
    error: { provider: boolean; delay?: number; code: string },
    random = Math.random,
  ) {
    return this.db.transaction(async (tx) => {
      const lane = await tx.one<{ failures: number }>(
        `SELECT failures FROM dossier_review_lane WHERE id='factual-review' AND lease_token=?`,
        [job.lease_token],
      );
      if (!lane) return 'lease_lost';
      const delay = Math.max(
        error.delay ?? 0,
        Math.min(300_000, 30_000 * 2 ** Math.min(lane.failures, 4)) * (0.8 + random() * 0.2),
      );
      const terminal = !error.provider || this.now() - job.created_at > 24 * 3600_000;
      await tx.execute(
        `UPDATE dossier_review_jobs SET status=?,attempts=attempts+1,next_attempt_at=?,lease_token=NULL,lease_until=NULL,last_error=?,updated_at=? WHERE id=? AND lease_token=?`,
        [
          terminal ? "needs_attention" : "retry",
          this.now() + delay,
          error.code,
          this.now(),
          job.id,
          job.lease_token,
        ],
      );
      await tx.execute(
        `UPDATE dossier_review_lane SET lease_token=NULL,lease_until=NULL,failures=?,next_attempt_at=? WHERE id='factual-review' AND lease_token=?`,
        [
          error.provider ? lane.failures + 1 : 0,
          error.provider ? this.now() + delay : 0,
          job.lease_token,
        ],
      );
      return terminal ? 'needs_attention' : 'retry';
    });
  }
}