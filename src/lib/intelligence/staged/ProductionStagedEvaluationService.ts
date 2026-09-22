import type { DatabaseAdapter } from '@/data/database';
import type { EvaluationContext } from '@/lib/domain/evaluation_context';
import type { ReasoningModel } from '@/dossier/contracts';
import { runStagedFrozenDecisionDetailed } from '@/dossier/staged-decision';
import { SqliteStagedEvaluationStore, type StagedEvaluationRecord } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import {stagedContractForPolicy} from './stagedPolicy';
import { ProductionStagedInputAdapter, type ProductionStagedIdentity } from './ProductionStagedInputAdapter';
import { durableStagedModel, stagedCheckpointScope } from './DurableStagedModel';

export class ProductionStagedEvaluationService {
  private readonly store:SqliteStagedEvaluationStore; private readonly inputs:ProductionStagedInputAdapter;
  constructor(private readonly db:DatabaseAdapter, private readonly model:ReasoningModel){this.store=new SqliteStagedEvaluationStore(db);this.inputs=new ProductionStagedInputAdapter(db,this.store);}
  async evaluate(identity:ProductionStagedIdentity & {context:EvaluationContext},onStage:(stage:string)=>void=()=>{}):Promise<StagedEvaluationRecord>{
    const existing=await this.store.get(identity); if(existing) return existing;
    const scope=stagedCheckpointScope({
      tenantId:identity.tenantId,
      personId:identity.personId,
      canonicalJobId:identity.canonicalJobId,
      opportunityVersion:identity.opportunityVersion,
      evaluationContextFingerprint:identity.evaluationContextFingerprint,
      profileVersion:identity.profileVersion,
      policyVersion:identity.context.policyVersion,
      model:[this.model.id,this.model.version,this.model.configurationFingerprint??"unconfigured"],
    });
    const model=durableStagedModel(this.db,scope,this.model);
    const frozen=await this.inputs.build(identity,model,onStage);
    const staged=await runStagedFrozenDecisionDetailed(frozen,model,onStage,{policyVersion:identity.context.policyVersion==='staged-v8'?'staged-v8':identity.context.policyVersion==='staged-v7'?'staged-v7':'staged-v6'});
    const record:StagedEvaluationRecord={tenantId:identity.tenantId,personId:identity.personId,canonicalJobId:identity.canonicalJobId,opportunityVersion:identity.opportunityVersion,jobHash:identity.canonicalJobId,evaluationContextFingerprint:identity.evaluationContextFingerprint,profileVersion:identity.profileVersion,policyVersion:identity.context.policyVersion,ontologyVersion:identity.context.ontologyVersion,ontologyFingerprint:identity.context.ontologyFingerprint,inputFingerprint:frozen.fingerprint,sourceFingerprints:frozen.sources.map(source=>`${source.plane}:${source.locator}`),modelId:this.model.id,modelVersion:this.model.version,modelConfigurationFingerprint:this.model.configurationFingerprint??"unconfigured",contractVersion:stagedContractForPolicy(identity.context.policyVersion),evaluationState:'COMPLETED',decision:staged.decision.verdict,screeningViability:staged.decision.screeningViability,evaluation:{decision:staged.decision,trace:staged.trace},evaluatedAt:new Date().toISOString()};
    await this.store.save(record); return record;
  }
}