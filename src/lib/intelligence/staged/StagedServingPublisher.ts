import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '@/data/database';
import { SqliteStagedEvaluationStore } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { SqliteRichDossierStore } from '@/data/sqlite/repositories/SqliteRichDossierStore';
import type { ProductionStagedIdentity } from './ProductionStagedInputAdapter';

/** Build the existing serving projection; activation remains an independent operation. */
export class StagedServingPublisher {
  constructor(private readonly db:DatabaseAdapter) {}
  async publish(identity:ProductionStagedIdentity):Promise<void> {
    const record=await new SqliteStagedEvaluationStore(this.db).get(identity);
    if(!record||record.evaluationState!=='COMPLETED'||!record.decision)throw new Error('SERVING_REQUIRES_COMPLETED_STAGED_EVALUATION');
    const dossier=await new SqliteRichDossierStore(this.db).get(identity,record.inputFingerprint);
    if(!dossier||dossier.verdict.verdict!==record.decision||dossier.verdict.screeningViability!==record.screeningViability)throw new Error('SERVING_REQUIRES_MATCHING_DOSSIER');
    const fingerprint=createHash('sha256').update(JSON.stringify({context:record.evaluationContextFingerprint,input:record.inputFingerprint,evaluation:record.evaluation})).digest('hex');
    const payload={schemaVersion:'staged-serving-v1',inputFingerprint:record.inputFingerprint,evaluationFingerprint:fingerprint,verdict:record.decision,screeningViability:record.screeningViability};
    await this.db.execute(`INSERT INTO materialized_evaluations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,evaluation_state,decision,quality_score,rationale,evidence_ids,evaluation_json,vetoed,materialized_at) VALUES(?,?,?,?,?,?,?,'STAGED_EVALUATED',?,NULL,?,?,?,0,?) ON CONFLICT(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint) DO NOTHING`,[`staged-serving-${fingerprint}`,identity.tenantId,identity.personId,identity.canonicalJobId,identity.opportunityVersion,identity.evaluationContextFingerprint,fingerprint,record.decision,dossier.executiveThesis.text,JSON.stringify(dossier.verdict.claimIds),JSON.stringify(payload),dossier.generatedAt]);
  }
}
