import type { DatabaseAdapter } from '@/data/database';
import { SqliteStagedEvaluationStore } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { SqliteRichDossierStore, RICH_DOSSIER_VERSION } from '@/data/sqlite/repositories/SqliteRichDossierStore';
import {
  assertCanonicalDecisionTrace,
  createStagedEvaluationFingerprint,
  parseCanonicalStagedDecisionResult,
} from '@/dossier/staged-decision-integrity';
import type { ProductionStagedIdentity } from './ProductionStagedInputAdapter';

/** Build the existing serving projection; activation remains an independent operation. */
export class StagedServingPublisher {
  constructor(private readonly db:DatabaseAdapter) {}
  async publish(identity:ProductionStagedIdentity):Promise<void> {
    const record=await new SqliteStagedEvaluationStore(this.db).get(identity);
    if(!record||record.evaluationState!=='COMPLETED'||!record.decision)throw new Error('SERVING_REQUIRES_COMPLETED_STAGED_EVALUATION');
    const staged=parseCanonicalStagedDecisionResult(record.evaluation);
    if(staged.decision.verdict!==record.decision||staged.decision.screeningViability!==record.screeningViability)throw new Error('SERVING_STAGED_EVALUATION_INTEGRITY_MISMATCH');
    const fingerprint=createStagedEvaluationFingerprint({evaluationContextFingerprint:record.evaluationContextFingerprint,inputFingerprint:record.inputFingerprint,evaluation:staged});
    const dossier=await new SqliteRichDossierStore(this.db).get(identity,fingerprint);
    if(!dossier||dossier.verdict.verdict!==record.decision||dossier.verdict.screeningViability!==record.screeningViability)throw new Error('SERVING_REQUIRES_MATCHING_DOSSIER');
    assertCanonicalDecisionTrace(dossier,staged.trace);
    const payload={schemaVersion:'staged-serving-v1',presentationVersion:RICH_DOSSIER_VERSION,inputFingerprint:record.inputFingerprint,evaluationFingerprint:fingerprint,verdict:record.decision,screeningViability:record.screeningViability};
    const result=await this.db.execute(`INSERT INTO materialized_evaluations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,evaluation_state,decision,quality_score,rationale,evidence_ids,evaluation_json,vetoed,materialized_at) VALUES(?,?,?,?,?,?,?,'STAGED_EVALUATED',?,NULL,?,?,?,0,?) ON CONFLICT(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint) DO UPDATE SET evaluation_json=excluded.evaluation_json,rationale=excluded.rationale,evidence_ids=excluded.evidence_ids,materialized_at=excluded.materialized_at WHERE materialized_evaluations.evaluation_state='STAGED_EVALUATED' AND materialized_evaluations.evaluation_fingerprint=excluded.evaluation_fingerprint`,[`staged-serving-${fingerprint}`,identity.tenantId,identity.personId,identity.canonicalJobId,identity.opportunityVersion,identity.evaluationContextFingerprint,fingerprint,record.decision,dossier.executiveThesis.text,JSON.stringify(dossier.verdict.claimIds),JSON.stringify(payload),dossier.generatedAt]);
    if(result.rowsAffected!==1)throw new Error('SERVING_PROJECTION_FINGERPRINT_CONFLICT');
  }
}
