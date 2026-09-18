import type { DatabaseAdapter } from '@/data/database';
import { ModelProviderUnavailableError } from '../../model/provider-unavailable';
import type { ReasoningModel } from '@/dossier/contracts';
import { composeStagedDossier } from '@/dossier/staged-composition';
import {
  assertCanonicalDecisionTrace,
  createStagedEvaluationFingerprint,
  parseCanonicalStagedDecisionResult,
} from '@/dossier/staged-decision-integrity';
import { SqliteRichDossierStore } from '@/data/sqlite/repositories/SqliteRichDossierStore';
import { SqliteStagedEvaluationStore } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { ProductionStagedInputAdapter, type ProductionStagedIdentity } from './ProductionStagedInputAdapter';

/** Additive presentation work never changes the immutable staged decision or serving pointer. */
export class ProductionStagedDossierService {
  constructor(private readonly db:DatabaseAdapter,private readonly model:ReasoningModel) {}
  async compose(identity:ProductionStagedIdentity,onStage:(stage:string)=>void=()=>{}) {
    const evaluation=await new SqliteStagedEvaluationStore(this.db).get(identity);
    if(!evaluation||evaluation.evaluationState!=='COMPLETED')throw new Error('DOSSIER_REQUIRES_COMPLETED_EVALUATION');
    const staged=parseCanonicalStagedDecisionResult(evaluation.evaluation);
    if(staged.decision.verdict!==evaluation.decision||staged.decision.screeningViability!==evaluation.screeningViability)throw new Error('DOSSIER_DECISION_INTEGRITY_MISMATCH');
    const evaluationFingerprint=createStagedEvaluationFingerprint({
      evaluationContextFingerprint:evaluation.evaluationContextFingerprint,
      inputFingerprint:evaluation.inputFingerprint,
      evaluation:staged,
    });
    const store=new SqliteRichDossierStore(this.db);
    const existing=await store.get(identity,evaluationFingerprint);
    if(existing){assertCanonicalDecisionTrace(existing,staged.trace);return existing;}
    const frozen=await new ProductionStagedInputAdapter(this.db).build(identity,this.model,onStage);
    if(frozen.fingerprint!==evaluation.inputFingerprint)throw new Error('DOSSIER_FROZEN_INPUT_MISMATCH');
    try {
      const composed=await composeStagedDossier(frozen,staged,this.model,onStage);
      const dossier={
        ...composed,
        sourceEvaluationFingerprint:evaluationFingerprint,
        sourceInputFingerprint:evaluation.inputFingerprint,
      };
      assertCanonicalDecisionTrace(dossier,staged.trace);
      await store.save(identity,evaluationFingerprint,dossier);
      return dossier;
    }catch(error){
      if(error instanceof ModelProviderUnavailableError)throw error;
      await store.recordFailure(identity,evaluationFingerprint,error);
      throw error;
    }
  }
}
