import type { DatabaseAdapter } from "@/data/database";
import { ModelProviderUnavailableError } from "../../model/provider-unavailable";
import type { ReasoningModel } from "@/dossier/contracts";
import { DOSSIER_COMPOSITION_RECIPE } from "@/dossier/factual-review-integrity";
import { durableDossierModel, checkpointHash } from "./DurableDossierModel";
import { composeStagedDossier, composeStagedDraft } from "@/dossier/staged-composition";
import type { Dossier } from "@/dossier/contracts";
import { SqliteDossierReviewQueue } from "@/data/sqlite/repositories/SqliteDossierReviewQueue";
import {
  assertCanonicalDecisionTrace,
  createStagedEvaluationFingerprint,
  parseCanonicalStagedDecisionResult,
} from "@/dossier/staged-decision-integrity";
import { SqliteRichDossierStore } from "@/data/sqlite/repositories/SqliteRichDossierStore";
import { SqliteStagedEvaluationStore } from "@/data/sqlite/repositories/SqliteStagedEvaluationStore";
import {
  ProductionStagedInputAdapter,
  type ProductionStagedIdentity,
} from "./ProductionStagedInputAdapter";
import { createFactualReviewModel } from "../../model/factual-review-model";

/** Additive presentation work never changes the immutable staged decision or serving pointer. */
export class ProductionStagedDossierService {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly model: ReasoningModel,
    private readonly factualReviewer?: ReasoningModel,
  ) {}
  async compose(
    identity: ProductionStagedIdentity,
    onStage: (stage: string) => void = () => {},
    options: {
      draftOnly?: boolean;
      initialDraft?: Dossier;
      onDefect?: () => Promise<void>;
      deferSave?: boolean;
    } = {},
  ) {
    const evaluation = await new SqliteStagedEvaluationStore(this.db).get(identity);
    if (!evaluation || evaluation.evaluationState !== "COMPLETED")
      throw new Error("DOSSIER_REQUIRES_COMPLETED_EVALUATION");
    if (evaluation.decision === "PASS") throw new Error("DOSSIER_NOT_REQUIRED_FOR_PASS");
    const staged = parseCanonicalStagedDecisionResult(evaluation.evaluation);
    if (
      staged.decision.verdict !== evaluation.decision ||
      staged.decision.screeningViability !== evaluation.screeningViability
    )
      throw new Error("DOSSIER_DECISION_INTEGRITY_MISMATCH");
    const evaluationFingerprint = createStagedEvaluationFingerprint({
      evaluationContextFingerprint: evaluation.evaluationContextFingerprint,
      inputFingerprint: evaluation.inputFingerprint,
      evaluation: staged,
    });
    const store = new SqliteRichDossierStore(this.db);
    if (
      options.initialDraft &&
      (options.initialDraft.sourceInputFingerprint !== evaluation.inputFingerprint ||
        options.initialDraft.sourceEvaluationFingerprint !== evaluationFingerprint)
    )
      throw new Error("REVIEW_DRAFT_INPUT_MISMATCH");
    const existing = await store.get(identity, evaluationFingerprint);
    if (existing) {
      assertCanonicalDecisionTrace(existing, staged.trace);
      return existing;
    }
    const queue = new SqliteDossierReviewQueue(this.db);
    if (options.draftOnly) {
      const queued = await queue.find(identity, evaluationFingerprint);
      if (queued) return null; // Never regenerate an enqueued, withheld or failed draft.
    }
    const frozen = await new ProductionStagedInputAdapter(this.db).build(
      identity,
      this.model,
      onStage,
    );
    if (frozen.fingerprint !== evaluation.inputFingerprint)
      throw new Error("DOSSIER_FROZEN_INPUT_MISMATCH");
    try {
      const scope = checkpointHash({
        tenantId: identity.tenantId,
        personId: identity.personId,
        canonicalJobId: identity.canonicalJobId,
        opportunityVersion: identity.opportunityVersion,
        evaluationFingerprint,
        recipe: DOSSIER_COMPOSITION_RECIPE,
      });
      const writer = durableDossierModel(this.db, scope, this.model);
      const composed = options.draftOnly
        ? await composeStagedDraft(frozen, staged, writer, onStage)
        : await composeStagedDossier(
            frozen,
            staged,
            writer,
            durableDossierModel(this.db, scope, this.factualReviewer ?? createFactualReviewModel()),
            onStage,
            options.initialDraft,
            options.onDefect,
          );
      const dossier = {
        ...composed,
        sourceEvaluationFingerprint: evaluationFingerprint,
        sourceInputFingerprint: evaluation.inputFingerprint,
      };
      assertCanonicalDecisionTrace(dossier, staged.trace);
      if (options.draftOnly) {
        await queue.enqueue(identity, evaluationFingerprint, dossier);
        return dossier;
      }
      if (options.deferSave) return dossier;
      await store.save(identity, evaluationFingerprint, dossier);
      const saved = await store.get(identity, evaluationFingerprint);
      if (!saved) throw new Error("DOSSIER_NOT_PERSISTED");
      assertCanonicalDecisionTrace(saved, staged.trace);
      return saved;
    } catch (error) {
      if (error instanceof ModelProviderUnavailableError) throw error;
      await store.recordFailure(identity, evaluationFingerprint, error);
      throw error;
    }
  }
}
