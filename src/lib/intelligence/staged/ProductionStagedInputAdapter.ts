import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '@/data/database';
import { claimSchema, contextFields, scopeFields, type Claim, type EvidenceSource, type ReasoningModel } from '@/dossier/contracts';
import { extractValidatedSourceClaims, sourceFingerprint, type FrozenResearchInput } from '@/dossier/pipeline';
import type { StagedResearchInput } from '@/dossier/staged-research';
import { SqliteStagedEvaluationStore } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';

export class DeterministicStagedInputUnavailableError extends Error { readonly deterministic=true; constructor(readonly reason:string){super(`STAGED_INPUT_UNAVAILABLE:${reason}`);} }
export interface ProductionStagedIdentity { tenantId:string; personId:string; canonicalJobId:string; opportunityVersion:string; evaluationContextFingerprint:string; profileVersion:string; }

function rawJobText(raw:string):string { try { const parsed=JSON.parse(raw); const candidate=[parsed.rawDescription,parsed.original?.rawDescription,parsed.description,parsed.content].find((v):v is string=>typeof v==='string'&&v.trim().length>0); return candidate?.trim()||raw; } catch { return raw.trim(); } }
function stableSourceId(plane:'JD'|'CANDIDATE', hash:string){return `${plane.toLowerCase()}-${hash.slice(0,24)}`;}
function rebaseClaims(value:unknown[], plane:'JD'|'CANDIDATE', ordinal:number):Claim[]{return value.map((raw,index)=>{const claim=claimSchema.parse(raw);return {...claim,id:`${plane}-${ordinal}-${index+1}`,plane,derivedFrom:[],citations:claim.citations};});}

export class ProductionStagedInputAdapter {
  constructor(private readonly db:DatabaseAdapter, private readonly cache=new SqliteStagedEvaluationStore(db)) {}
  async build(identity:ProductionStagedIdentity, model:ReasoningModel, onStage:(stage:string)=>void=()=>{}):Promise<StagedResearchInput>{
    const version=await this.db.one<any>(`SELECT raw_content,job_title,company_name,content_hash FROM opportunity_versions WHERE canonical_job_id=? AND id=?`,[identity.canonicalJobId,identity.opportunityVersion]);
    if(!version) throw new DeterministicStagedInputUnavailableError('OPPORTUNITY_VERSION_MISSING');
    const jdText=rawJobText(version.raw_content||''); if(!jdText) throw new DeterministicStagedInputUnavailableError('CANONICAL_JD_MISSING');
    const bindings=await this.db.many<any>(`SELECT b.document_id,b.evidence_graph_id,b.document_text_hash,dc.raw_text FROM profile_projection_source_bindings b JOIN document_contents dc ON dc.document_id=b.document_id JOIN evidence_graphs eg ON eg.id=b.evidence_graph_id AND eg.document_id=b.document_id WHERE b.person_id=? AND b.profile_version=? ORDER BY b.document_id`,[identity.personId,identity.profileVersion]);
    if(!bindings.length) throw new DeterministicStagedInputUnavailableError('PROFILE_SOURCE_PROVENANCE_MISSING');
    const jdSource:EvidenceSource={id:stableSourceId('JD',version.content_hash||createHash('sha256').update(jdText).digest('hex')),plane:'JD',title:version.job_title||'Opportunity description',locator:`opportunity-version:${identity.canonicalJobId}:${identity.opportunityVersion}`,text:jdText,capturedAt:new Date(0).toISOString(),attribution:'JOB_POST'};
    const candidateSources:EvidenceSource[]=bindings.map((row:any)=>({id:stableSourceId('CANDIDATE',row.document_text_hash),plane:'CANDIDATE',title:`Candidate document ${row.document_id}`,locator:`candidate-document:${row.document_id}:evidence:${row.evidence_graph_id}`,text:row.raw_text, capturedAt:new Date(0).toISOString(),attribution:'CANDIDATE_SUPPLIED'}));
    const sources=[jdSource,...candidateSources]; const evidence:Claim[]=[];
    for(const [index,source] of sources.entries()) { const ordinal=source.plane==='JD'?1:candidateSources.findIndex(item=>item.id===source.id)+1; const key={sourceFingerprint:sourceFingerprint([source]),modelId:model.id,modelVersion:model.version}; let cached=await this.cache.cachedClaims(key); if(!cached){onStage(`Extracting immutable ${source.plane} source evidence`); cached=await extractValidatedSourceClaims(model,source,`${source.plane}-1-`,onStage); await this.cache.cacheClaims(key,source,cached);} evidence.push(...rebaseClaims(cached,source.plane,ordinal)); }
    const candidate=await this.db.one<{email:string}>(`SELECT email FROM people WHERE id=? AND tenant_id=?`,[identity.personId,identity.tenantId]);
    const frozenBase={opportunity:{id:identity.canonicalJobId,company:version.company_name||'Unknown company',title:version.job_title||'Unknown role'},candidate:{name:candidate?.email||'Candidate'},sources,evidence,candidateSourceRefs:candidateSources.map(source=>({id:source.id,title:source.title})),candidateConflicts:[],acquisition:[],validEvidenceClaimIds:evidence.map(claim=>claim.id),fields:[...contextFields,...scopeFields]};
    const fingerprint=createHash('sha256').update(JSON.stringify({opportunity:frozenBase.opportunity,candidate:frozenBase.candidate,candidateSources:frozenBase.candidateSourceRefs,candidateConflicts:[],evidence,validEvidenceClaimIds:frozenBase.validEvidenceClaimIds,acquisition:[],fields:frozenBase.fields})).digest('hex');
    return {...frozenBase,fingerprint} as StagedResearchInput;
  }
}
