import type { DatabaseAdapter } from '@/data/database';
import { ModelProviderUnavailableError } from '../../model/provider-unavailable';
import type { ReasoningModel } from '@/dossier/contracts';
import {DOSSIER_COMPOSITION_RECIPE} from '@/dossier/factual-review-integrity';
import {durableDossierModel, checkpointHash} from './DurableDossierModel';
import { composeStagedDossier } from '@/dossier/staged-composition';
import {
  assertCanonicalDecisionTrace,
  createStagedEvaluationFingerprint,
  parseCanonicalStagedDecisionResult,
} from '@/dossier/staged-decision-integrity';
import { SqliteRichDossierStore } from '@/data/sqlite/repositories/SqliteRichDossierStore';
import { SqliteStagedEvaluationStore } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { ProductionStagedInputAdapter, type ProductionStagedIdentity } from './ProductionStagedInputAdapter';
import { createGeminiFactualReviewModel } from '../../model/gemini-factual-review-model';

/** Additive presentation work never changes the immutable staged decision or serving pointer. */
export class ProductionStagedDossierService {
  constructor(private readonly db:DatabaseAdapter,private readonly model:ReasoningModel,private readonly factualReviewer?:ReasoningModel) {}
  async compose(identity:ProductionStagedIdentity,onStage:(stage:string)=>void=()=>{}) {
    const evaluation=await new SqliteStagedEvaluationStore(this.db).get(identity);
    if(!evaluation||evaluation.evaluationState!=='COMPLETED')throw new Error('DOSSIER_REQUIRES_COMPLETED_EVALUATION');
    if(evaluation.decision==='PASS')throw new Error('DOSSIER_NOT_REQUIRED_FOR_PASS');
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
      const reviewer=this.factualReviewer??createGeminiFactualReviewModel();
      const scope=checkpointHash({tenantId:identity.tenantId,personId:identity.personId,canonicalJobId:identity.canonicalJobId,opportunityVersion:identity.opportunityVersion,evaluationFingerprint,recipe:DOSSIER_COMPOSITION_RECIPE});
      const composed=await composeStagedDossier(frozen,staged,durableDossierModel(this.db,scope,this.model),durableDossierModel(this.db,scope,reviewer),onStage);
      const dossier={
        ...composed,
        sourceEvaluationFingerprint:evaluationFingerprint,
        sourceInputFingerprint:evaluation.inputFingerprint,
      };
      assertCanonicalDecisionTrace(dossier,staged.trace);
      await store.save(identity,evaluationFingerprint,dossier);
      const saved=await store.get(identity,evaluationFingerprint);
      if(!saved)throw new Error('DOSSIER_NOT_PERSISTED');
      assertCanonicalDecisionTrace(saved,staged.trace);
      return saved;
    }catch(error){
      if(error instanceof ModelProviderUnavailableError)throw error;
      await store.recordFailure(identity,evaluationFingerprint,error);
      throw error;
    }
  }
}
