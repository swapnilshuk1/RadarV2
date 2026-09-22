import type { DatabaseAdapter } from "@/data/database";
import type { ReasoningModel } from "@/dossier/contracts";
import {
  SqliteDossierCompositionQueue,
  compositionJobIdentity,
  type DossierCompositionJob,
} from "@/data/sqlite/repositories/SqliteDossierCompositionQueue";
import { ModelInvalidOutputError, ModelProviderUnavailableError } from "@/lib/model/provider-unavailable";
import {
  createSqliteModelInvocationSink,
  type ModelInvocationContext,
} from "@/lib/model/model-invocation";
import { createBedrockGlmResearchModel } from "@/lib/model/bedrock-glm-research-model";
import { ProductionStagedDossierService } from "./ProductionStagedDossierService";
import { StagedServingPublisher } from "./StagedServingPublisher";

export type DossierWriterFactory = (
  context: ModelInvocationContext,
) => ReasoningModel;

/** Independent durable draft-composition stage. Evaluation completion never waits here. */
export class DossierCompositionWorker {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly writerFactory: DossierWriterFactory = (context) =>
      createBedrockGlmResearchModel({
        invocationSink: createSqliteModelInvocationSink(db, context),
      }),
  ) {}

  async pollOnce() {
    const queue = new SqliteDossierCompositionQueue(this.db);
    const job = await queue.claim();
    if (!job) return null;

    let heartbeat: Promise<void> | undefined;
    let leaseLost = false;
    const timer = setInterval(() => {
      if (!heartbeat) {
        heartbeat = queue
          .heartbeat(job)
          .catch(() => {
            leaseLost = true;
          })
          .finally(() => {
            heartbeat = undefined;
          });
      }
    }, 60_000);
    timer.unref();

    const stopHeartbeat = async () => {
      clearInterval(timer);
      await heartbeat;
      if (leaseLost) throw new Error("DOSSIER_COMPOSITION_LEASE_LOST");
    };

    try {
      const identity = compositionJobIdentity(job);
      const context: ModelInvocationContext = {
        pipeline: "dossier",
        dossierCompositionJobId: job.id,
        tenantId: job.tenant_id,
        personId: job.person_id,
        canonicalJobId: job.canonical_job_id,
        opportunityVersion: job.opportunity_version,
        evaluationContextFingerprint: job.evaluation_context_fingerprint,
      };
      const writer = this.writerFactory(context);
      await new ProductionStagedDossierService(this.db, writer).compose(
        identity,
        () => {},
        { draftOnly: true },
      );
      await queue.markDraftPersisted(job);
      await new StagedServingPublisher(this.db).publish(identity, { allowDraft: true });
      await stopHeartbeat();
      await queue.finish(job);
      return { id: job.id, status: "completed" as const };
    } catch (error) {
      clearInterval(timer);
      await heartbeat;
      const retryableModelError =
        error instanceof ModelProviderUnavailableError ||
        error instanceof ModelInvalidOutputError;
      const status = await queue.fail(job, {
        provider: retryableModelError,
        delay: retryableModelError ? error.retryAfterMs : undefined,
        code:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "DOSSIER_COMPOSITION_REQUIRES_ATTENTION",
      });
      return { id: job.id, status };
    }
  }
}