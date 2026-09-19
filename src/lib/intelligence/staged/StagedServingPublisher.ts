import type { DatabaseAdapter } from "@/data/database";
import { SqliteStagedEvaluationStore } from "@/data/sqlite/repositories/SqliteStagedEvaluationStore";
import {
  SqliteRichDossierStore,
  RICH_DOSSIER_VERSION,
} from "@/data/sqlite/repositories/SqliteRichDossierStore";
import {
  assertCanonicalDecisionTrace,
  createStagedEvaluationFingerprint,
  parseCanonicalStagedDecisionResult,
} from "@/dossier/staged-decision-integrity";
import type { ProductionStagedIdentity } from "./ProductionStagedInputAdapter";
import {
  SqliteDossierReviewQueue,
  DRAFT_DOSSIER_VERSION,
} from "@/data/sqlite/repositories/SqliteDossierReviewQueue";

/** Build the existing serving projection; activation remains an independent operation. */
export class StagedServingPublisher {
  constructor(private readonly db: DatabaseAdapter) {}
  async publish(
    identity: ProductionStagedIdentity,
    options: { allowDraft?: boolean } = {},
  ): Promise<void> {
    const record = await new SqliteStagedEvaluationStore(this.db).get(identity);
    if (!record || record.evaluationState !== "COMPLETED" || !record.decision)
      throw new Error("SERVING_REQUIRES_COMPLETED_STAGED_EVALUATION");
    const staged = parseCanonicalStagedDecisionResult(record.evaluation);
    if (
      staged.decision.verdict !== record.decision ||
      staged.decision.screeningViability !== record.screeningViability
    )
      throw new Error("SERVING_STAGED_EVALUATION_INTEGRITY_MISMATCH");
    const fingerprint = createStagedEvaluationFingerprint({
      evaluationContextFingerprint: record.evaluationContextFingerprint,
      inputFingerprint: record.inputFingerprint,
      evaluation: staged,
    });
    const reviewed = await new SqliteRichDossierStore(this.db).get(identity, fingerprint);
    const queue = new SqliteDossierReviewQueue(this.db);
    const queued = options.allowDraft && !reviewed ? await queue.find(identity, fingerprint) : null;
    const dossier = reviewed ?? (queued ? await queue.getDraft(identity, fingerprint) : null);
    if (!dossier && !queued) throw new Error("SERVING_REQUIRES_MATCHING_DOSSIER");
    if (dossier) {
      if (
        dossier.verdict.verdict !== record.decision ||
        dossier.verdict.screeningViability !== record.screeningViability
      )
        throw new Error("SERVING_REQUIRES_MATCHING_DOSSIER");
      assertCanonicalDecisionTrace(dossier, staged.trace);
    }
    const payload = {
      schemaVersion: "staged-serving-v1",
      presentationVersion: reviewed ? RICH_DOSSIER_VERSION : DRAFT_DOSSIER_VERSION,
      inputFingerprint: record.inputFingerprint,
      evaluationFingerprint: fingerprint,
      verdict: record.decision,
      screeningViability: record.screeningViability,
    };
    const result = await this.db.execute(
      `INSERT INTO materialized_evaluations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,evaluation_state,decision,quality_score,rationale,evidence_ids,evaluation_json,vetoed,materialized_at) VALUES(?,?,?,?,?,?,?,'STAGED_EVALUATED',?,NULL,?,?,?,0,?) ON CONFLICT(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint) DO UPDATE SET evaluation_json=excluded.evaluation_json,rationale=excluded.rationale,evidence_ids=excluded.evidence_ids,materialized_at=excluded.materialized_at WHERE materialized_evaluations.evaluation_state='STAGED_EVALUATED' AND materialized_evaluations.evaluation_fingerprint=excluded.evaluation_fingerprint AND (COALESCE(json_extract(materialized_evaluations.evaluation_json,'$.presentationVersion'),'')<>? OR json_extract(excluded.evaluation_json,'$.presentationVersion')=?)`,
      [
        `staged-serving-${fingerprint}`,
        identity.tenantId,
        identity.personId,
        identity.canonicalJobId,
        identity.opportunityVersion,
        identity.evaluationContextFingerprint,
        fingerprint,
        record.decision,
        dossier?.executiveThesis.text ??
          "Memo temporarily unavailable while factual corrections are reviewed.",
        JSON.stringify(dossier?.verdict.claimIds ?? []),
        JSON.stringify(payload),
        dossier?.generatedAt ?? new Date().toISOString(),
        RICH_DOSSIER_VERSION,
        RICH_DOSSIER_VERSION,
      ],
    );
    if (result.rowsAffected !== 1) {
      const winner = await this.db.one<{ evaluation_fingerprint: string; evaluation_json: string }>(
        `SELECT evaluation_fingerprint,evaluation_json FROM materialized_evaluations WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?`,
        [
          identity.tenantId,
          identity.personId,
          identity.canonicalJobId,
          identity.opportunityVersion,
          identity.evaluationContextFingerprint,
        ],
      );
      if (
        options.allowDraft &&
        winner?.evaluation_fingerprint === fingerprint &&
        JSON.parse(winner.evaluation_json).presentationVersion === RICH_DOSSIER_VERSION
      )
        return;
      throw new Error("SERVING_PROJECTION_FINGERPRINT_CONFLICT");
    }
  }
}
