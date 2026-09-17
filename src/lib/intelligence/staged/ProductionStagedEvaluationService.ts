import type { DatabaseAdapter } from '@/data/database';
import type { EvaluationContext } from '@/lib/domain/evaluation_context';
import type { ReasoningModel } from '@/dossier/contracts';
import { runStagedFrozenDecisionDetailed } from '@/dossier/staged-decision';
import { STAGED_CONTRACT_VERSION, SqliteStagedEvaluationStore, type StagedEvaluationRecord } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { ProductionStagedInputAdapter, type ProductionStagedIdentity } from './ProductionStagedInputAdapter';

export class ProductionStagedEvaluationService {
  private readonly store:SqliteStagedEvaluationStore; private readonly inputs:ProductionStagedInputAdapter;
  constructor(private readonly db:DatabaseAdapter, private readonly model:ReasoningModel){this.store=new SqliteStagedEvaluationStore(db);this.inputs=new ProductionStagedInputAdapter(db,this.store);}
  async evaluate(identity:ProductionStagedIdentity & {context:EvaluationContext},onStage:(stage:string)=>void=()=>{}):Promise<StagedEvaluationRecord>{
    const existing=await this.store.get(identity); if(existing) return existing;
    const frozen=await this.inputs.build(identity,this.model,onStage);
    const staged=await runStagedFrozenDecisionDetailed(frozen,this.model,onStage);
    const record:StagedEvaluationRecord={tenantId:identity.tenantId,personId:identity.personId,canonicalJobId:identity.canonicalJobId,opportunityVersion:identity.opportunityVersion,jobHash:identity.canonicalJobId,evaluationContextFingerprint:identity.evaluationContextFingerprint,profileVersion:identity.profileVersion,policyVersion:identity.context.policyVersion,ontologyVersion:identity.context.ontologyVersion,ontologyFingerprint:identity.context.ontologyFingerprint,inputFingerprint:frozen.fingerprint,sourceFingerprints:frozen.sources.map(source=>`${source.plane}:${source.locator}`),modelId:this.model.id,modelVersion:this.model.version,contractVersion:STAGED_CONTRACT_VERSION,evaluationState:'COMPLETED',decision:staged.decision.verdict,screeningViability:staged.decision.screeningViability,evaluation:{decision:staged.decision,trace:staged.trace},evaluatedAt:new Date().toISOString()};
    await this.store.save(record); return record;
  }
}
