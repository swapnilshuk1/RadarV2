import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {DatabaseAdapter} from '@/data/database';
import {candidateConflictSchema,claimSchema,sourceSchema} from '@/dossier/contracts';
import {validateClaims} from '@/dossier/grounding';
import type {StagedResearchInput} from '@/dossier/staged-role';
import type {ProductionStagedIdentity} from '@/lib/intelligence/staged/ProductionStagedInputAdapter';

const snapshotSchema=z.object({
  opportunity:z.object({id:z.string(),company:z.string(),title:z.string()}),candidate:z.object({name:z.string()}),
  sources:z.array(sourceSchema),evidence:z.array(claimSchema),candidateSourceRefs:z.array(z.object({id:z.string(),title:z.string()})),
  candidateConflicts:z.array(candidateConflictSchema),validEvidenceClaimIds:z.array(z.string()),fields:z.array(z.string()),
  acquisition:z.array(z.object({provider:z.string(),field:z.string(),operation:z.enum(['retrieve','search']),status:z.enum(['ACQUIRED','RETRIEVED','NO_RESULTS','UNAVAILABLE']),sourceIds:z.array(z.string()),detail:z.string()})),fingerprint:z.string(),
});
export function contextInputFingerprint(input:Omit<StagedResearchInput,'fingerprint'>):string {
  const {fingerprint:_ignored,...value}=input as StagedResearchInput;
  const canonical=JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  return createHash('sha256').update(canonical).digest('hex');
}
export function validateSnapshot(value:unknown):StagedResearchInput {
  const input=snapshotSchema.parse(value);
  if(contextInputFingerprint(input)!==input.fingerprint)throw new Error('STAGED_INPUT_SNAPSHOT_HASH_MISMATCH');
  validateClaims(input.evidence,input.sources);
  const candidates=new Set(input.sources.filter(s=>s.plane==='CANDIDATE').map(s=>s.id));
  if(!input.sources.some(s=>s.plane==='JD')||!candidates.size)throw new Error('STAGED_INPUT_SNAPSHOT_SOURCES_MISSING');
  for(const conflict of input.candidateConflicts)if(new Set(conflict.sourceIds).size<2||conflict.sourceIds.some(id=>!candidates.has(id)))throw new Error('STAGED_INPUT_CONFLICT_PROVENANCE_INVALID');
  if(JSON.stringify(input.validEvidenceClaimIds)!==JSON.stringify(input.evidence.map(c=>c.id)))throw new Error('STAGED_INPUT_CLAIM_INDEX_MISMATCH');
  const ids=new Set(input.sources.map(s=>s.id));
  if(ids.size!==input.sources.length||input.acquisition.some(a=>a.sourceIds.some(id=>!ids.has(id))))throw new Error('STAGED_INPUT_SOURCE_INDEX_MISMATCH');
  return input;
}
export class SqliteStagedInputStore {
  constructor(private readonly db:DatabaseAdapter){}
  private key(i:ProductionStagedIdentity){return [i.tenantId,i.personId,i.canonicalJobId,i.opportunityVersion,i.evaluationContextFingerprint];}
  async get(i:ProductionStagedIdentity,binding:string,model:{id:string;version:string;configurationFingerprint?:string}):Promise<StagedResearchInput|undefined>{
    const row=await this.db.one<{source_binding_fingerprint:string;model_id:string;model_version:string;model_configuration_fingerprint:string;input_fingerprint:string;input_json:string}>(`SELECT * FROM staged_frozen_inputs WHERE tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND model_configuration_fingerprint=?`,[...this.key(i),model.configurationFingerprint??"unconfigured"]);
    if(!row)return undefined;
    if(row.source_binding_fingerprint!==binding||row.model_id!==model.id||row.model_version!==model.version||row.model_configuration_fingerprint!==(model.configurationFingerprint??"unconfigured"))throw new Error('STAGED_INPUT_SNAPSHOT_BINDING_MISMATCH');
    const input=validateSnapshot(JSON.parse(row.input_json));
    if(input.fingerprint!==row.input_fingerprint||input.opportunity.id!==i.canonicalJobId)throw new Error('STAGED_INPUT_SNAPSHOT_IDENTITY_MISMATCH');
    return input;
  }
  async save(i:ProductionStagedIdentity,binding:string,model:{id:string;version:string;configurationFingerprint?:string},input:StagedResearchInput):Promise<StagedResearchInput>{
    validateSnapshot(input);
    await this.db.execute(`INSERT INTO staged_frozen_inputs(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,source_binding_fingerprint,model_id,model_version,model_configuration_fingerprint,input_fingerprint,input_json) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,model_configuration_fingerprint) DO NOTHING`,[...this.key(i),binding,model.id,model.version,model.configurationFingerprint??"unconfigured",input.fingerprint,JSON.stringify(input)]);
    // Concurrent evaluations must both use the winning immutable snapshot.
    const saved=await this.get(i,binding,model);if(!saved)throw new Error('STAGED_INPUT_SNAPSHOT_NOT_PERSISTED');return saved;
  }
}