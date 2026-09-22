import type { DatabaseAdapter } from "@/data/database";
import type { ReasoningModel } from "@/dossier/contracts";
import { reviewFingerprint } from "@/dossier/factual-review-integrity";
import {
  SqliteDossierReviewQueue,
  reviewJobIdentity,
  validateDraft,
} from "@/data/sqlite/repositories/SqliteDossierReviewQueue";
import { SqliteRichDossierStore } from "@/data/sqlite/repositories/SqliteRichDossierStore";
import { ModelProviderUnavailableError } from "@/lib/model/provider-unavailable";
import type { ModelInvocationContext } from "@/lib/model/model-invocation";
import { ProductionStagedDossierService } from "./ProductionStagedDossierService";
import { StagedServingPublisher } from "./StagedServingPublisher";

export type ReviewModelFactory = (context: ModelInvocationContext) => ReasoningModel;

/** Provider-neutral review lane. Scraping/evaluation never wait for this worker. */
export class DossierReviewWorker {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly writer: ReviewModelFactory,
    private readonly reviewer: ReviewModelFactory,
  ) {}
  async pollOnce() {
    const queue = new SqliteDossierReviewQueue(this.db),
      job = await queue.claim();
    if (!job) return null;
    let heartbeat: Promise<void> | undefined,
      leaseLost = false;
    const timer = setInterval(() => {
      if (!heartbeat)
        heartbeat = queue
          .heartbeat(job)
          .catch(() => {
            leaseLost = true;
          })
          .finally(() => {
            heartbeat = undefined;
          });
    }, 30_000);
    const stopHeartbeat = async () => {
      clearInterval(timer);
      await heartbeat;
      if (leaseLost) throw new Error("REVIEW_LEASE_LOST");
    };
    try {
      const identity = reviewJobIdentity(job),
        raw = JSON.parse(job.draft_json);
      if (reviewFingerprint(raw) !== job.draft_fingerprint)
        throw new Error("DRAFT_CONTENT_MISMATCH");
      const draft = validateDraft(raw, identity, job.evaluation_fingerprint);
      const invocationContext: ModelInvocationContext = {
        pipeline: "factual_review",
        reviewJobId: job.id,
        tenantId: job.tenant_id,
        personId: job.person_id,
        canonicalJobId: job.canonical_job_id,
        opportunityVersion: job.opportunity_version,
        evaluationContextFingerprint: job.evaluation_context_fingerprint,
      };
      const dossier = await new ProductionStagedDossierService(
        this.db,
        this.writer(invocationContext),
        this.reviewer(invocationContext),
      ).compose(identity, () => {}, {
        initialDraft: draft,
        onDefect: () => queue.withhold(job),
        deferSave: true,
      });
      if (!dossier || dossier.sourceEvaluationFingerprint !== job.evaluation_fingerprint)
        throw new Error("REVIEW_EVALUATION_MISMATCH");
      await stopHeartbeat();
      await queue.finish(job, async (tx) => {
        await new SqliteRichDossierStore(tx).save(identity, job.evaluation_fingerprint, dossier);
        // A publication may be prepared in shadow, but a review never creates a new publication or activates context.
        const published = await tx.one(
          `SELECT id FROM materialized_evaluations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND evaluation_fingerprint=? AND evaluation_state='STAGED_EVALUATED'`,
          [
            identity.tenantId,
            identity.personId,
            identity.canonicalJobId,
            identity.opportunityVersion,
            identity.evaluationContextFingerprint,
            job.evaluation_fingerprint,
          ],
        );
        if (published) await new StagedServingPublisher(tx).publish(identity);
      });
      return { id: job.id, status: "completed" };
    } catch (error) {
      clearInterval(timer);
      await heartbeat;
      const provider = error instanceof ModelProviderUnavailableError;
      const status = await queue.fail(job, {
        provider,
        delay: provider ? error.retryAfterMs : undefined,
        code: error instanceof Error ? error.message.slice(0,2000) : 'REVIEW_REQUIRES_ATTENTION',
      });
      return { id: job.id, status };
    }
  }
}