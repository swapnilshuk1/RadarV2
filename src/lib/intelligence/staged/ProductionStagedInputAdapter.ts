import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '@/data/database';
import { claimSchema, sourceSchema, contextFields, scopeFields, type Claim, type ContextProvider, type EvidenceSource, type ReasoningModel } from '@/dossier/contracts';
import { compareCandidateSources, EmptySourceEvidenceError, extractValidatedSourceClaims, selectRelevantContextSources, sourceFingerprint } from '@/dossier/evidence';
import type { StagedResearchInput } from '@/dossier/staged-role';
import { SqliteStagedEvaluationStore } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
import {computeEvaluationContextFingerprint} from '@/lib/domain/evaluation_fingerprint';
import { computeContentHash } from '@/lib/domain/canonical_identity';
import {contextInputFingerprint,SqliteStagedInputStore} from '@/data/sqlite/repositories/SqliteStagedInputStore';
import {ProductionContextProvider} from './ProductionContextProvider';
import {ModelProviderUnavailableError} from '../../model/provider-unavailable';
import {STAGED_POLICY_VERSION,supportsStagedPolicy} from './stagedPolicy';

export class DeterministicStagedInputUnavailableError extends Error { readonly deterministic=true; constructor(readonly reason:string){super(`STAGED_INPUT_UNAVAILABLE:${reason}`);} }
export interface ProductionStagedIdentity { tenantId:string; personId:string; canonicalJobId:string; opportunityVersion:string; evaluationContextFingerprint:string; profileVersion:string; }
type CandidateBinding = { document_id:string; evidence_graph_id:string; document_text_hash:string; raw_text:string };

function rawJobText(raw:string):string { try { const parsed=JSON.parse(raw); const candidate=[parsed.rawDescription,parsed.original?.rawDescription,parsed.description,parsed.content].find((v):v is string=>typeof v==='string'&&v.trim().length>0); return candidate?.trim()||raw; } catch { return raw.trim(); } }
function stableSourceId(plane:'JD'|'CANDIDATE', hash:string){return `${plane.toLowerCase()}-${hash.slice(0,24)}`;}
function rebaseClaims(value:unknown[], plane:EvidenceSource['plane'], ordinal:number):Claim[]{return value.map((raw,index)=>{const claim=claimSchema.parse(raw);return {...claim,id:`${plane}-${ordinal}-${index+1}`,plane,derivedFrom:[],citations:claim.citations};});}

export function assertCanonicalJdContentHash(version: { raw_content: string; job_title: string | null; company_name: string | null; location: string | null; employment_type: string | null; content_hash: string | null }) {
  const recomputed = computeContentHash({
    title: version.job_title ?? '', companyName: version.company_name, location: version.location,
    employmentType: version.employment_type, rawContent: version.raw_content,
  });
  if (!version.content_hash || recomputed !== version.content_hash) {
    throw new DeterministicStagedInputUnavailableError('CANONICAL_JD_HASH_MISMATCH');
  }
}

export class ProductionStagedInputAdapter {
  constructor(private readonly db:DatabaseAdapter, private readonly cache=new SqliteStagedEvaluationStore(db),private readonly providers?:ContextProvider[]) {}

  async build(identity:ProductionStagedIdentity, model:ReasoningModel, onStage:(stage:string)=>void=()=>{}):Promise<StagedResearchInput>{
    const context=await this.db.one<{policy_version:string;profile_version:string;search_plan_snapshot_id:string;ontology_version:string;ontology_fingerprint:string}>(`SELECT policy_version,profile_version,search_plan_snapshot_id,ontology_version,ontology_fingerprint FROM evaluation_contexts WHERE context_fingerprint=? AND tenant_id=? AND person_id=?`,[identity.evaluationContextFingerprint,identity.tenantId,identity.personId]);
    if(!context||!supportsStagedPolicy(context.policy_version)||context.profile_version!==identity.profileVersion)throw new DeterministicStagedInputUnavailableError('EVALUATION_CONTEXT_PROFILE_MISMATCH');
    const version=await this.db.one<any>(`SELECT raw_content,job_title,company_name,location,employment_type,content_hash FROM opportunity_versions WHERE canonical_job_id=? AND id=?`,[identity.canonicalJobId,identity.opportunityVersion]);
    if(!version) throw new DeterministicStagedInputUnavailableError('OPPORTUNITY_VERSION_MISSING');
    assertCanonicalJdContentHash(version);
    const jdText=rawJobText(version.raw_content||''); if(!jdText) throw new DeterministicStagedInputUnavailableError('CANONICAL_JD_MISSING');
    const bindings=await this.db.many<CandidateBinding>(`SELECT b.document_id,b.evidence_graph_id,b.document_text_hash,dc.raw_text FROM profile_projection_source_bindings b JOIN document_contents dc ON dc.document_id=b.document_id AND dc.tenant_id=b.tenant_id AND dc.person_id=b.person_id JOIN evidence_graphs eg ON eg.id=b.evidence_graph_id AND eg.document_id=b.document_id AND eg.tenant_id=b.tenant_id AND eg.person_id=b.person_id WHERE b.tenant_id=? AND b.person_id=? AND b.profile_version=? ORDER BY b.document_id`,[identity.tenantId,identity.personId,identity.profileVersion]);
    if(!bindings.length) throw new DeterministicStagedInputUnavailableError('PROFILE_SOURCE_PROVENANCE_MISSING');
    const jdSource:EvidenceSource={id:stableSourceId('JD',version.content_hash||createHash('sha256').update(jdText).digest('hex')),plane:'JD',title:version.job_title||'Opportunity description',locator:`opportunity-version:${identity.canonicalJobId}:${identity.opportunityVersion}`,text:jdText,capturedAt:new Date(0).toISOString(),attribution:'JOB_POST'};
    const candidateSources:EvidenceSource[]=bindings.map((row)=>({id:stableSourceId('CANDIDATE',createHash('sha256').update(`${row.document_id}:${row.document_text_hash}`).digest('hex')),plane:'CANDIDATE',title:`Candidate document ${row.document_id}`,locator:`candidate-document:${row.document_id}:evidence:${row.evidence_graph_id}`,text:row.raw_text, capturedAt:new Date(0).toISOString(),attribution:'CANDIDATE_SUPPLIED'}));
    return this.buildContextInput(identity,model,jdSource,candidateSources,onStage,context.policy_version,computeEvaluationContextFingerprint({tenantId:identity.tenantId,personId:identity.personId,searchPlanSnapshotId:context.search_plan_snapshot_id,ontologyVersion:context.ontology_version,ontologyFingerprint:context.ontology_fingerprint,policyVersion:context.policy_version,profileVersion:context.profile_version}));
  }
  private async buildContextInput(
    identity:ProductionStagedIdentity,
    model:ReasoningModel,
    jd:EvidenceSource,
    candidates:EvidenceSource[],
    onStage:(stage:string)=>void,
    policyVersion:string,
    expectedContextFingerprint:string,
  ):Promise<StagedResearchInput>{
    const binding=createHash('sha256').update(JSON.stringify({profile:identity.profileVersion,sources:sourceFingerprint([jd,...candidates])})).digest('hex');
    const store=new SqliteStagedInputStore(this.db);
    const existing=await store.get(identity,binding,model);if(existing)return existing;
    if(policyVersion!==STAGED_POLICY_VERSION)throw new ModelProviderUnavailableError('FRESH_CONTEXT_INPUT_REQUIRES_STAGED_V8');
    if(identity.evaluationContextFingerprint!==expectedContextFingerprint)throw new ModelProviderUnavailableError('CONTEXT_ACQUISITION_POLICY_IDENTITY_MISMATCH');
    if(await this.cache.get(identity))throw new Error('STAGED_COMPLETED_INPUT_SNAPSHOT_MISSING');

    const version=await this.db.one<{company_name:string|null;job_title:string|null}>(`SELECT company_name,job_title FROM opportunity_versions WHERE id=? AND canonical_job_id=?`,[identity.opportunityVersion,identity.canonicalJobId]);
    const person=await this.db.one<{email:string}>(`SELECT email FROM people WHERE id=? AND tenant_id=?`,[identity.personId,identity.tenantId]);
    const opportunity={id:identity.canonicalJobId,company:version?.company_name||'Unknown company',title:version?.job_title||'Unknown role'};
    const providers=this.providers??[new ProductionContextProvider(this.db,identity.tenantId)];
    if(!providers.length)throw new Error('STAGED_CONTEXT_PROVIDER_REQUIRED');

    const loadClaims=async(source:EvidenceSource,ordinal:number)=>{
      const key={
        sourceFingerprint:sourceFingerprint([source]),
        modelId:model.id,
        modelVersion:model.version,
        modelConfigurationFingerprint:model.configurationFingerprint??"unconfigured",
      };
      let claims=await this.cache.cachedClaims(identity,key);
      if(!claims){
        onStage(`Extracting immutable ${source.plane} source evidence`);
        try{
          claims=await extractValidatedSourceClaims(model,source,`${source.plane}-1-`,onStage);
        }catch(error){
          if(source.plane!=='CONTEXT'||!(error instanceof EmptySourceEvidenceError))throw error;
          claims=[];
        }
        await this.cache.cacheClaims(identity,key,source,claims);
      }
      return rebaseClaims(claims,source.plane,ordinal);
    };

    onStage('Acquiring and freezing company context');
    const baseEvidencePromise=Promise.all([
      loadClaims(jd,1),
      ...candidates.map((source,index)=>loadClaims(source,index+1)),
    ]).then(groups=>groups.flat());
    const acquisitionPromise=Promise.all(
      providers.map(provider=>provider.acquire(opportunity,contextFields)),
    );
    const [baseEvidence,acquired]=await Promise.all([baseEvidencePromise,acquisitionPromise]);

    if(!acquired.some(result=>result.attempts.some(attempt=>['RETRIEVED','NO_RESULTS','ACQUIRED'].includes(attempt.status))))throw new ModelProviderUnavailableError('CONTEXT_ACQUISITION_NOT_OPERATIONAL');
    const contextSources=acquired.flatMap(result=>result.sources).map(source=>sourceSchema.parse(source));
    if(contextSources.some(source=>source.plane!=='CONTEXT'))throw new Error('CONTEXT_PROVIDER_SOURCE_PLANE_INVALID');
    const uniqueContext=[...new Map(contextSources.map(source=>[source.id,source])).values()];
    const acquisition=acquired.flatMap(result=>result.attempts);

    const [selected,candidateConflicts]=await Promise.all([
      selectRelevantContextSources(opportunity,jd,uniqueContext,model,onStage),
      compareCandidateSources([jd,...candidates],baseEvidence,model,onStage),
    ]);
    for(const attempt of acquisition)attempt.detail+=` Relevance selection: ${selected.reasoning}`;

    const selectedSet=new Set(selected.sourceIds);
    const selectedContext=uniqueContext.filter(source=>selectedSet.has(source.id));
    const contextEvidence=(await Promise.all(
      selectedContext.map((source,index)=>loadClaims(source,index+1)),
    )).flat();
    const sources=[jd,...candidates,...uniqueContext];
    const evidence=[...baseEvidence,...contextEvidence];

    const base={
      opportunity,
      candidate:{name:person?.email||'Candidate'},
      sources,
      evidence,
      candidateSourceRefs:candidates.map(source=>({id:source.id,title:source.title})),
      candidateConflicts,
      acquisition,
      validEvidenceClaimIds:evidence.map(claim=>claim.id),
      fields:[...contextFields,...scopeFields],
    };
    return store.save(identity,binding,model,{...base,fingerprint:contextInputFingerprint(base)});
  }

}
